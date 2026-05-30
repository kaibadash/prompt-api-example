"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CATEGORIES, type PostFields } from "./post-form";

// Chrome の Prompt API（LanguageModel）は標準の DOM 型に含まれないため、
// 利用する範囲だけ最小限のアンビエント型を宣言する。
// https://developer.chrome.com/docs/ai/prompt-api
type Availability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

interface DownloadProgressEvent extends Event {
  readonly loaded: number;
}

interface CreateMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEvent) => void,
  ): void;
}

// 入力／出力で扱えるモダリティ。
type Modality = "text" | "image" | "audio";

interface ExpectedModality {
  type: Modality;
  // text モダリティでのみ意味を持つ言語ヒント。
  languages?: string[];
}

// マルチモーダル入力。画像・音声は Blob をそのまま value に渡せる。
interface MessageContent {
  type: Modality;
  value: string | Blob;
}

interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent[];
}

// prompt() はプレーン文字列、またはメッセージ配列を受け付ける。
type PromptInput = string | PromptMessage[];

interface PromptOptions {
  signal?: AbortSignal;
  // JSON Schema を渡すと出力をその構造に拘束できる（structured output）。
  responseConstraint?: object;
}

interface LanguageModelSession {
  prompt(input: PromptInput, options?: PromptOptions): Promise<string>;
  promptStreaming(
    input: PromptInput,
    options?: PromptOptions,
  ): AsyncIterable<string>;
  destroy(): void;
}

// create()／availability() に渡す共通オプション。
// 画像・音声を使う場合は expectedInputs で宣言する必要がある。
interface LanguageModelOptions {
  expectedInputs?: ExpectedModality[];
  expectedOutputs?: ExpectedModality[];
}

interface LanguageModelCreateOptions extends LanguageModelOptions {
  monitor?: (monitor: CreateMonitor) => void;
  signal?: AbortSignal;
}

interface LanguageModelStatic {
  availability(options?: LanguageModelOptions): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare global {
  // ブラウザがサポートしていない場合は undefined になり得る。
  var LanguageModel: LanguageModelStatic | undefined;
}

const fieldClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

// 投稿フォームへ反映するときに使う structured output 用の JSON Schema。
const POST_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "投稿者の名前" },
    category: {
      type: "string",
      enum: CATEGORIES.map((c) => c.value),
      description: "投稿のカテゴリ",
    },
    body: { type: "string", description: "投稿の本文" },
  },
  required: ["name", "category", "body"],
  additionalProperties: false,
} as const;

// 投稿生成を促すための指示文を組み立てる。
function buildPostPrompt(instruction: string): string {
  const categoryList = CATEGORIES.map((c) => `${c.value}（${c.label}）`).join(
    "、",
  );
  return [
    "あなたは投稿フォームを埋めるアシスタントです。",
    "次の指示に沿って投稿の name（投稿者名）、category、body（本文）を日本語で作成してください。",
    `category は次のいずれかから選んでください: ${categoryList}。`,
    `指示: ${instruction}`,
  ].join("\n");
}

// 利用可否ステータスごとの表示メタ情報。
const STATUS_META: Record<
  Availability | "unsupported" | "checking",
  { label: string; description: string; tone: string }
> = {
  checking: {
    label: "確認中",
    description: "Prompt API が利用可能か確認しています…",
    tone: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
  },
  unsupported: {
    label: "非対応",
    description:
      "このブラウザは Prompt API（window.LanguageModel）に対応していません。Chrome の対応バージョンでお試しください。",
    tone: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  },
  unavailable: {
    label: "利用不可",
    description:
      "この端末では Prompt API を利用できません（ハードウェア要件などを満たしていない可能性があります）。",
    tone: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  },
  downloadable: {
    label: "ダウンロード可能",
    description:
      "モデルをダウンロードすると利用できます。下のボタンからダウンロードを開始してください。",
    tone: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  downloading: {
    label: "ダウンロード中",
    description: "モデルをダウンロードしています…",
    tone: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  available: {
    label: "利用可能",
    description: "モデルの準備ができています。指示を入力して送信してください。",
    tone: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
  },
};

type StatusKey = keyof typeof STATUS_META;

type PromptPlaygroundProps = {
  // 結果を投稿フォームへ反映するためのコールバック。
  onApplyToForm?: (fields: PostFields) => void;
};

export default function PromptPlayground({
  onApplyToForm,
}: PromptPlaygroundProps) {
  const [status, setStatus] = useState<StatusKey>("checking");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 投稿フォームへ反映するモード（onApplyToForm がある場合のみ既定で ON）。
  const [applyToForm, setApplyToForm] = useState(Boolean(onApplyToForm));
  // 添付する画像・音声（任意）。
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const sessionRef = useRef<LanguageModelSession | null>(null);
  // 現在のセッションが宣言しているモダリティの集合（再生成判定に使う）。
  const sessionModalitiesRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  // 初回マウント時に利用可否を確認する。
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (typeof LanguageModel === "undefined") {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      try {
        const availability = await LanguageModel.availability();
        if (!cancelled) setStatus(availability);
      } catch (err: unknown) {
        if (!cancelled) {
          setStatus("unsupported");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // アンマウント時にセッションと進行中の生成を破棄する。
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      sessionRef.current?.destroy();
    };
  }, []);

  // 選択中ファイルのプレビュー URL を導出し、変更・アンマウント時に解放する。
  const imagePreview = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : null),
    [imageFile],
  );
  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const audioPreview = useMemo(
    () => (audioFile ? URL.createObjectURL(audioFile) : null),
    [audioFile],
  );
  useEffect(() => {
    if (!audioPreview) return;
    return () => URL.revokeObjectURL(audioPreview);
  }, [audioPreview]);

  // 添付内容に応じて宣言すべき expectedInputs を組み立てる。
  const buildExpectedInputs = useCallback(
    (modalities: Modality[]): ExpectedModality[] =>
      modalities.map((type) => (type === "text" ? { type, languages: ["ja"] } : { type })),
    [],
  );

  // セッションを（必要ならダウンロードしつつ）生成する。
  // 要求するモダリティが現在のセッションでまかなえない場合は作り直す。
  const ensureSession = useCallback(
    async (modalities: Modality[]) => {
      if (typeof LanguageModel === "undefined") {
        throw new Error("Prompt API に対応していません。");
      }

      // text は常に含める。重複を除いて安定したキーにする。
      const required = Array.from(new Set<Modality>(["text", ...modalities]));
      const key = [...required].sort().join(",");

      if (sessionRef.current && sessionModalitiesRef.current === key) {
        return sessionRef.current;
      }

      // モダリティが変わったら既存セッションを破棄して作り直す。
      sessionRef.current?.destroy();
      sessionRef.current = null;

      const session = await LanguageModel.create({
        expectedInputs: buildExpectedInputs(required),
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            setDownloadProgress(event.loaded);
          });
        },
      });
      sessionRef.current = session;
      sessionModalitiesRef.current = key;
      return session;
    },
    [buildExpectedInputs],
  );

  // ダウンロードボタン押下時の処理。create() がモデルのダウンロードを開始する。
  const handleDownload = useCallback(async () => {
    setError(null);
    setIsPreparing(true);
    setStatus("downloading");
    setDownloadProgress(0);
    try {
      await ensureSession([]);
      setStatus("available");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      // 失敗した場合は最新の状態を取り直す。
      if (typeof LanguageModel !== "undefined") {
        setStatus(await LanguageModel.availability());
      }
    } finally {
      setIsPreparing(false);
      setDownloadProgress(null);
    }
  }, [ensureSession]);

  // プロンプト送信（ストリーミングで逐次表示）。
  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = input.trim();
      // テキストが空でも、画像・音声があれば送信できる。
      const hasMedia = Boolean(imageFile || audioFile);
      if ((!text && !hasMedia) || isGenerating) return;

      setError(null);
      setOutput("");
      setIsGenerating(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // 添付に応じて必要なモダリティでセッションを用意する。
        const modalities: Modality[] = [];
        if (imageFile) modalities.push("image");
        if (audioFile) modalities.push("audio");
        const session = await ensureSession(modalities);
        setStatus("available");

        // user メッセージの content を組み立てるヘルパー。
        const buildContent = (promptText: string): MessageContent[] => {
          const content: MessageContent[] = [];
          if (promptText) content.push({ type: "text", value: promptText });
          if (imageFile) content.push({ type: "image", value: imageFile });
          if (audioFile) content.push({ type: "audio", value: audioFile });
          return content;
        };

        if (applyToForm && onApplyToForm) {
          // structured output で投稿フォームの各項目を生成して反映する。
          const messages: PromptMessage[] = [
            { role: "user", content: buildContent(buildPostPrompt(text)) },
          ];
          const json = await session.prompt(messages, {
            signal: controller.signal,
            responseConstraint: POST_SCHEMA,
          });
          const parsed = JSON.parse(json) as PostFields;
          onApplyToForm(parsed);
          setOutput(JSON.stringify(parsed, null, 2));
        } else {
          // 通常モード: ストリーミングで逐次表示する。
          // 添付がなければ従来どおり文字列を渡す。
          const promptInput: PromptInput = hasMedia
            ? [{ role: "user", content: buildContent(text) }]
            : text;
          const stream = session.promptStreaming(promptInput, {
            signal: controller.signal,
          });
          for await (const chunk of stream) {
            setOutput((prev) => prev + chunk);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // ユーザーが中断した場合は何もしない。
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    },
    [
      applyToForm,
      audioFile,
      ensureSession,
      imageFile,
      input,
      isGenerating,
      onApplyToForm,
    ],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const meta = STATUS_META[status];
  const canPrompt = status === "available" || status === "downloadable";

  return (
    <div className="flex flex-col gap-6">
      {/* 利用可否ステータス */}
      <div
        className={`flex flex-col gap-1 rounded-md border px-4 py-3 ${meta.tone}`}
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">ステータス:</span>
          <span className="text-sm font-medium">{meta.label}</span>
        </div>
        <p className="text-sm opacity-90">{meta.description}</p>
      </div>

      {/* ダウンロードボタン */}
      {(status === "downloadable" || status === "downloading") && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleDownload}
            disabled={isPreparing}
            className={primaryButtonClass}
          >
            {isPreparing ? "ダウンロード中…" : "モデルをダウンロード"}
          </button>

          {/* ダウンロードプログレス */}
          {downloadProgress !== null && (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-50"
                  style={{ width: `${Math.round(downloadProgress * 100)}%` }}
                />
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {Math.round(downloadProgress * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* プロンプト入力フォーム */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="prompt" className={labelClass}>
            指示（プロンプト）
          </label>
          <textarea
            id="prompt"
            name="prompt"
            rows={4}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl+Enter（Mac は Cmd+Enter）で送信する。
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={!canPrompt || isGenerating}
            placeholder={
              applyToForm
                ? "例: 猫についてのポエムを投稿して（Ctrl+Enter で送信）"
                : "例: 猫についての短い俳句を作って（Ctrl+Enter で送信）"
            }
            className={`${fieldClass} resize-y disabled:cursor-not-allowed disabled:opacity-50`}
          />
        </div>

        {/* 画像・音声の添付（任意・マルチモーダル入力） */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 画像 */}
          <div className="flex flex-col gap-2">
            <label htmlFor="image" className={labelClass}>
              画像（任意）
            </label>
            <input
              ref={imageInputRef}
              id="image"
              type="file"
              accept="image/*"
              disabled={!canPrompt || isGenerating}
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:file:bg-zinc-50 dark:file:text-zinc-900 dark:hover:file:bg-zinc-200"
            />
            {imageFile && (
              <div className="flex items-center gap-3">
                {imagePreview && (
                  // eslint-disable-next-line @next/next/no-img-element -- ローカル Blob のプレビューのため next/image は使わない
                  <img
                    src={imagePreview}
                    alt="添付画像のプレビュー"
                    className="h-14 w-14 rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
                  />
                )}
                <span className="flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {imageFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    if (imageInputRef.current) imageInputRef.current.value = "";
                  }}
                  disabled={isGenerating}
                  className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  削除
                </button>
              </div>
            )}
          </div>

          {/* 音声 */}
          <div className="flex flex-col gap-2">
            <label htmlFor="audio" className={labelClass}>
              音声（任意）
            </label>
            <input
              ref={audioInputRef}
              id="audio"
              type="file"
              accept="audio/*"
              disabled={!canPrompt || isGenerating}
              onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:file:bg-zinc-50 dark:file:text-zinc-900 dark:hover:file:bg-zinc-200"
            />
            {audioFile && (
              <div className="flex flex-col gap-2">
                {audioPreview && (
                  <audio src={audioPreview} controls className="w-full" />
                )}
                <div className="flex items-center gap-3">
                  <span className="flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {audioFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAudioFile(null);
                      if (audioInputRef.current) audioInputRef.current.value = "";
                    }}
                    disabled={isGenerating}
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    削除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 投稿フォームへの反映トグル */}
        {onApplyToForm && (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={applyToForm}
              onChange={(event) => setApplyToForm(event.target.checked)}
              disabled={isGenerating}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900/20 dark:border-zinc-700"
            />
            生成結果を左の投稿フォームに反映する
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={
              !canPrompt ||
              isGenerating ||
              (!input.trim() && !imageFile && !audioFile)
            }
            className={primaryButtonClass}
          >
            {isGenerating ? "生成中…" : "送信する"}
          </button>
          {isGenerating && (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              中断
            </button>
          )}
        </div>
      </form>

      {/* エラー表示 */}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {/* 応答表示 */}
      {output && (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>
            {applyToForm ? "反映した内容" : "応答"}
          </span>
          <div className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
            {output}
          </div>
        </div>
      )}

      {/* デバッグ用リンク。オンデバイスモデルの状態やダウンロード状況を確認できる。
          Chrome は Web ページから chrome:// への直接遷移をブロックするため、
          クリックで開かない場合はアドレスバーへコピーして開く。 */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        デバッグ:{" "}
        <a
          href="chrome://on-device-internals/"
          className="font-mono underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          chrome://on-device-internals/
        </a>{" "}
        でモデルの状態を確認できます（開けない場合はアドレスバーに貼り付けてください）。
      </p>
    </div>
  );
}
