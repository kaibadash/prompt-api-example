import Playground from "./playground";

export default function Home() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <main className="w-full max-w-6xl">
        <Playground />
        <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <a
            href="https://github.com/kaibadash/prompt-api-example"
            className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            https://github.com/kaibadash/prompt-api-example
          </a>
        </p>
      </main>
    </div>
  );
}
