"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { TemplateMeta } from "@/templates/registry";

interface RecipeSummary { key: string; name: string; vertical: string; description: string; status: string; services: string[] }

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export function NewOrganizationForm({ recipes, templates }: { recipes: RecipeSummary[]; templates: TemplateMeta[] }) {
  const router = useRouter();
  const [recipeKey, setRecipeKey] = useState<string | null>("accounting");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [templateKey, setTemplateKey] = useState("professional");
  const [currency, setCurrency] = useState("USD");
  const [primaryColor, setPrimary] = useState("#1e3a5f");
  const [accentColor, setAccent] = useState("#c8a24a");
  const [scale, setScale] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ slug: string }>("/api/orgs", {
        method: "POST",
        json: { name, slug, recipeKey, templateKey, currency, brand: { primaryColor, accentColor }, pricing: scale !== 100 ? { scalePercent: scale } : undefined },
      });
      router.push(`/dashboard/${org.slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create organization");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title="1. Recipe">
        <div className="grid gap-3 sm:grid-cols-2">
          {recipes.map((r) => (
            <button
              type="button"
              key={r.key}
              disabled={r.status !== "available"}
              onClick={() => setRecipeKey(r.key)}
              className={cn(
                "rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                recipeKey === r.key ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.name}</span>
                {r.status !== "available" && <Badge>Coming soon</Badge>}
              </span>
              <span className="mt-1 block text-xs text-slate-500">{r.description}</span>
              {r.services.length > 0 && <span className="mt-2 block text-xs text-slate-600">{r.services.join(" · ")}</span>}
            </button>
          ))}
          <button type="button" onClick={() => setRecipeKey(null)} className={cn("rounded-lg border p-4 text-left", recipeKey === null ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300")}>
            <span className="font-medium">Blank</span>
            <span className="mt-1 block text-xs text-slate-500">Start with no services and build from scratch.</span>
          </button>
        </div>
      </Card>

      <Card title="2. Client">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name">
            <Input required value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
          </Field>
          <Field label="Quote page URL" hint={`/q/${slug || "your-firm"}`}>
            <Input required value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["USD", "BSD", "CAD", "GBP", "EUR", "JMD", "TTD", "KYD"].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="3. Branding & template">
        <div className="grid gap-3 sm:grid-cols-3">
          {templates.map((t) => (
            <button type="button" key={t.key} onClick={() => { setTemplateKey(t.key); setPrimary(t.defaults.primaryColor); setAccent(t.defaults.accentColor); }}
              className={cn("rounded-lg border p-3 text-left text-sm", templateKey === t.key ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300")}>
              <span className="font-medium">{t.name}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{t.audience}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Primary color"><Input type="color" value={primaryColor} onChange={(e) => setPrimary(e.target.value)} className="h-10 p-1" /></Field>
          <Field label="Accent color"><Input type="color" value={accentColor} onChange={(e) => setAccent(e.target.value)} className="h-10 p-1" /></Field>
        </div>
      </Card>

      {recipeKey && (
        <Card title="4. Client pricing">
          <Field label={`Scale all recipe prices: ${scale}%`} hint="Applied to base prices and fixed adjustments. Fine-tune individual rules afterwards.">
            <input type="range" min={50} max={200} step={5} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-full accent-slate-900" />
          </Field>
        </Card>
      )}

      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create organization"}</Button>
    </form>
  );
}
