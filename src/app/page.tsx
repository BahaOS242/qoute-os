import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { TEMPLATES } from "@/templates/registry";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:py-20">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">QuoteOS</span>
        <nav className="flex gap-2">
          <ButtonLink href="/login" variant="ghost">Sign in</ButtonLink>
          <ButtonLink href="/signup">Get started</ButtonLink>
        </nav>
      </header>
      <section className="mt-16 max-w-3xl sm:mt-24">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">BahaOS · QuoteOS</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Stripe Checkout for professional-service quotes.</h1>
        <p className="mt-5 text-lg text-slate-600">
          Turn website and social traffic into qualified opportunities: dynamic questions, deterministic pricing, human-review routing,
          lead capture, attribution and automated follow-up - configured per client, never custom-coded.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/q/executive-financials">Try the demo quote</ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary">Open dashboard</ButtonLink>
        </div>
      </section>
      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <Link key={t.key} href={`/q/executive-financials?template=${t.key}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow">
            <div className="flex gap-1.5">
              <span className="h-4 w-4 rounded-full" style={{ background: t.defaults.primaryColor }} />
              <span className="h-4 w-4 rounded-full" style={{ background: t.defaults.accentColor }} />
            </div>
            <p className="mt-3 font-semibold">{t.name} template</p>
            <p className="mt-1 text-sm text-slate-500">{t.audience}</p>
          </Link>
        ))}
      </section>
      <p className="mt-16 text-xs text-slate-400">Demo organization and prices are fictional.</p>
    </main>
  );
}
