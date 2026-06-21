"use client";

import { useEffect, useState, useMemo } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Tab = "scanner" | "inventory" | "studio" | "analytics";

interface ConfigJob {
  id: string;
  platform: string;
  keywords: string[];
  maxPrice: number;
  minDesiredProfit: number;
  condition?: string;
  enabled: boolean;
}

interface Config {
  jobs: ConfigJob[];
  antiBot: {
    minDelayMs: number;
    maxDelayMs: number;
  };
}

interface Deal {
  id: string;
  platform: string;
  title: string;
  price: number;
  currency: string;
  estimated_resell_value: number;
  fees: number;
  shipping: number;
  net_profit: number;
  roi_percent: number;
  url: string;
  image_url?: string;
  condition?: string;
  seller?: string;
  created_at: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("scanner");
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<string>("loading");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then(() => setStatus("ok"))
      .catch(() => setStatus("offline"));

    fetch(`${API_URL}/config`)
      .then((r) => r.json())
      .then((data) => setConfig(data))
      .catch(() => setConfig(null));

    fetch(`${API_URL}/deals`)
      .then((r) => r.json())
      .then((data) => setDeals(data.deals ?? []))
      .catch(() => setDeals([]))
      .finally(() => setDealsLoading(false));
  }, []);

  const tabs: { id: Tab; label: string; shortLabel: string }[] = [
    { id: "scanner", label: "Scanner-Zentrale", shortLabel: "Scanner" },
    { id: "inventory", label: "Lager / Inventar", shortLabel: "Lager" },
    { id: "studio", label: "KI-Studio", shortLabel: "KI" },
    { id: "analytics", label: "ROI-Analytics", shortLabel: "ROI" },
  ];

  const analytics = useMemo(() => {
    const totalSpent = deals.reduce((sum, d) => sum + d.price, 0);
    const totalRevenue = deals.reduce((sum, d) => sum + d.estimated_resell_value, 0);
    const totalFees = deals.reduce((sum, d) => sum + d.fees, 0);
    const totalShipping = deals.reduce((sum, d) => sum + d.shipping, 0);
    const netProfit = deals.reduce((sum, d) => sum + d.net_profit, 0);
    return { totalSpent, totalRevenue, totalFees, totalShipping, netProfit };
  }, [deals]);

  async function handleGenerateImage() {
    setGenerating(true);
    setGeneratedImage(null);
    setGenerateError(null);
    try {
      const res = await fetch(`${API_URL}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { imageDataUrl?: string; error?: string };
      if (!res.ok || !data.imageDataUrl) {
        throw new Error(data.error || "Bildgenerierung fehlgeschlagen");
      }
      setGeneratedImage(data.imageDataUrl);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">ResellEngine</h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status === "ok"
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
            }`}
          >
            API {status === "ok" ? "online" : "offline"}
          </span>
        </div>
      </header>

      <nav className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="-mb-px flex overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4 ${
                  activeTab === tab.id
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {activeTab === "scanner" && (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold">Scanner-Zentrale</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Konfiguriere Suchaufträge in <code className="rounded bg-zinc-200 px-1 py-0.5 dark:bg-zinc-800">config.json</code> und starte den Scraper über das Terminal mit <code className="rounded bg-zinc-200 px-1 py-0.5 dark:bg-zinc-800">npm run test:search</code>.
            </p>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {config?.jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{job.id}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        job.enabled
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {job.enabled ? "aktiv" : "inaktiv"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">
                    {job.platform} • {job.keywords.join(", ")} • max {job.maxPrice}€
                  </p>
                  <p className="text-xs text-zinc-400">
                    Min. Profit: {job.minDesiredProfit}€
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "inventory" && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Lager / Inventar</h2>
              <span className="text-sm text-zinc-500">
                {deals.length} Deal{deals.length !== 1 ? "s" : ""}
              </span>
            </div>

            {dealsLoading ? (
              <p className="text-sm text-zinc-500">Lade Deals...</p>
            ) : deals.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500">
                  Noch keine Deals in der Datenbank. Führe <code className="rounded bg-zinc-200 px-1 py-0.5 dark:bg-zinc-800">npm run test:search</code> im Backend aus.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {deals.map((deal) => (
                  <a
                    key={deal.id}
                    href={deal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    {deal.image_url ? (
                      <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                        <img
                          src={deal.image_url}
                          alt={deal.title}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                        <span className="text-sm text-zinc-400">Kein Bild</span>
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {deal.platform}
                        </span>
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {formatCurrency(deal.net_profit)}
                        </span>
                      </div>
                      <h3 className="mt-2 line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {deal.title}
                      </h3>
                      <div className="mt-auto pt-3 text-xs text-zinc-500">
                        <p>Kauf: {formatCurrency(deal.price)}</p>
                        <p>Schätzwert: {formatCurrency(deal.estimated_resell_value)}</p>
                        <p>ROI: {deal.roi_percent}%</p>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "studio" && (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold">KI-Studio</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Generiere Produktbilder mit Gemini. Gib einen Prompt ein und klicke auf „Bild generieren“.
            </p>
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="z. B. weiße Nike Sneaker auf sauberem Hintergrund"
                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button
                  onClick={handleGenerateImage}
                  disabled={generating || prompt.trim().length === 0}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {generating ? "Generiere..." : "Bild generieren"}
                </button>
              </div>
              {generateError && (
                <p className="text-sm text-red-600 dark:text-red-400">{generateError}</p>
              )}
              {generatedImage && (
                <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">Generiertes Bild</p>
                  <img
                    src={generatedImage}
                    alt="Generiertes Produktbild"
                    className="max-h-96 w-auto rounded-lg object-contain"
                  />
                  <a
                    href={generatedImage}
                    download="generated-product.png"
                    className="mt-3 inline-block text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  >
                    Bild herunterladen
                  </a>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "analytics" && (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold">ROI-Analytics</h2>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-500">Ausgaben</p>
                <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.totalSpent)}</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-500">Einnahmen (geschätzt)</p>
                <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.totalRevenue)}</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-500">Gebühren + Versand</p>
                <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.totalFees + analytics.totalShipping)}</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-500">Netto-Gewinn</p>
                <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.netProfit)}</p>
              </div>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Zahlen basieren auf {deals.length} gespeicherten Deals aus der Datenbank.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
