"use client";
/**
 * Template-agnostic funnel building blocks. Templates pass a FunnelTheme (class names) to get
 * their look; behavior and accessibility are shared.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { QuestionDef } from "@/core/questions";
import { formatMoney } from "@/core/pricing";
import { BILLING_SUFFIX } from "@/core/quote";
import { cn } from "@/lib/cn";
import type { ContactInput, Funnel } from "./use-quote-funnel";

export interface FunnelTheme {
  option: string;
  optionSelected: string;
  optionsGrid: string;
  input: string;
  label: string;
  help: string;
  error: string;
  primaryButton: string;
  secondaryButton: string;
  muted: string;
}

export const CTA = {
  priced: "Get My Exact Quote",
  review: "Request My Personalized Review",
  contact: "Speak With an Advisor",
  book: "Book a Consultation",
};

function Choice({ selected, onClick, theme, children, description }: { selected: boolean; onClick: () => void; theme: FunnelTheme; children: ReactNode; description?: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} className={cn(theme.option, selected && theme.optionSelected)}>
      <span className="block font-medium">{children}</span>
      {description && <span className="mt-0.5 block text-xs opacity-70">{description}</span>}
    </button>
  );
}

export function QuestionInput({ question: q, value, onChange, onSubmit, theme }: { question: QuestionDef; value: unknown; onChange: (v: unknown) => void; onSubmit: () => void; theme: FunnelTheme }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [q.key]);
  const cfg = q.config ?? {};

  switch (q.type) {
    case "SINGLE_SELECT":
      return (
        <div role="radiogroup" aria-label={q.label} className={theme.optionsGrid}>
          {(q.options ?? []).map((o) => (
            <Choice key={o.value} selected={value === o.value} onClick={() => onChange(o.value)} theme={theme} description={o.description}>
              {o.label}
            </Choice>
          ))}
        </div>
      );
    case "MULTI_SELECT": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-label={q.label} className={theme.optionsGrid}>
          {(q.options ?? []).map((o) => {
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
                className={cn(theme.option, on && theme.optionSelected)}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span aria-hidden className={cn("inline-flex h-4 w-4 items-center justify-center rounded border text-[10px]", on ? "border-current" : "border-current opacity-40")}>
                    {on ? "✓" : ""}
                  </span>
                  {o.label}
                </span>
              </button>
            );
          })}
        </div>
      );
    }
    case "BOOLEAN":
      return (
        <div role="radiogroup" aria-label={q.label} className={theme.optionsGrid}>
          <Choice selected={value === true} onClick={() => onChange(true)} theme={theme}>
            Yes
          </Choice>
          <Choice selected={value === false} onClick={() => onChange(false)} theme={theme}>
            No
          </Choice>
        </div>
      );
    case "RANGE": {
      const min = cfg.min ?? 0;
      const max = cfg.max ?? 100;
      const n = typeof value === "number" ? value : min;
      return (
        <div className="space-y-3">
          <div className="text-3xl font-semibold tabular-nums">
            {n.toLocaleString()} {cfg.unit}
          </div>
          <input type="range" min={min} max={max} step={cfg.step ?? 1} value={n} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--brand-primary)]" aria-label={q.label} />
        </div>
      );
    }
    default: {
      const numeric = q.type === "NUMBER" || q.type === "CURRENCY";
      const inputType = numeric ? "number" : q.type === "EMAIL" ? "email" : q.type === "PHONE" ? "tel" : "text";
      const input = (
        <input
          ref={ref}
          id={`q-${q.key}`}
          type={inputType}
          inputMode={numeric ? "decimal" : undefined}
          min={cfg.min}
          max={cfg.max}
          step={cfg.step ?? (numeric ? "any" : undefined)}
          placeholder={cfg.placeholder}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(numeric ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          className={cn(theme.input, q.type === "CURRENCY" && "pl-8")}
          aria-label={q.label}
        />
      );
      return (
        <div className="relative">
          {q.type === "CURRENCY" && <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2", theme.muted)}>$</span>}
          {input}
          {cfg.unit && numeric && <span className={cn("mt-1.5 block text-xs", theme.muted)}>{cfg.unit}</span>}
        </div>
      );
    }
  }
}

export function ContactForm({ f, theme, cta, compact }: { f: Funnel; theme: FunnelTheme; cta: string; compact?: boolean }) {
  const [form, setForm] = useState<ContactInput>({ name: "", company: "", email: "", phone: "", message: "", website: "" });
  const set = (k: keyof ContactInput) => (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void f.submitContact(form);
  };
  const err = (k: string) => f.contactErrors[k] && <span className={cn("mt-1 block text-xs", theme.error)}>{f.contactErrors[k]}</span>;
  const isReview = f.quote?.kind === "REVIEW" || f.quote?.kind === "CONTACT";
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className={cn("grid gap-4", !compact && "sm:grid-cols-2")}>
        <label className="block">
          <span className={theme.label}>Your name</span>
          <input required autoComplete="name" value={form.name} onChange={set("name")} className={cn(theme.input, "mt-1.5")} />
          {err("name")}
        </label>
        <label className="block">
          <span className={theme.label}>
            Business name <span className={theme.muted}>(optional)</span>
          </span>
          <input autoComplete="organization" value={form.company} onChange={set("company")} className={cn(theme.input, "mt-1.5")} />
        </label>
        <label className="block">
          <span className={theme.label}>Email</span>
          <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} className={cn(theme.input, "mt-1.5")} />
          {err("email")}
        </label>
        <label className="block">
          <span className={theme.label}>
            Phone <span className={theme.muted}>(optional)</span>
          </span>
          <input type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} className={cn(theme.input, "mt-1.5")} />
          {err("phone")}
        </label>
      </div>
      {isReview && (
        <label className="block">
          <span className={theme.label}>
            Anything we should know? <span className={theme.muted}>(optional)</span>
          </span>
          <textarea value={form.message} onChange={set("message")} rows={3} className={cn(theme.input, "mt-1.5")} />
        </label>
      )}
      {/* Honeypot: hidden from people, visible to naive bots */}
      <input tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" value={form.website} onChange={set("website")} name="website" />
      {f.error && <p className={cn("text-sm", theme.error)}>{f.error}</p>}
      <button type="submit" disabled={f.busy} className={cn(theme.primaryButton, "w-full sm:w-auto")}>
        {f.busy ? "Sending…" : cta}
      </button>
      <p className={cn("text-xs", theme.muted)}>We&apos;ll only use your details to respond to this request.</p>
    </form>
  );
}

export function priceParts(f: Funnel) {
  const q = f.quote;
  if (!q || (q.kind !== "PRICE" && q.kind !== "RANGE")) return null;
  const suffix = BILLING_SUFFIX[q.billingPeriod];
  const main = q.kind === "RANGE" ? `${formatMoney(q.lowCents ?? 0, q.currency)}–${formatMoney(q.highCents ?? 0, q.currency)}` : formatMoney(q.priceCents ?? 0, q.currency);
  return { main, suffix, isRange: q.kind === "RANGE" };
}

export function Breakdown({ f, className, rowClass, mutedClass }: { f: Funnel; className?: string; rowClass?: string; mutedClass?: string }) {
  const q = f.quote;
  if (!q?.breakdown) return null;
  const b = q.breakdown;
  return (
    <dl className={cn("text-sm", className)}>
      {b.basePriceCents !== null && (
        <div className={cn("flex justify-between py-1.5", rowClass)}>
          <dt>Base service</dt>
          <dd className="tabular-nums">{formatMoney(b.basePriceCents, q.currency)}</dd>
        </div>
      )}
      {b.items.map((i, idx) => (
        <div key={idx} className={cn("flex justify-between gap-4 py-1.5", rowClass)}>
          <dt>{i.label}</dt>
          <dd className="tabular-nums">
            {i.amountCents === null ? <span className={mutedClass}>included in range</span> : `${i.amountCents >= 0 ? "+" : "−"}${formatMoney(Math.abs(i.amountCents), q.currency)}`}
          </dd>
        </div>
      ))}
      {b.minimumApplied && <p className={cn("pt-1 text-xs", mutedClass)}>Minimum engagement fee applied.</p>}
    </dl>
  );
}

export function Assistant({ f, theme }: { f: Funnel; theme: FunnelTheme }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (f.step.kind !== "question") return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    try {
      setA(await f.ask(q));
    } catch {
      setA("Sorry, I couldn't answer that right now. Your best estimate is fine - an advisor will confirm details.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="mt-6 text-sm">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={cn("underline underline-offset-4", theme.muted)}>
          Not sure what this means? Ask a question
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What counts as a transaction?" className={theme.input} maxLength={500} aria-label="Ask a question" />
            <button type="submit" disabled={loading} className={theme.secondaryButton}>
              {loading ? "…" : "Ask"}
            </button>
          </div>
          {a && (
            <p className={cn("rounded-lg p-3", theme.muted)} role="status">
              {a}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export function brandStyle(brand: Record<string, unknown>, defaults: { primaryColor: string; accentColor: string }) {
  return {
    "--brand-primary": (brand.primaryColor as string) || defaults.primaryColor,
    "--brand-accent": (brand.accentColor as string) || defaults.accentColor,
  } as React.CSSProperties;
}
