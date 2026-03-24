"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <div className="rounded-2xl border border-red-400/40 bg-red-50 p-6 text-red-900">
        <h1 className="font-display text-2xl">Unexpected application error</h1>
        <p className="mt-2 text-sm text-red-900/80">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-full bg-red-900 px-5 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
