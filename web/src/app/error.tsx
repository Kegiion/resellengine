"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 dark:bg-zinc-950">
      <h1 className="text-lg font-semibold">Dashboard konnte nicht geladen werden</h1>
      <p className="text-sm text-zinc-500">Bitte prüfe die API-Verbindung oder lade die Seite neu.</p>
      <button
        onClick={() => reset()}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Erneut versuchen
      </button>
    </div>
  );
}
