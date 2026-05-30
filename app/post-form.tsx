"use client";

import { useEffect, useRef, useState } from "react";

export const CATEGORIES = [
  { value: "poem", label: "ポエム" },
  { value: "knowledge", label: "知見" },
  { value: "blog", label: "ブログ" },
  { value: "memo", label: "メモ" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];

export type PostFields = {
  name: string;
  category: CategoryValue | "";
  body: string;
};

export const EMPTY_FIELDS: PostFields = { name: "", category: "", body: "" };

const fieldClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

type PostFormProps = {
  fields: PostFields;
  setFields: React.Dispatch<React.SetStateAction<PostFields>>;
};

export default function PostForm({ fields, setFields }: PostFormProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // プレビュー用の object URL は不要になったタイミングで破棄する。
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
    setFileName(file?.name ?? null);
  }

  function clearImage() {
    setPreviewUrl(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // サーバー実装は無し。送信できたことを表示してフォームをリセットするだけ。
    setFields(EMPTY_FIELDS);
    clearImage();
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* 名前 */}
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className={labelClass}>
          名前
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={fields.name}
          onChange={(event) =>
            setFields((prev) => ({ ...prev, name: event.target.value }))
          }
          placeholder="山田 太郎"
          className={fieldClass}
        />
      </div>

      {/* カテゴリ */}
      <div className="flex flex-col gap-2">
        <label htmlFor="category" className={labelClass}>
          カテゴリ
        </label>
        <select
          id="category"
          name="category"
          required
          value={fields.category}
          onChange={(event) =>
            setFields((prev) => ({
              ...prev,
              category: event.target.value as CategoryValue,
            }))
          }
          className={fieldClass}
        >
          <option value="" disabled>
            選択してください
          </option>
          {CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      {/* 本文 */}
      <div className="flex flex-col gap-2">
        <label htmlFor="body" className={labelClass}>
          本文
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={6}
          value={fields.body}
          onChange={(event) =>
            setFields((prev) => ({ ...prev, body: event.target.value }))
          }
          placeholder="本文を入力してください"
          className={`${fieldClass} resize-y`}
        />
      </div>

      {/* 画像アップロード（プレビュー付き） */}
      <div className="flex flex-col gap-2">
        <label htmlFor="image" className={labelClass}>
          画像
        </label>
        <input
          ref={fileInputRef}
          id="image"
          name="image"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="block w-full text-sm text-zinc-600 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 dark:text-zinc-400 dark:file:bg-zinc-50 dark:file:text-zinc-900 dark:hover:file:bg-zinc-200"
        />

        {previewUrl && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="relative w-fit overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
              {/* プレビューは object URL を直接表示するため next/image ではなく img を使う */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="アップロード画像のプレビュー"
                className="max-h-64 w-auto object-contain"
              />
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="truncate">{fileName}</span>
              <button
                type="button"
                onClick={clearImage}
                className="text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                削除
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          送信する
        </button>
      </div>

      {/* 送信結果 */}
      <div aria-live="polite">
        {submitted && (
          <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
            送信しました！
          </p>
        )}
      </div>
    </form>
  );
}
