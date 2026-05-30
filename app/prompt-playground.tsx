"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

interface PromptOptions {
  signal?: AbortSignal;
  // JSON Schema を渡すと出力をその構造に拘束できる（structured output）。
  responseConstraint?: object;
}

interface LanguageModelSession {
  prompt(input: string, options?: PromptOptions): Promise<string>;
  promptStreaming(input: string, options?: PromptOptions): AsyncIterable<string>;
  destroy(): void;
}

interface LanguageModelCreateOptions {
  monitor?: (monitor: CreateMonitor) => void;
  signal?: AbortSignal;
}

interface LanguageModelStatic {
  availability(): Promise<Availability>;
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

  const sessionRef = useRef<LanguageModelSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // セッションを（必要ならダウンロードしつつ）生成する。
  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    if (typeof LanguageModel === "undefined") {
      throw new Error("Prompt API に対応していません。");
    }

    const session = await LanguageModel.create({
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          setDownloadProgress(event.loaded);
        });
      },
    });
    sessionRef.current = session;
    return session;
  }, []);

  // ダウンロードボタン押下時の処理。create() がモデルのダウンロードを開始する。
  const handleDownload = useCallback(async () => {
    setError(null);
    setIsPreparing(true);
    setStatus("downloading");
    setDownloadProgress(0);
    try {
      await ensureSession();
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
      if (!text || isGenerating) return;

      setError(null);
      setOutput("");
      setIsGenerating(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const session = await ensureSession();
        setStatus("available");

        if (applyToForm && onApplyToForm) {
          // structured output で投稿フォームの各項目を生成して反映する。
          const json = await session.prompt(buildPostPrompt(text), {
            signal: controller.signal,
            responseConstraint: POST_SCHEMA,
          });
          const parsed = JSON.parse(json) as PostFields;
          onApplyToForm(parsed);
          setOutput(JSON.stringify(parsed, null, 2));
        } else {
          // 通常モード: ストリーミングで逐次表示する。
          const stream = session.promptStreaming(text, {
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
    [applyToForm, ensureSession, input, isGenerating, onApplyToForm],
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
            disabled={!canPrompt || isGenerating || !input.trim()}
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
    </div>
  );
}
