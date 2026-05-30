"use client";

import { useState } from "react";

import PostForm, { EMPTY_FIELDS, type PostFields } from "./post-form";
import PromptPlayground from "./prompt-playground";

const cardClass =
  "rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-950";

export default function Playground() {
  // 投稿フォームの入力値。Prompt API からも書き換えられるよう親で保持する。
  const [fields, setFields] = useState<PostFields>(EMPTY_FIELDS);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* 左: 投稿フォーム */}
      <div className={cardClass}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          投稿フォーム
        </h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          テスト用のフォームです。
        </p>
        <PostForm fields={fields} setFields={setFields} />
      </div>

      {/* 右: Prompt API デモ */}
      <div className={cardClass}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Prompt API デモ
        </h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Chrome の Prompt API（オンデバイス AI）で投稿フォームを生成できます。
        </p>
        <PromptPlayground
          onApplyToForm={(generated) =>
            setFields((prev) => ({ ...prev, ...generated }))
          }
        />
      </div>
    </div>
  );
}
