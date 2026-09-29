"use client";
/** Professional template: accounting / law / consulting. Trust-first split layout. */
import { brandStyle } from "@/components/funnel/parts";
import { FunnelBody, stepKey, type Skin } from "@/components/funnel/body";
import type { Funnel } from "@/components/funnel/use-quote-funnel";
import { getTemplateMeta } from "./registry";

const skin: Skin = {
  optionsGrid: "grid gap-2.5 sm:grid-cols-2",
  option:
    "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]",
  optionSelected: "!border-[var(--brand-primary)] !bg-[color-mix(in_srgb,var(--brand-primary)_6%,white)] ring-1 ring-[var(--brand-primary)]",
  input:
    "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-primary)_20%,white)]",
  label: "text-sm font-medium text-slate-700",
  help: "text-sm text-slate-500",
  error: "text-red-600",
  primaryButton:
    "inline-flex items-center justify-center rounded-lg bg-[var(--brand-primary)] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60",
  secondaryButton: "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50",
  muted: "text-slate-500",
  h2: "text-2xl font-semibold leading-snug text-slate-900",
  lead: "text-slate-500",
  eyebrow: "text-sm font-medium uppercase tracking-wide text-slate-500",
  price: "text-5xl font-semibold tracking-tight text-[var(--brand-primary)] tabular-nums",
  priceSuffix: "text-xl font-medium text-slate-500",
  sectionTitle: "text-sm font-semibold text-slate-900",
  body: "text-slate-700",
  check: "text-[var(--brand-accent)]",
  assumptionsBox: "rounded-lg bg-slate-50 p-4 text-xs text-slate-500",
  backLink: "text-sm font-medium text-slate-500 hover:text-slate-800",
  serviceGrid: "grid gap-3 sm:grid-cols-2",
  serviceCard:
    "w-full rounded-lg border border-slate-300 bg-white px-4 py-4 text-left transition hover:border-[var(--brand-primary)] hover:bg-slate-50 disabled:opacity-60",
  serviceCardSelected: "border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]",
  serviceTitle: "font-semibold text-slate-900",
  serviceDesc: "text-sm text-slate-500",
  successIcon: "bg-emerald-50 text-emerald-600",
  breakdownRows: "border-b border-slate-100 last:border-0",
};

export default function ProfessionalTemplate({ f }: { f: Funnel }) {
  const org = f.config.organization;
  const brand = org.brand;
  const trust = (brand.trustPoints as string[] | undefined) ?? [];

  return (
    <div style={brandStyle(brand, getTemplateMeta("professional").defaults)} className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[minmax(320px,420px)_1fr]">
      <aside className="bg-[var(--brand-primary)] px-6 py-8 text-white lg:min-h-screen lg:px-10 lg:py-12">
        <div className="flex items-center gap-3">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt="" className="h-9 w-9 rounded bg-white/10 object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded bg-[var(--brand-accent)] font-semibold text-[var(--brand-primary)]">{org.name.charAt(0)}</span>
          )}
          <span className="text-lg font-semibold">{org.name}</span>
        </div>
        <h1 className="mt-8 text-2xl font-semibold leading-snug lg:text-3xl">{(brand.headline as string) || "Get your quote in minutes"}</h1>
        {typeof brand.subheadline === "string" && <p className="mt-3 text-sm leading-relaxed text-white/75">{brand.subheadline}</p>}
        {trust.length > 0 && (
          <ul className="mt-8 hidden space-y-3 text-sm lg:block">
            {trust.map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-accent)] text-[11px] font-bold text-[var(--brand-primary)]">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
        )}
        {(org.contactPhone || org.contactEmail) && <p className="mt-10 hidden text-xs text-white/60 lg:block">Prefer to talk? {org.contactPhone ?? org.contactEmail}</p>}
      </aside>

      <main className="px-4 py-8 sm:px-8 lg:px-16 lg:py-16">
        <div className="mx-auto max-w-2xl">
          {f.step.kind !== "done" && (
            <div className="mb-6">
              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
                <span>{f.progress.label}</span>
                {f.service && <span>{f.service.name}</span>}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Progress" aria-valuenow={f.progress.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-[var(--brand-primary)] transition-all duration-300" style={{ width: `${Math.max(f.progress.percent, 4)}%` }} />
              </div>
            </div>
          )}
          <div key={stepKey(f)} className="qo-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <FunnelBody f={f} skin={skin} />
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">Powered by QuoteOS</p>
        </div>
      </main>
    </div>
  );
}
