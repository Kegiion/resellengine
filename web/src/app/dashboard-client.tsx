"use client";

import { useEffect, useState, useMemo, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function apiPath(path: string): string {
  if (typeof window === "undefined") return `${API_URL}${path}`;
  const hostname = window.location.hostname;
  const usesRewrites =
    hostname.includes("vercel.app") || hostname.endsWith("akaidon.market");
  if (usesRewrites) return `/api${path}`;
  return `${API_URL}${path}`;
}

type Tab = "scanner" | "inventory" | "studio" | "analytics";

type Platform = "vinted" | "kleinanzeigen";

interface ConfigJob {
  id: string;
  platform: Platform;
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

interface PipelineStats {
  scanned: number;
  spamFiltered: number;
  ebayChecked: number;
  profitFiltered: number;
  imageAnalyses: number;
  alarms: number;
}

interface Deal {
  id: string;
  platform: string;
  title: string;
  price: number;
  currency: string;
  estimated_resell_value?: number | null;
  fees?: number | null;
  shipping?: number | null;
  net_profit?: number | null;
  roi_percent?: number | null;
  url: string;
  image_url?: string;
  condition?: string;
  seller?: string;
  created_at?: string | null;
  optimized_description?: {
    title: string;
    description: string;
    hashtags: string[];
    condition: string;
    tone: string;
    optimized_at?: string;
  } | null;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCurrency(value: number | null | undefined): string {
  if (!isValidNumber(value)) return "-- €";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (!isValidNumber(value)) return "--";
  return `${value}%`;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "--";
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMinutes < 1) return "gerade eben";
  if (diffMinutes < 60) return `vor ${diffMinutes} Min`;
  if (diffHours < 24) return `vor ${diffHours} Std`;
  if (diffDays === 1) return "gestern";
  return `vor ${diffDays} Tagen`;
}

export default function DashboardClient() {
  const [activeTab, setActiveTab] = useState<Tab>("scanner");
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<string>("loading");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ConfigJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobForm, setJobForm] = useState<{
    id: string;
    platform: Platform;
    keywords: string;
    maxPrice: string;
    minDesiredProfit: string;
  }>({
    id: "",
    platform: "vinted",
    keywords: "",
    maxPrice: "50",
    minDesiredProfit: "15",
  });
  const [jobSaving, setJobSaving] = useState(false);
  const [jobMessage, setJobMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [dealFilter, setDealFilter] = useState<"all" | "optimized" | "not-optimized">("all");
  const [optimizingDeals, setOptimizingDeals] = useState<
    Record<
      string,
      {
        loading: boolean;
        expanded: boolean;
        result?: Deal["optimized_description"];
        error?: string;
      }
    >
  >({});

  const loadJobsAndDeals = useCallback(async () => {
    try {
      const [healthRes, configRes, dealsRes, statsRes] = await Promise.all(
        [
          fetch(`${apiPath("/")}health`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("health failed")))),
          fetch(`${apiPath("/")}config`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("config failed")))),
          fetch(`${apiPath("/")}deals`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("deals failed")))),
          fetch(`${apiPath("/")}stats`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats failed")))),
        ].map((p) => p.catch((err) => ({ error: String(err) })))
      );

      const hasErrors = [healthRes, configRes, dealsRes].some((r) => "error" in r);
      if (hasErrors) {
        setStatus("offline");
      } else {
        setStatus("ok");
        setConfig(configRes as Config);
        setJobs(((configRes as Config).jobs ?? []) as ConfigJob[]);
        setDeals((dealsRes as { deals?: Deal[] }).deals ?? []);
      }
      if (!("error" in statsRes)) {
        setStats(statsRes as PipelineStats);
      }
    } catch {
      setStatus("offline");
    } finally {
      setDealsLoading(false);
      setJobsLoading(false);
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobsAndDeals();
  }, [loadJobsAndDeals]);

  const tabs: { id: Tab; label: string; shortLabel: string }[] = [
    { id: "scanner", label: "Scanner-Zentrale", shortLabel: "Scanner" },
    { id: "inventory", label: "Lager / Inventar", shortLabel: "Lager" },
    { id: "studio", label: "KI-Studio", shortLabel: "KI" },
    { id: "analytics", label: "ROI-Analytics", shortLabel: "ROI" },
  ];

  const filteredDeals = useMemo(() => {
    if (dealFilter === "optimized") return deals.filter((d) => d.optimized_description?.optimized_at);
    if (dealFilter === "not-optimized") return deals.filter((d) => !d.optimized_description?.optimized_at);
    return deals;
  }, [deals, dealFilter]);

  const analytics = useMemo(() => {
    const totalSpent = deals.reduce((sum, d) => sum + (isValidNumber(d.price) ? d.price : 0), 0);
    const totalRevenue = deals.reduce((sum, d) => sum + (isValidNumber(d.estimated_resell_value) ? d.estimated_resell_value : 0), 0);
    const totalFees = deals.reduce((sum, d) => sum + (isValidNumber(d.fees) ? d.fees : 0), 0);
    const totalShipping = deals.reduce((sum, d) => sum + (isValidNumber(d.shipping) ? d.shipping : 0), 0);
    const netProfit = deals.reduce((sum, d) => sum + (isValidNumber(d.net_profit) ? d.net_profit : 0), 0);
    const topDeals = [...deals]
      .filter((d) => isValidNumber(d.net_profit))
      .sort((a, b) => (b.net_profit ?? 0) - (a.net_profit ?? 0))
      .slice(0, 5);
    const buckets = [
      { label: "<50%", min: -Infinity, max: 50 },
      { label: "50-100%", min: 50, max: 100 },
      { label: "100-200%", min: 100, max: 200 },
      { label: "200-300%", min: 200, max: 300 },
      { label: ">300%", min: 300, max: Infinity },
    ];
    const roiBuckets = buckets.map((b) => ({
      label: b.label,
      count: deals.filter((d) => {
        const roi = d.roi_percent ?? 0;
        return roi > b.min && roi <= b.max;
      }).length,
    }));
    return { totalSpent, totalRevenue, totalFees, totalShipping, netProfit, topDeals, roiBuckets };
  }, [deals]);

  async function handleGenerateImage() {
    setGenerating(true);
    setGeneratedImage(null);
    setGenerateError(null);
    try {
      const res = await fetch(`${apiPath("/")}generate-image`, {
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

  async function handleDeleteJob(id: string) {
    if (!window.confirm("Suchauftrag wirklich löschen?")) return;
    try {
      const res = await fetch(`${apiPath("/")}jobs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Löschen fehlgeschlagen");
      }
      await loadJobsAndDeals();
    } catch (err) {
      setJobMessage({ type: "error", text: err instanceof Error ? err.message : "Fehler" });
    }
  }

  async function handleOptimizeDeal(deal: Deal) {
    setOptimizingDeals((prev) => ({
      ...prev,
      [deal.id]: { loading: true, expanded: true },
    }));
    try {
      const res = await fetch(`${apiPath("/")}api/deals/${deal.id}/optimize-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: deal.title, description: "" }),
      });
      const data = (await res.json()) as { title?: string; description?: string; hashtags?: string[]; condition?: string; tone?: string; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Optimierung fehlgeschlagen");
      }
      const result: Deal["optimized_description"] = {
        title: data.title ?? deal.title,
        description: data.description ?? "",
        hashtags: data.hashtags ?? [],
        condition: data.condition ?? "",
        tone: data.tone ?? "",
        optimized_at: new Date().toISOString(),
      };
      setOptimizingDeals((prev) => ({
        ...prev,
        [deal.id]: { loading: false, expanded: true, result },
      }));
      await loadJobsAndDeals();
    } catch (err) {
      setOptimizingDeals((prev) => ({
        ...prev,
        [deal.id]: { loading: false, expanded: true, error: err instanceof Error ? err.message : "Fehler" },
      }));
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    setJobSaving(true);
    setJobMessage(null);

    const keywords = jobForm.keywords
      .split(/[,\s]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    const id = `vinted-${keywords[0]}-${Date.now()}`;

    try {
      const res = await fetch(`${apiPath("/")}jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          platform: jobForm.platform,
          keywords,
          maxPrice: Number(jobForm.maxPrice),
          minDesiredProfit: Number(jobForm.minDesiredProfit),
          enabled: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Speichern fehlgeschlagen");
      }
      setJobMessage({ type: "ok", text: "Job gespeichert." });
      setJobForm({ id: "", platform: "vinted", keywords: "", maxPrice: "50", minDesiredProfit: "15" });
      await loadJobsAndDeals();
    } catch (err) {
      setJobMessage({ type: "error", text: err instanceof Error ? err.message : "Fehler" });
    } finally {
      setJobSaving(false);
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
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Scanner-Zentrale</h2>
              <span className="text-sm text-zinc-500">
                {jobs.length} Job{jobs.length !== 1 ? "s" : ""}
              </span>
            </div>

            <form onSubmit={handleCreateJob} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="mb-4 text-sm font-medium">Neuen Suchauftrag anlegen</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Plattform</label>
                  <select
                    value={jobForm.platform}
                    onChange={(e) => setJobForm({ ...jobForm, platform: e.target.value as Platform })}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="vinted">Vinted</option>
                    <option value="kleinanzeigen">Kleinanzeigen</option>
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs text-zinc-500">Keywords (Leerzeichen oder Komma getrennt)</label>
                  <input
                    type="text"
                    value={jobForm.keywords}
                    onChange={(e) => setJobForm({ ...jobForm, keywords: e.target.value })}
                    placeholder="z. B. alo yoga hoodie"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Max. Preis (€)</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={jobForm.maxPrice}
                    onChange={(e) => setJobForm({ ...jobForm, maxPrice: e.target.value })}
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Min. Gewinn (€)</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={jobForm.minDesiredProfit}
                    onChange={(e) => setJobForm({ ...jobForm, minDesiredProfit: e.target.value })}
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <button
                  type="submit"
                  disabled={jobSaving || jobForm.keywords.trim().length === 0}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {jobSaving ? "Speichert..." : "Job speichern"}
                </button>
                {jobMessage && (
                  <span className={`text-sm ${jobMessage.type === "ok" ? "text-zinc-600 dark:text-zinc-400" : "text-red-600 dark:text-red-400"}`}>
                    {jobMessage.text}
                  </span>
                )}
              </div>
            </form>

            {jobsLoading ? (
              <p className="text-sm text-zinc-500">Lade Jobs...</p>
            ) : jobs.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500">Noch keine Jobs. Leg oben einen neuen Suchauftrag an.</p>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{job.id}</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            job.enabled
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {job.enabled ? "aktiv" : "inaktiv"}
                        </span>
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="text-xs text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400"
                          title="Löschen"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-zinc-500">
                      {job.platform} • {job.keywords.join(", ")} • max {job.maxPrice}€
                    </p>
                    <p className="text-xs text-zinc-400">Min. Profit: {job.minDesiredProfit}€</p>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="mb-3 text-sm font-medium">System-Status &amp; Filter-Statistiken</h3>
              {statsLoading ? (
                <p className="text-sm text-zinc-500">Lade Statistiken...</p>
              ) : stats ? (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: "Gescannte Artikel", value: stats.scanned },
                    { label: "Spam (Stufe 1)", value: stats.spamFiltered },
                    { label: "eBay-Check (Stufe 2)", value: stats.ebayChecked },
                    { label: "Profit-Filter (Stufe 3)", value: stats.profitFiltered },
                    { label: "Bildanalysen (Stufe 4)", value: stats.imageAnalyses },
                    { label: "Gesendete Alarme", value: stats.alarms },
                  ].map((s) => (
                    <div key={s.label} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                      <p className="text-xs text-zinc-500">{s.label}</p>
                      <p className="mt-1 text-lg font-semibold">{Number.isFinite(s.value) ? s.value : 0}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Statistiken nicht verfügbar.</p>
              )}
            </div>
          </section>
        )}

        {activeTab === "inventory" && (
          <section className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold">Lager / Inventar</h2>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
                  {[
                    { id: "all", label: "Alle" },
                    { id: "optimized", label: "Optimiert" },
                    { id: "not-optimized", label: "Nicht optimiert" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setDealFilter(f.id as typeof dealFilter)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        dealFilter === f.id
                          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <span className="text-sm text-zinc-500">
                  {filteredDeals.length} Deal{filteredDeals.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {dealsLoading ? (
              <p className="text-sm text-zinc-500">Lade Deals...</p>
            ) : filteredDeals.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500">
                  Keine Deals für diesen Filter. {deals.length === 0 && (
                    <>
                      Führe <code className="rounded bg-zinc-200 px-1 py-0.5 dark:bg-zinc-800">npm run test:search</code> im Backend aus.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDeals.map((deal) => {
                  const optim = optimizingDeals[deal.id];
                  const isOptimized = !!deal.optimized_description?.optimized_at;
                  return (
                    <div
                      key={deal.id}
                      className="group flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noreferrer"
                        className="relative block"
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
                      </a>
                      <div className="flex flex-1 flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {deal.platform}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isOptimized && (
                              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                Optimiert
                              </span>
                            )}
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                              {formatCurrency(deal.net_profit)}
                            </span>
                          </div>
                        </div>
                        <h3 className="mt-2 line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          <a href={deal.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {deal.title}
                          </a>
                        </h3>
                        <div className="mt-2 text-xs text-zinc-500">
                          <p>Kauf: {formatCurrency(deal.price)} • Schätzwert: {formatCurrency(deal.estimated_resell_value)}</p>
                          <p>ROI: {formatPercent(deal.roi_percent)} • {deal.condition ? `Zustand: ${deal.condition} • ` : ""}{deal.seller ? `Verkäufer: ${deal.seller} • ` : ""}{formatRelativeTime(deal.created_at)}</p>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => handleOptimizeDeal(deal)}
                            disabled={optim?.loading}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                          >
                            {optim?.loading ? "Optimiere..." : "Optimieren"}
                          </button>
                          {(deal.optimized_description || optim?.result) && (
                            <button
                              onClick={() =>
                                setOptimizingDeals((prev) => ({
                                  ...prev,
                                  [deal.id]: { ...prev[deal.id], expanded: !prev[deal.id]?.expanded },
                                }))
                              }
                              className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                            >
                              {optim?.expanded ?? true ? "Ausblenden" : "Anzeigen"}
                            </button>
                          )}
                        </div>
                        {(optim?.expanded ?? true) && (optim?.result || deal.optimized_description) && (
                          <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                            {(optim?.result || deal.optimized_description) && (
                              <>
                                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                                  {(optim?.result || deal.optimized_description)?.title}
                                </p>
                                <p className="mt-1 whitespace-pre-line text-zinc-600 dark:text-zinc-300">
                                  {(optim?.result || deal.optimized_description)?.description}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {((optim?.result || deal.optimized_description)?.hashtags ?? []).map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                                    >
                                      #{tag}
                                    </span>
                                  ))}
                                </div>
                                <p className="mt-2 text-zinc-500">
                                  Zustand: {(optim?.result || deal.optimized_description)?.condition} • Ton: {(optim?.result || deal.optimized_description)?.tone}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                        {optim?.error && (
                          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{optim.error}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
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
              <p className="text-xs text-zinc-500">
                Generierte Bilder können später mit optimierten Deals verknüpft werden.
              </p>
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

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-4 text-sm font-medium">Top-Deals nach Netto-Gewinn</h3>
                {deals.length === 0 ? (
                  <p className="text-sm text-zinc-500">Keine Deals vorhanden.</p>
                ) : (
                  <div className="space-y-3">
                    {analytics.topDeals.map((d) => {
                      const maxProfit = Math.max(...analytics.topDeals.map((x) => x.net_profit ?? 0), 1);
                      const pct = ((d.net_profit ?? 0) / maxProfit) * 100;
                      return (
                        <div key={d.id} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="truncate pr-2 text-zinc-700 dark:text-zinc-300">{d.title}</span>
                            <span className="shrink-0 font-medium">{formatCurrency(d.net_profit)}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-zinc-800 dark:bg-zinc-200"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-4 text-sm font-medium">ROI-Verteilung</h3>
                {analytics.roiBuckets.length === 0 ? (
                  <p className="text-sm text-zinc-500">Keine ROI-Daten vorhanden.</p>
                ) : (
                  <div className="flex h-48 items-end gap-2">
                    {analytics.roiBuckets.map((bucket) => {
                      const maxCount = Math.max(...analytics.roiBuckets.map((b) => b.count), 1);
                      const pct = (bucket.count / maxCount) * 100;
                      return (
                        <div key={bucket.label} className="flex flex-1 flex-col items-center gap-1">
                          <div className="text-xs text-zinc-500">{bucket.count}</div>
                          <div className="w-full rounded-t bg-zinc-800 dark:bg-zinc-200" style={{ height: `${pct}%` }} />
                          <div className="text-xs text-zinc-500">{bucket.label}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Zahlen basieren auf {deals.length} geladenen Deal{deals.length !== 1 ? "s" : ""} aus der API.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
