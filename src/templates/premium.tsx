"use client";
/**
 * Premium template: luxury professional services. Dark, editorial, serif.
 * Highlights use the brand accent (the lighter brand color) for contrast on the dark canvas.
 */
import { brandStyle } from "@/components/funnel/parts";
import { FunnelBody, stepKey, type Skin } from "@/components/funnel/body";
import type { Funnel } from "@/components/funnel/use-quote-funnel";
import { getTemplateMeta } from "./registry";

const skin: Skin = {
  optionsGrid: "grid gap-px overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-2",
  option:
    "w-full bg-[#101012] px-5 py-4 text-left text-stone-300 transition hover:bg-[#17171a] hover:text-white focus-visible:outline-1 focus-visible:outline-[var(--brand-accent)]",
  optionSelected: "!bg-[#1c1a17] !text-[var(--brand-accent)] shadow-[inset_2px_0_0_var(--brand-accent)]",
  input:
    "w-full border-0 border-b border-white/20 bg-transparent px-0 py-3 font-serif text-2xl text-white placeholder:text-stone-600 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-0",
  label: "text-[11px] uppercase tracking-[0.2em] text-stone-400",
  help: "text-sm text-stone-400",
  error: "text-rose-300",
  primaryButton:
    "inline-flex items-center justify-center border border-[var(--brand-accent)] bg-[var(--brand-accent)] px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-transparent hover:text-[var(--brand-accent)] disabled:opacity-60",
  secondaryButton:
    "inline-flex items-center justify-center border border-white/20 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-300 transition hover:border-white/50 hover:text-white",
  muted: "text-stone-500",
  h2: "font-serif text-3xl font-normal leading-tight text-white sm:text-4xl",
  lead: "text-stone-400",
  eyebrow: "text-[11px] uppercase tracking-[0.3em] text-[var(--brand-accent)]",
  price: "font-serif text-6xl text-white tabular-nums",
  priceSuffix: "ml-1 font-sans text-lg text-stone-500",
  sectionTitle: "text-[11px] uppercase tracking-[0.2em] text-stone-400",
  body: "text-stone-300",
  check: "text-[var(--brand-accent)]",
  assumptionsBox: "border-l border-[var(--brand-accent)] pl-4 text-xs text-stone-500",
  backLink: "text-xs uppercase tracking-[0.2em] text-stone-500 hover:text-stone-200",
  serviceGrid: "grid gap-px overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-2",
  serviceCard: "bg-[#101012] p-6 text-left transition hover:bg-[#17171a] disabled:opacity-60",
  serviceCardSelected: "shadow-[inset_2px_0_0_var(--brand-accent)]",
  serviceTitle: "font-serif text-xl text-white",
  serviceDesc: "text-sm text-stone-500",
  successIcon: "border border-[var(--brand-accent)] text-[var(--brand-accent)]",
  breakdownRows: "border-b border-white/5 last:border-0",
};

export default function PremiumTemplate({ f }: { f: Funnel }) {
  const org = f.config.organization;
  const brand = org.brand;
  return (
    <div style={brandStyle(brand, getTemplateMeta("premium").defaults)} className="min-h-screen bg-[#0a0a0b] text-stone-200">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
        <header className="flex items-end justify-between border-b border-white/10 pb-6">
          <div>
            <p className="font-serif text-2xl text-white">{org.name}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-[var(--brand-accent)]">Private client enquiry</p>
          </div>
          {f.step.kind !== "done" && f.step.kind !== "service" && (
            <p className="font-serif text-sm text-stone-500">
              <span className="text-2xl text-white">{String(f.progress.index).padStart(2, "0")}</span> / {String(f.progress.total).padStart(2, "0")}
            </p>
          )}
        </header>
        {f.step.kind === "service" && (
          <div className="mt-12 max-w-xl">
            <h1 className="font-serif text-4xl leading-tight text-white sm:text-5xl">{(brand.headline as string) || "A considered proposal, prepared for you."}</h1>
            {typeof brand.subheadline === "string" && <p className="mt-4 text-stone-400">{brand.subheadline}</p>}
          </div>
        )}
        <div className="mt-2 h-px bg-white/10">
          <div className="h-px bg-[var(--brand-accent)] transition-all duration-700" style={{ width: `${f.progress.percent}%` }} />
        </div>
        <div key={stepKey(f)} className="qo-enter mt-12">
          <FunnelBody f={f} skin={skin} />
        </div>
        <p className="mt-20 text-center text-[10px] uppercase tracking-[0.3em] text-stone-600">Powered by QuoteOS</p>
      </div>
    </div>
  );
}
