"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { describeLeadRule, LEAD_INTENTS } from "@/core/leads";
import { describeCondition } from "@/core/conditions";
import { describeRule } from "@/core/pricing";
import { AUTOMATION_TRIGGERS, type AutomationAction } from "@/core/config/schema";
import { titleCase, formatMoney } from "@/lib/format";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { ConditionBuilder, LEAD_META_FIELDS, META_FIELDS, type ConditionField } from "./condition-builder";

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { errors?: string[] } | undefined)?.errors : undefined;
      setError(e instanceof ApiError ? [e.message, ...(details ?? [])].join(" · ") : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return { save, busy, error };
}

// ---------------------------------------------------------------------------
// Qualification (lead rules)
// ---------------------------------------------------------------------------

export interface LeadRuleRow {
  id: string;
  name: string;
  serviceSlug: string | null;
  priority: number;
  condition: unknown;
  action: unknown;
  active: boolean;
}

export function LeadRulesEditor({ orgSlug, rules, services, answerFields }: { orgSlug: string; rules: LeadRuleRow[]; services: { slug: string; name: string }[]; answerFields: ConditionField[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const fields = [...META_FIELDS, ...answerFields];
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  return (
    <div className="space-y-3">
      {rules.map((r) =>
        editing === r.id ? (
          <Card key={r.id} title={`Edit: ${r.name}`}>
            <LeadRuleForm orgSlug={orgSlug} rule={r} services={services} fields={fields} onDone={() => setEditing(null)} />
          </Card>
        ) : (
          <div key={r.id} className={cn("flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm", !r.active && "opacity-60")}>
            <span className="mt-0.5 w-10 shrink-0 text-center text-xs text-slate-400">#{r.priority}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.name} {r.serviceSlug && <Badge>{r.serviceSlug}</Badge>}</p>
              <p className="mt-1 font-mono text-xs text-slate-600">{describeLeadRule(r, labels)}</p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(r.id)}>Edit</Button>
          </div>
        ),
      )}
      {editing === "new" ? (
        <Card title="New qualification rule">
          <LeadRuleForm orgSlug={orgSlug} services={services} fields={fields} onDone={() => setEditing(null)} />
        </Card>
      ) : (
        <Button onClick={() => setEditing("new")}>+ Add rule</Button>
      )}
    </div>
  );
}

function LeadRuleForm({ orgSlug, rule, services, fields, onDone }: { orgSlug: string; rule?: LeadRuleRow; services: { slug: string; name: string }[]; fields: ConditionField[]; onDone: () => void }) {
  const a = (rule?.action ?? { type: "ADD_SCORE", points: 10 }) as Record<string, unknown>;
  const [name, setName] = useState(rule?.name ?? "");
  const [serviceSlug, setService] = useState(rule?.serviceSlug ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [active, setActive] = useState(rule?.active ?? true);
  const [condition, setCondition] = useState<unknown>(rule?.condition ?? null);
  const [type, setType] = useState(String(a.type));
  const [points, setPoints] = useState(String(a.points ?? 10));
  const [intent, setIntent] = useState(String(a.intent ?? "HIGH"));
  const [email, setEmail] = useState(String(a.email ?? ""));
  const [tag, setTag] = useState(String(a.tag ?? ""));
  const { save, busy, error } = useSave();
  const action =
    type === "ADD_SCORE" ? { type, points: Number(points) }
    : type === "SET_INTENT" ? { type, intent }
    : type === "ASSIGN_TO" ? { type, email }
    : type === "TAG" ? { type, tag }
    : { type: "NEEDS_REVIEW" };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { name, serviceSlug: serviceSlug || null, priority: Number(priority), active, condition, action };
    void save(() => (rule ? api(`/api/orgs/${orgSlug}/lead-rules/${rule.id}`, { method: "PATCH", json: body }) : api(`/api/orgs/${orgSlug}/lead-rules`, { method: "POST", json: body })), onDone);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Service">
          <Select value={serviceSlug} onChange={(e) => setService(e.target.value)}>
            <option value="">All services</option>
            {services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority"><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
        <div className="flex items-end pb-2"><Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} /></div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">If</p>
        <ConditionBuilder value={condition} onChange={setCondition} fields={fields} emptyLabel="Applies to every lead." />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Then</p>
        <div className="flex flex-wrap items-end gap-3">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-56">
            <option value="ADD_SCORE">Add score points</option>
            <option value="SET_INTENT">Set intent</option>
            <option value="ASSIGN_TO">Assign to team member</option>
            <option value="NEEDS_REVIEW">Mark as needs review</option>
            <option value="TAG">Add a tag</option>
          </Select>
          {type === "ADD_SCORE" && <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="!w-28" aria-label="Points" />}
          {type === "SET_INTENT" && <Select value={intent} onChange={(e) => setIntent(e.target.value)} className="!w-36">{LEAD_INTENTS.map((i) => <option key={i}>{i}</option>)}</Select>}
          {type === "ASSIGN_TO" && <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@firm.com" className="!w-64" />}
          {type === "TAG" && <Input required value={tag} onChange={(e) => setTag(e.target.value)} className="!w-48" />}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>Save rule</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {rule && <Button type="button" variant="danger" className="ml-auto" onClick={() => confirm("Delete rule?") && save(() => api(`/api/orgs/${orgSlug}/lead-rules/${rule.id}`, { method: "DELETE" }), onDone)}>Delete</Button>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Automations & message templates
// ---------------------------------------------------------------------------

export interface AutomationRow { id: string; name: string; trigger: string; condition: unknown; actions: unknown; active: boolean }
export interface TemplateRow { id: string; key: string; channel: string; name: string; subject: string | null; body: string }
export interface RunRow { id: string; name: string; status: string; trigger: string; error: string | null; createdAt: string }

const ACTION_TYPES = ["SEND_EMAIL", "SEND_WHATSAPP", "SEND_SMS", "NOTIFY_USER", "CREATE_TASK", "CREATE_CRM_RECORD", "BOOKING_LINK"] as const;

function describeAutomationAction(a: AutomationAction): string {
  switch (a.type) {
    case "SEND_EMAIL": return `Email "${a.templateKey}" to ${a.to}`;
    case "SEND_WHATSAPP": return `WhatsApp "${a.templateKey}" to ${a.to}`;
    case "SEND_SMS": return `SMS "${a.templateKey}" to ${a.to}`;
    case "NOTIFY_USER": return `Notify the team${a.templateKey ? ` using "${a.templateKey}"` : ""}`;
    case "CREATE_TASK": return `Create task "${a.title}"${a.dueInHours !== undefined ? ` due in ${a.dueInHours}h` : ""}`;
    case "CREATE_CRM_RECORD": return "Create CRM record";
    case "BOOKING_LINK": return `Send booking link ("${a.templateKey}")`;
  }
}

export function AutomationsEditor({ orgSlug, automations, templates, runs }: { orgSlug: string; automations: AutomationRow[]; templates: TemplateRow[]; runs: RunRow[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { save, busy, error } = useSave();
  const labels = Object.fromEntries(LEAD_META_FIELDS.map((f) => [f.key, f.label]));
  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {automations.map((a) =>
        editing === a.id ? (
          <Card key={a.id} title={`Edit: ${a.name}`}>
            <AutomationForm orgSlug={orgSlug} automation={a} templates={templates} onDone={() => setEditing(null)} />
          </Card>
        ) : (
          <div key={a.id} className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", !a.active && "opacity-60")}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  When <Badge tone="violet">{titleCase(a.trigger)}</Badge>
                  {a.condition != null && <> and {describeCondition(a.condition, labels)}</>}
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                  {(a.actions as AutomationAction[]).map((x, i) => <li key={i}>{describeAutomationAction(x)}</li>)}
                </ul>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" disabled={busy} onClick={() => save(() => api(`/api/orgs/${orgSlug}/automations/${a.id}`, { method: "PATCH", json: { name: a.name, trigger: a.trigger, condition: a.condition, actions: a.actions, active: !a.active } }))}>
                  {a.active ? "Pause" : "Enable"}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(a.id)}>Edit</Button>
              </div>
            </div>
          </div>
        ),
      )}
      {editing === "new" ? (
        <Card title="New automation"><AutomationForm orgSlug={orgSlug} templates={templates} onDone={() => setEditing(null)} /></Card>
      ) : (
        <Button onClick={() => setEditing("new")}>+ Add automation</Button>
      )}

      <div className="pt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Message templates</h2>
        <TemplatesEditor orgSlug={orgSlug} templates={templates} />
      </div>

      <div className="pt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent runs</h2>
        <Card padded={false}>
          <ul className="divide-y divide-slate-100 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge tone={r.status === "SUCCEEDED" ? "green" : r.status === "FAILED" ? "red" : "slate"}>{r.status.toLowerCase()}</Badge>
                <span className="flex-1 truncate">{r.name}</span>
                {r.error && <span className="truncate text-xs text-red-600">{r.error}</span>}
                <span className="text-xs text-slate-500">{r.createdAt}</span>
              </li>
            ))}
            {!runs.length && <li className="px-4 py-6 text-center text-slate-400">No runs yet</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AutomationForm({ orgSlug, automation, templates, onDone }: { orgSlug: string; automation?: AutomationRow; templates: TemplateRow[]; onDone: () => void }) {
  const [name, setName] = useState(automation?.name ?? "");
  const [trigger, setTrigger] = useState(automation?.trigger ?? "LEAD_CREATED");
  const [active, setActive] = useState(automation?.active ?? true);
  const [condition, setCondition] = useState<unknown>(automation?.condition ?? null);
  const [actions, setActions] = useState<Record<string, unknown>[]>((automation?.actions as Record<string, unknown>[]) ?? [{ type: "NOTIFY_USER" }]);
  const { save, busy, error } = useSave();
  const setAction = (i: number, patch: Record<string, unknown>) => setActions(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const channelFor = (t: string) => (t === "SEND_WHATSAPP" ? "WHATSAPP" : t === "SEND_SMS" ? "SMS" : "EMAIL");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = actions.map((a) => {
      const t = a.type as string;
      if (t === "CREATE_TASK") return { type: t, title: a.title || "Follow up with {{lead.name}}", ...(a.dueInHours !== undefined && a.dueInHours !== "" ? { dueInHours: Number(a.dueInHours) } : {}) };
      if (t === "CREATE_CRM_RECORD") return { type: t };
      if (t === "NOTIFY_USER") return { type: t, ...(a.templateKey ? { templateKey: a.templateKey } : {}) };
      if (t === "BOOKING_LINK") return { type: t, templateKey: a.templateKey };
      return { type: t, to: a.to ?? "lead", templateKey: a.templateKey };
    });
    const body = { name, trigger, condition, actions: clean, active };
    void save(() => (automation ? api(`/api/orgs/${orgSlug}/automations/${automation.id}`, { method: "PATCH", json: body }) : api(`/api/orgs/${orgSlug}/automations`, { method: "POST", json: body })), onDone);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto]">
        <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Trigger"><Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>{AUTOMATION_TRIGGERS.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
        <div className="flex items-end pb-2"><Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} /></div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Only if (optional)</p>
        <ConditionBuilder value={condition} onChange={setCondition} fields={LEAD_META_FIELDS} emptyLabel="Runs every time the trigger fires." />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions (run in order)</p>
        <div className="space-y-2">
          {actions.map((a, i) => {
            const t = a.type as string;
            const tpl = templates.filter((x) => x.channel === channelFor(t));
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <Select value={t} onChange={(e) => setAction(i, { type: e.target.value })} className="!w-52">{ACTION_TYPES.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select>
                {(t === "SEND_EMAIL" || t === "SEND_WHATSAPP" || t === "SEND_SMS") && (
                  <Select value={String(a.to ?? "lead")} onChange={(e) => setAction(i, { to: e.target.value })} className="!w-36">
                    <option value="lead">Lead</option>
                    <option value="owner">Lead owner</option>
                    <option value="staff">Staff</option>
                  </Select>
                )}
                {(t === "SEND_EMAIL" || t === "SEND_WHATSAPP" || t === "SEND_SMS" || t === "BOOKING_LINK" || t === "NOTIFY_USER") && (
                  <Select value={String(a.templateKey ?? "")} onChange={(e) => setAction(i, { templateKey: e.target.value || undefined })} className="!w-56" required={t !== "NOTIFY_USER"}>
                    <option value="">{t === "NOTIFY_USER" ? "Default notification" : "Choose template…"}</option>
                    {tpl.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                  </Select>
                )}
                {t === "CREATE_TASK" && (
                  <>
                    <Input value={String(a.title ?? "")} onChange={(e) => setAction(i, { title: e.target.value })} placeholder="Call {{lead.name}}" className="!w-72" />
                    <Input type="number" min={0} value={String(a.dueInHours ?? "")} onChange={(e) => setAction(i, { dueInHours: e.target.value })} placeholder="Due in hours" className="!w-32" />
                  </>
                )}
                <button type="button" onClick={() => setActions(actions.filter((_, j) => j !== i))} className="ml-auto px-2 text-slate-400 hover:text-red-600" aria-label="Remove action">✕</button>
              </div>
            );
          })}
          <Button type="button" variant="secondary" onClick={() => setActions([...actions, { type: "SEND_EMAIL", to: "lead" }])}>+ Add action</Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !actions.length}>Save automation</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {automation && <Button type="button" variant="danger" className="ml-auto" onClick={() => confirm("Delete automation?") && save(() => api(`/api/orgs/${orgSlug}/automations/${automation.id}`, { method: "DELETE" }), onDone)}>Delete</Button>}
      </div>
    </form>
  );
}

function TemplatesEditor({ orgSlug, templates }: { orgSlug: string; templates: TemplateRow[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <div className="space-y-2">
      {templates.map((t) =>
        editing === t.id ? (
          <Card key={t.id} title={`Edit template: ${t.name}`}><TemplateForm orgSlug={orgSlug} template={t} onDone={() => setEditing(null)} /></Card>
        ) : (
          <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <Badge tone={t.channel === "EMAIL" ? "blue" : "green"}>{t.channel.toLowerCase()}</Badge>
            <span className="flex-1 truncate text-sm"><span className="font-medium">{t.name}</span> <code className="text-xs text-slate-400">{t.key}</code></span>
            <Button variant="secondary" onClick={() => setEditing(t.id)}>Edit</Button>
          </div>
        ),
      )}
      {editing === "new" ? <Card title="New template"><TemplateForm orgSlug={orgSlug} onDone={() => setEditing(null)} /></Card> : <Button variant="secondary" onClick={() => setEditing("new")}>+ Add template</Button>}
    </div>
  );
}

function TemplateForm({ orgSlug, template, onDone }: { orgSlug: string; template?: TemplateRow; onDone: () => void }) {
  const [t, setT] = useState({ key: template?.key ?? "", name: template?.name ?? "", channel: template?.channel ?? "EMAIL", subject: template?.subject ?? "", body: template?.body ?? "" });
  const { save, busy, error } = useSave();
  const set = (k: keyof typeof t) => (e: { target: { value: string } }) => setT({ ...t, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...t, subject: t.channel === "EMAIL" ? t.subject || null : null };
        void save(() => (template ? api(`/api/orgs/${orgSlug}/message-templates/${template.id}`, { method: "PATCH", json: body }) : api(`/api/orgs/${orgSlug}/message-templates`, { method: "POST", json: body })), onDone);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input required value={t.name} onChange={set("name")} /></Field>
        <Field label="Key"><Input required value={t.key} onChange={set("key")} pattern="[a-zA-Z][a-zA-Z0-9_]*" className="font-mono" /></Field>
        <Field label="Channel"><Select value={t.channel} onChange={set("channel")}><option>EMAIL</option><option>WHATSAPP</option><option>SMS</option></Select></Field>
      </div>
      {t.channel === "EMAIL" && <Field label="Subject"><Input value={t.subject} onChange={set("subject")} /></Field>}
      <Field label="Body" hint="Placeholders: {{lead.firstName}} {{lead.name}} {{lead.company}} {{service.name}} {{quote.estimate}} {{org.name}} {{bookingUrl}} {{lead.source}} {{lead.urgency}} {{dashboardUrl}}">
        <Textarea required value={t.body} onChange={set("body")} className="min-h-40 font-mono text-xs" />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>Save template</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {template && <Button type="button" variant="danger" className="ml-auto" onClick={() => confirm("Delete template?") && save(() => api(`/api/orgs/${orgSlug}/message-templates/${template.id}`, { method: "DELETE" }), onDone)}>Delete</Button>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AI configuration assistant
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  prompt: string;
  status: string;
  provider: string;
  explanation: string | null;
  createdAt: string;
  updatesExisting: string[];
  proposal: { services: { slug: string; name: string; quoteMode: string; basePriceCents: number; billingPeriod: string; questions: { key: string; label: string; type: string; visibleWhen?: unknown }[]; pricingRules: { key: string; name: string; priority: number; condition?: unknown; action: unknown }[] }[] };
}

export function AiAssistant({ orgSlug, services, proposals, currency }: { orgSlug: string; services: { id: string; name: string }[]; proposals: ProposalRow[]; currency: string }) {
  const [prompt, setPrompt] = useState("");
  const [serviceId, setServiceId] = useState("");
  const { save, busy, error } = useSave();
  return (
    <div className="space-y-6">
      <Card title="Describe your pricing in plain English">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(() => api(`/api/orgs/${orgSlug}/ai/proposals`, { method: "POST", json: { prompt, serviceId: serviceId || null } }), () => setPrompt(""));
          }}
        >
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='e.g. "Bookkeeping starts at $300 a month and goes up depending on transaction volume and payroll. Payroll adds $120."' className="min-h-28" required minLength={10} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Apply to">
              <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="!w-64">
                <option value="">A new service</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} (update)</option>)}
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Thinking…" : "Generate proposal"}</Button>
          </div>
          <p className="text-xs text-slate-500">The assistant only proposes structured configuration. Nothing changes until you approve it, and prices are always calculated by the deterministic rules engine.</p>
          {error && <Alert>{error}</Alert>}
        </form>
      </Card>
      {proposals.map((p) => (
        <Card
          key={p.id}
          title={<span className="flex items-center gap-2">Proposal <Badge tone={p.status === "PENDING" ? "amber" : p.status === "APPROVED" ? "green" : "slate"}>{p.status.toLowerCase()}</Badge><span className="text-xs font-normal text-slate-500">{p.createdAt} · {p.provider}</span></span>}
        >
          <p className="text-sm italic text-slate-600">“{p.prompt}”</p>
          {p.explanation && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{p.explanation}</p>}
          {p.proposal.services.map((s) => {
            const labels = Object.fromEntries(s.questions.map((q) => [q.key, q.label]));
            return (
              <div key={s.slug} className="mt-4 rounded-lg border border-slate-200 p-4">
                <p className="font-medium">
                  {s.name} <Badge>{titleCase(s.quoteMode)}</Badge> {p.updatesExisting.includes(s.slug) && <Badge tone="amber">updates existing service</Badge>}
                </p>
                <p className="mt-1 text-sm text-slate-600">Base price {formatMoney(s.basePriceCents, currency)} · {titleCase(s.billingPeriod)}</p>
                {s.questions.length > 0 && (
                  <>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</p>
                    <ul className="mt-1 list-disc pl-5 text-sm">{s.questions.map((q) => <li key={q.key}>{q.label} <code className="text-xs text-slate-400">{q.key} · {q.type}</code></li>)}</ul>
                  </>
                )}
                {s.pricingRules.length > 0 && (
                  <>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pricing rules</p>
                    <ul className="mt-1 space-y-1 font-mono text-xs text-slate-700">{s.pricingRules.map((r) => <li key={r.key}>{r.name}: {describeRule(r, currency, labels)}</li>)}</ul>
                  </>
                )}
              </div>
            );
          })}
          {p.status === "PENDING" && (
            <div className="mt-4 flex gap-2">
              <Button disabled={busy} onClick={() => save(() => api(`/api/orgs/${orgSlug}/ai/proposals/${p.id}`, { method: "POST", json: { approve: true } }))}>Approve & apply</Button>
              <Button variant="secondary" disabled={busy} onClick={() => save(() => api(`/api/orgs/${orgSlug}/ai/proposals/${p.id}`, { method: "POST", json: { approve: false } }))}>Reject</Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export function ImportExport({ orgSlug }: { orgSlug: string }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [check, setCheck] = useState<{ ok: boolean; errors: string[]; warnings: string[]; services: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { save, busy, error } = useSave();
  const parse = () => {
    try {
      return JSON.parse(text);
    } catch {
      setCheck({ ok: false, errors: ["The file is not valid JSON"], warnings: [], services: [] });
      return undefined;
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Export">
        <p className="text-sm text-slate-600">Download services, questions, conditions, pricing rules, qualification rules, message templates, automations and branding as portable JSON. Use it as a backup, or as a recipe for new clients.</p>
        <a href={`/api/orgs/${orgSlug}/config`} className="mt-4 inline-flex rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800">Download configuration</a>
      </Card>
      <Card title="Import">
        <div className="space-y-3">
          <Input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setText(await f.text());
                setCheck(null);
              }
            }}
          />
          <Textarea value={text} onChange={(e) => { setText(e.target.value); setCheck(null); }} placeholder="…or paste JSON here" className="min-h-40 font-mono text-xs" />
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as "merge" | "replace")}>
              <option value="merge">Merge - add and update, keep everything else</option>
              <option value="replace">Replace - also remove config not in the file (services are deactivated, never deleted)</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy || !text} onClick={() => { const c = parse(); if (c !== undefined) void save(async () => setCheck(await api(`/api/orgs/${orgSlug}/config`, { method: "POST", json: { dryRun: true, config: c } }))); }}>Validate</Button>
            <Button
              disabled={busy || !check?.ok}
              onClick={() => {
                const c = parse();
                if (c !== undefined && confirm(`Apply this configuration in ${mode} mode? Existing quotes are not affected.`))
                  void save(async () => {
                    const r = await api<{ services: { slug: string }[] }>(`/api/orgs/${orgSlug}/config`, { method: "POST", json: { mode, config: c } });
                    setDone(`Imported ${r.services.length} services.`);
                  });
              }}
            >
              Import
            </Button>
          </div>
          {check && (check.ok ? <Alert tone="green">Valid · services: {check.services.join(", ") || "none"}</Alert> : <Alert>{check.errors.join(" · ")}</Alert>)}
          {!!check?.warnings.length && <Alert tone="amber">{check.warnings.join(" · ")}</Alert>}
          {done && <Alert tone="green">{done}</Alert>}
          {error && <Alert>{error}</Alert>}
        </div>
      </Card>
    </div>
  );
}
