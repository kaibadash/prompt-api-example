import Playground from "./playground";

export default function Home() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <main className="w-full max-w-6xl">
        <Playground />
      </main>
    </div>
  );
}
