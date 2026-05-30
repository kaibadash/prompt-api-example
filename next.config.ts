import type { NextConfig } from "next";

// GitHub Pages はサブパス (例: /prompt-api-example) で配信されるため、
// CI ビルド時のみ NEXT_PUBLIC_BASE_PATH を渡して basePath を付与する。
// ローカル開発 (npm run dev) では空文字なのでルート配信のまま。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: {
    // static export では Next.js の画像最適化サーバーが使えないため無効化する。
    unoptimized: true,
  },
};

export default nextConfig;
