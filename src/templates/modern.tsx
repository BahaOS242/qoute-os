"use client";
/** Modern template: technology / agency / SaaS. Gradient canvas, centered card, pill answers. */
import { brandStyle } from "@/components/funnel/parts";
import { FunnelBody, stepKey, type Skin } from "@/components/funnel/body";
import type { Funnel } from "@/components/funnel/use-quote-funnel";
import { getTemplateMeta } from "./registry";

const skin: Skin = {
  optionsGrid: "flex flex-wrap gap-2.5",
  option:
    "rounded-full border border-slate-200 bg-white px-5 py-2.5 text-left text-sm text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-primary)] hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]",
  optionSelected: "!border-transparent !bg-[var(--brand-primary)] !text-white shadow-md",
  input:
    "w-full rounded-2xl border-0 bg-slate-100 px-5 py-4 text-lg text-slate-900 ring-1 ring-inset ring-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]",
  label: "text-sm font-medium text-slate-700",
  help: "text-sm text-slate-500",
  error: "text-rose-600",
  primaryButton:
    "inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-accent)] px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] transition hover:brightness-110 disabled:opacity-60",
  secondaryButton: "inline-flex items-center justify-center rounded-full bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200",
  muted: "text-slate-500",
  h2: "text-3xl font-bold tracking-tight text-slate-900",
  lead: "text-slate-500",
  eyebrow: "inline-flex rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,white)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]",
  price:
    "bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-accent)] bg-clip-text text-6xl font-extrabold tracking-tight text-transparent tabular-nums",
  priceSuffix: "text-xl font-semibold text-slate-400",
  sectionTitle: "text-xs font-semibold uppercase tracking-wider text-slate-400",
  body: "text-slate-700",
  check: "text-[var(--brand-primary)]",
  assumptionsBox: "rounded-2xl bg-slate-50 p-4 text-xs text-slate-500",
  backLink: "text-sm font-semibold text-slate-400 hover:text-slate-700",
  serviceGrid: "grid gap-3 sm:grid-cols-2",
  serviceCard:
    "group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-primary)] hover:shadow-lg disabled:opacity-60",
  serviceCardSelected: "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]",
  serviceTitle: "text-base font-bold text-slate-900 group-hover:text-[var(--brand-primary)]",
  serviceDesc: "text-sm text-slate-500",
  successIcon: "bg-gradient-to-br from-[var(--brand-primary)] to-[var(--brand-accent)] text-white",
  breakdownRows: "",
};

export default function ModernTemplate({ f }: { f: Funnel }) {
  const org = f.config.organization;
  const brand = org.brand;
  return (
    <div style={brandStyle(brand, getTemplateMeta("modern").defaults)} className="relative min-h-screen overflow-hidden bg-slate-950">
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-[var(--brand-primary)] via-slate-900 to-[var(--brand-accent)] opacity-90" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,color-mix(in_srgb,var(--brand-accent)_35%,transparent),transparent_45%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:py-12">
        <header className="flex items-center justify-between text-white">
          <span className="text-lg font-bold tracking-tight">{org.name}</span>
          {f.step.kind !== "done" && (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">{f.progress.label}</span>
          )}
        </header>
        {f.step.kind === "service" && (
          <div className="mt-10 text-white">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{(brand.headline as string) || "Instant pricing. Zero back-and-forth."}</h1>
            {typeof brand.subheadline === "string" && <p className="mt-3 max-w-xl text-white/75">{brand.subheadline}</p>}
          </div>
        )}
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Progress" aria-valuenow={f.progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-white transition-all duration-500" style={{ width: `${Math.max(f.progress.percent, 3)}%` }} />
        </div>
        <div key={stepKey(f)} className="qo-enter mt-6 rounded-3xl bg-white p-6 shadow-2xl sm:p-10">
          <FunnelBody f={f} skin={skin} />
        </div>
        <p className="mt-auto pt-8 text-center text-xs text-white/50">Powered by QuoteOS</p>
      </div>
    </div>
  );
}
