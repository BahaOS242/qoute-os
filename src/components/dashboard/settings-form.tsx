"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import type { TemplateMeta } from "@/templates/registry";

export interface SettingsData {
  name: string;
  slug: string;
  templateKey: string;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  notificationEmail: string | null;
  bookingUrl: string | null;
  highValueThresholdCents: number | null;
  quoteValidityDays: number;
  brand: { primaryColor?: string; accentColor?: string; headline?: string; subheadline?: string; trustPoints?: string[] };
  glossary: { term: string; definition: string }[];
}

export function SettingsForm({ data, templates, canManageOwnerSettings, members }: { data: SettingsData; templates: TemplateMeta[]; canManageOwnerSettings: boolean; members: { email: string; name: string; role: string }[] }) {
  const router = useRouter();
  const [s, setS] = useState({
    ...data,
    primaryColor: data.brand.primaryColor ?? "#1e3a5f",
    accentColor: data.brand.accentColor ?? "#c8a24a",
    headline: data.brand.headline ?? "",
    subheadline: data.brand.subheadline ?? "",
    trustPoints: (data.brand.trustPoints ?? []).join("\n"),
    threshold: data.highValueThresholdCents === null ? "" : String(data.highValueThresholdCents / 100),
    glossaryText: data.glossary.map((g) => `${g.term}: ${g.definition}`).join("\n"),
  });
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("MEMBER");
  const set = (k: keyof typeof s) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const orNull = (v: string | null) => (v ? v : null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "green", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof ApiError ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const glossary = s.glossaryText
      .split("\n")
      .map((l) => l.split(/:(.+)/))
      .filter((p) => p[0]?.trim() && p[1]?.trim())
      .map(([term, definition]) => ({ term: term.trim(), definition: definition.trim() }));
    void run(
      () =>
        api(`/api/orgs/${data.slug}`, {
          method: "PATCH",
          json: {
            name: s.name,
            templateKey: s.templateKey,
            logoUrl: orNull(s.logoUrl),
            timezone: s.timezone,
            contactEmail: orNull(s.contactEmail),
            contactPhone: orNull(s.contactPhone),
            website: orNull(s.website),
            notificationEmail: orNull(s.notificationEmail),
            bookingUrl: orNull(s.bookingUrl),
            highValueThresholdCents: s.threshold === "" ? null : Math.round(Number(s.threshold) * 100),
            quoteValidityDays: Number(s.quoteValidityDays),
            brand: {
              primaryColor: s.primaryColor,
              accentColor: s.accentColor,
              headline: s.headline,
              subheadline: s.subheadline,
              trustPoints: s.trustPoints.split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 6),
            },
            glossary,
          },
        }),
      "Settings saved. Your quote page is updated.",
    );
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-6">
        <Card title="Template">
          <p className="mb-3 text-sm text-slate-500">Switch the visitor experience without touching services, questions or pricing. Preview links open the live page with that template.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {templates.map((t) => (
              <div key={t.key} className={cn("rounded-lg border p-4", s.templateKey === t.key ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200")}>
                <button type="button" onClick={() => setS({ ...s, templateKey: t.key })} className="w-full text-left">
                  <span className="flex items-center justify-between">
                    <span className="font-medium">{t.name}</span>
                    {data.templateKey === t.key && <Badge tone="green">Live</Badge>}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{t.description}</span>
                </button>
                <a className="mt-2 inline-block text-xs font-medium text-sky-700 hover:underline" href={`/q/${data.slug}?template=${t.key}`} target="_blank" rel="noreferrer">Preview ↗</a>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Branding">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name"><Input value={s.name} onChange={set("name")} required /></Field>
            <Field label="Logo URL"><Input type="url" value={s.logoUrl ?? ""} onChange={set("logoUrl")} placeholder="https://…" /></Field>
            <Field label="Primary color"><Input type="color" value={s.primaryColor} onChange={set("primaryColor")} className="h-10 p-1" /></Field>
            <Field label="Accent color"><Input type="color" value={s.accentColor} onChange={set("accentColor")} className="h-10 p-1" /></Field>
            <Field label="Headline" className="sm:col-span-2"><Input value={s.headline} onChange={set("headline")} maxLength={160} /></Field>
            <Field label="Sub-headline" className="sm:col-span-2"><Input value={s.subheadline} onChange={set("subheadline")} maxLength={400} /></Field>
            <Field label="Trust points" hint="One per line (max 6)" className="sm:col-span-2"><Textarea value={s.trustPoints} onChange={set("trustPoints")} /></Field>
          </div>
        </Card>
        <Card title="Contact, notifications & follow-up">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Public contact email"><Input type="email" value={s.contactEmail ?? ""} onChange={set("contactEmail")} /></Field>
            <Field label="Public phone"><Input value={s.contactPhone ?? ""} onChange={set("contactPhone")} /></Field>
            <Field label="Website"><Input type="url" value={s.website ?? ""} onChange={set("website")} /></Field>
            <Field label="Lead notification email" hint="Receives new-lead and needs-review alerts. Defaults to owners/admins."><Input type="email" value={s.notificationEmail ?? ""} onChange={set("notificationEmail")} /></Field>
            <Field label="Booking link" hint="Calendly, Cal.com or similar - used by the booking-link automation"><Input type="url" value={s.bookingUrl ?? ""} onChange={set("bookingUrl")} /></Field>
            <Field label={`High-value threshold (${data.currency})`} hint="Leads at or above this estimated value fire the High-value lead trigger"><Input type="number" min={0} value={s.threshold} onChange={set("threshold")} /></Field>
            <Field label="Quote validity (days)"><Input type="number" min={1} max={365} value={String(s.quoteValidityDays)} onChange={set("quoteValidityDays")} /></Field>
            <Field label="Timezone"><Input value={s.timezone} onChange={set("timezone")} /></Field>
          </div>
        </Card>
        <Card title="Assistant glossary">
          <Field label="Terms the quote assistant can explain to visitors" hint="One per line: Term: plain-language definition">
            <Textarea value={s.glossaryText} onChange={set("glossaryText")} className="min-h-40 text-xs" />
          </Field>
        </Card>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" disabled={busy}>Save settings</Button>
      </form>

      <Card title="Team">
        <ul className="divide-y divide-slate-100 text-sm">
          {members.map((m) => (
            <li key={m.email} className="flex items-center justify-between py-2">
              <span>{m.name} <span className="text-slate-500">{m.email}</span></span>
              <Badge>{m.role.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
        {canManageOwnerSettings && (
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(`/api/orgs/${data.slug}/members`, { method: "POST", json: { email: memberEmail, role: memberRole } }), "Team member added.");
            }}
          >
            <Field label="Add an existing QuoteOS user"><Input type="email" required value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} className="!w-64" /></Field>
            <Select value={memberRole} onChange={(e) => setMemberRole(e.target.value)} className="!w-32"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select>
            <Button type="submit" variant="secondary" disabled={busy}>Add</Button>
          </form>
        )}
      </Card>

      {canManageOwnerSettings && (
        <Card title="Booking webhook">
          <p className="text-sm text-slate-600">
            POST booking events to <code className="rounded bg-slate-100 px-1 text-xs">/api/webhooks/booking/{data.slug}</code> signed with HMAC-SHA256: header <code className="text-xs">x-quoteos-timestamp</code> (unix seconds) and <code className="text-xs">x-quoteos-signature: sha256=HMAC(secret, timestamp + &quot;.&quot; + body)</code>.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => confirm("Rotate the webhook secret? Existing integrations will stop working until updated.") && run(async () => setSecret((await api<{ webhookSecret: string }>(`/api/orgs/${data.slug}/webhook-secret`, { method: "POST" })).webhookSecret), "Secret rotated - copy it now, it is not shown again.")}>
              Rotate secret
            </Button>
            {secret && <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{secret}</code>}
          </div>
        </Card>
      )}
    </div>
  );
}
