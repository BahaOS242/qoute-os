"use client";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { describeCondition } from "@/core/conditions";
import { describeRule, formatMoney, PRICING_ACTION_TYPES, type PricingActionType } from "@/core/pricing";
import { QUESTION_TYPES, getVisibleQuestions, type QuestionDef } from "@/core/questions";
import { QUOTE_MODES, BILLING_PERIODS, type QuoteOutcome } from "@/core/quote";
import { BILLING_LABEL, titleCase } from "@/lib/format";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { QuestionInput, type FunnelTheme } from "@/components/funnel/parts";
import { ConditionBuilder, type ConditionField } from "./condition-builder";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

export interface ServiceData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  inclusions: string[];
  assumptions: string[];
  active: boolean;
  quoteMode: string;
  basePriceCents: number;
  minimumPriceCents: number | null;
  billingPeriod: string;
  estimateRangePercent: number | null;
  order: number;
}
export type QuestionData = QuestionDef & { id: string };
export interface RuleData {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priority: number;
  condition: unknown;
  action: unknown;
  active: boolean;
}

const toCents = (dollars: string) => Math.round(Number(dollars || 0) * 100);
const toDollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : String(cents / 100));
const toKey = (s: string) => {
  const parts = s.replace(/[^a-zA-Z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const k = parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase())).join("");
  return /^[a-zA-Z]/.test(k) ? k.slice(0, 60) : `q${k}`.slice(0, 60);
};
const toSnake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "r_$1").slice(0, 60) || "rule";

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
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return { save, busy, error, setError };
}

const adminTheme: FunnelTheme = {
  optionsGrid: "flex flex-wrap gap-2",
  option: "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50",
  optionSelected: "!border-slate-900 !bg-slate-900 !text-white",
  input: "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm",
  label: "text-sm font-medium text-slate-700",
  help: "text-xs text-slate-500",
  error: "text-red-600",
  primaryButton: "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white",
  secondaryButton: "rounded-lg border border-slate-300 px-3 py-2 text-sm",
  muted: "text-slate-500",
};

// ---------------------------------------------------------------------------
// Create service
// ---------------------------------------------------------------------------

export function CreateServiceForm({ orgSlug, currency }: { orgSlug: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [quoteMode, setMode] = useState("INSTANT");
  const [billingPeriod, setBilling] = useState("MONTHLY");
  const [base, setBase] = useState("");
  const { save, busy, error } = useSave();
  if (!open) return <Button onClick={() => setOpen(true)}>+ New service</Button>;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (
    <Card title="New service">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(async () => {
            const s = await api<{ id: string }>(`/api/orgs/${orgSlug}/services`, { method: "POST", json: { name, slug, quoteMode, billingPeriod, basePriceCents: toCents(base) } });
            router.push(`/dashboard/${orgSlug}/services/${s.id}`);
          });
        }}
      >
        <Field label="Name" hint={slug ? `Slug: ${slug}` : undefined}><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Quote mode">
          <Select value={quoteMode} onChange={(e) => setMode(e.target.value)}>{QUOTE_MODES.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select>
        </Field>
        <Field label={`Base price (${currency})`}><Input type="number" min={0} step="0.01" value={base} onChange={(e) => setBase(e.target.value)} /></Field>
        <Field label="Billing">
          <Select value={billingPeriod} onChange={(e) => setBilling(e.target.value)}>{BILLING_PERIODS.map((b) => <option key={b} value={b}>{BILLING_LABEL[b]}</option>)}</Select>
        </Field>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy || !slug}>Create service</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Editor shell
// ---------------------------------------------------------------------------

const TABS = ["Questions", "Pricing rules", "Test", "Settings"] as const;

export function ServiceEditor(props: {
  orgSlug: string;
  currency: string;
  canEdit: boolean;
  service: ServiceData;
  questions: QuestionData[];
  rules: RuleData[];
  issues: { questionKey: string; message: string }[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Questions");
  const priced = props.service.quoteMode === "INSTANT" || props.service.quoteMode === "ESTIMATE";
  return (
    <div>
      {props.issues.length > 0 && (
        <div className="mb-4">
          <Alert tone="amber">
            <p className="font-medium">Configuration warnings</p>
            <ul className="mt-1 list-disc pl-5">{props.issues.map((i, n) => <li key={n}>{i.questionKey}: {i.message}</li>)}</ul>
          </Alert>
        </div>
      )}
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t}
            {t === "Questions" && <span className="ml-1.5 text-xs text-slate-400">{props.questions.length}</span>}
            {t === "Pricing rules" && <span className="ml-1.5 text-xs text-slate-400">{props.rules.length}</span>}
          </button>
        ))}
      </div>
      {tab === "Questions" && <QuestionsPanel {...props} />}
      {tab === "Pricing rules" &&
        (priced ? (
          <RulesPanel {...props} />
        ) : (
          <Alert tone="blue">
            This service uses <strong>{titleCase(props.service.quoteMode)}</strong>, so it never shows a price and pricing rules are not evaluated. Change the quote mode in Settings to enable automated pricing.
          </Alert>
        ))}
      {tab === "Test" && <TestPanel {...props} />}
      {tab === "Settings" && <SettingsPanel {...props} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function QuestionsPanel({ orgSlug, service, questions, canEdit }: { orgSlug: string; service: ServiceData; questions: QuestionData[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [order, setOrder] = useState(questions.map((q) => q.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const { save, busy, error } = useSave();
  const byId = new Map(questions.map((q) => [q.id, q]));
  // Keep local order in sync after server refreshes.
  const ids = questions.map((q) => q.id).join();
  const [syncedIds, setSyncedIds] = useState(ids);
  if (ids !== syncedIds) {
    setSyncedIds(ids);
    setOrder(questions.map((q) => q.id));
  }
  const ordered = order.map((id) => byId.get(id)).filter((q): q is QuestionData => !!q);
  const labels = Object.fromEntries(questions.map((q) => [q.key, q.label]));

  const persist = (next: string[]) => {
    setOrder(next);
    void save(() => api(`/api/orgs/${orgSlug}/services/${service.id}/questions/reorder`, { method: "POST", json: { order: next } }));
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Visitors see one question per step, in this order. Drag to reorder. Conditions can only depend on earlier questions.</p>
      {error && <Alert>{error}</Alert>}
      <ol className="space-y-2">
        {ordered.map((q, idx) => (
          <li
            key={q.id}
            draggable={canEdit && editing === null}
            onDragStart={() => setDragging(q.id)}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragging || dragging === q.id) return;
              const next = order.filter((x) => x !== dragging);
              next.splice(next.indexOf(q.id) + (order.indexOf(dragging) < order.indexOf(q.id) ? 1 : 0), 0, dragging);
              setOrder(next);
            }}
            onDragEnd={() => {
              setDragging(null);
              persist(order);
            }}
            className={cn("rounded-xl border bg-white shadow-sm", dragging === q.id ? "border-slate-400 opacity-60" : "border-slate-200")}
          >
            {editing === q.id ? (
              <div className="p-4">
                <QuestionForm orgSlug={orgSlug} serviceId={service.id} question={q} earlier={ordered.slice(0, idx)} onDone={() => setEditing(null)} />
              </div>
            ) : (
              <div className="flex items-start gap-3 p-4">
                {canEdit && <span aria-hidden className="mt-0.5 cursor-grab select-none text-slate-300">⋮⋮</span>}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">
                    <span className="mr-2 text-xs text-slate-400">{idx + 1}.</span>
                    {q.label}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <Badge>{titleCase(q.type)}</Badge>
                    <code className="text-slate-400">{q.key}</code>
                    {q.required ? <Badge tone="blue">Required</Badge> : <Badge>Optional</Badge>}
                    {q.active === false && <Badge tone="red">Hidden</Badge>}
                    {q.leadField && <Badge tone="violet">→ lead {q.leadField}</Badge>}
                    {!!q.options?.length && <span>{q.options.length} options</span>}
                  </p>
                  {q.visibleWhen != null && <p className="mt-1.5 text-xs text-amber-800">Shown only if {describeCondition(q.visibleWhen, labels)}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" className="px-2" disabled={busy || idx === 0} onClick={() => move(q.id, -1)} aria-label="Move up">↑</Button>
                    <Button variant="ghost" className="px-2" disabled={busy || idx === ordered.length - 1} onClick={() => move(q.id, 1)} aria-label="Move down">↓</Button>
                    <Button variant="secondary" onClick={() => setEditing(q.id)}>Edit</Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {canEdit &&
        (editing === "new" ? (
          <Card title="New question">
            <QuestionForm orgSlug={orgSlug} serviceId={service.id} earlier={ordered} onDone={() => setEditing(null)} />
          </Card>
        ) : (
          <Button onClick={() => setEditing("new")}>+ Add question</Button>
        ))}
    </div>
  );
}

function QuestionForm({ orgSlug, serviceId, question, earlier, onDone }: { orgSlug: string; serviceId: string; question?: QuestionData; earlier: QuestionData[]; onDone: () => void }) {
  const [label, setLabel] = useState(question?.label ?? "");
  const [key, setKey] = useState(question?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(!!question);
  const [helpText, setHelp] = useState(question?.helpText ?? "");
  const [type, setType] = useState<string>(question?.type ?? "SINGLE_SELECT");
  const [required, setRequired] = useState(question?.required ?? true);
  const [active, setActive] = useState(question?.active ?? true);
  const [leadField, setLeadField] = useState(question?.leadField ?? "");
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(question?.config ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [options, setOptions] = useState<{ label: string; value: string }[]>(question?.options?.map((o) => ({ label: o.label, value: o.value })) ?? []);
  const [visibleWhen, setVisibleWhen] = useState<unknown>(question?.visibleWhen ?? null);
  const { save, busy, error } = useSave();
  const isSelect = type === "SINGLE_SELECT" || type === "MULTI_SELECT";
  const isNumeric = type === "NUMBER" || type === "CURRENCY" || type === "RANGE";
  const fields: ConditionField[] = earlier.map((q) => ({ key: q.key, label: q.label, type: q.type, options: q.options }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cfg: Record<string, unknown> = {};
    for (const k of ["min", "max", "step", "maxLength"]) if (config[k]) cfg[k] = Number(config[k]);
    for (const k of ["unit", "placeholder"]) if (config[k]) cfg[k] = config[k];
    const body = {
      key: key || toKey(label),
      label,
      helpText: helpText || null,
      type,
      required,
      active,
      leadField: leadField || null,
      config: cfg,
      options: isSelect ? options.filter((o) => o.label).map((o) => ({ label: o.label, value: o.value || toSnake(o.label) })) : [],
      visibleWhen,
    };
    void save(
      () =>
        question
          ? api(`/api/orgs/${orgSlug}/questions/${question.id}`, { method: "PATCH", json: body })
          : api(`/api/orgs/${orgSlug}/services/${serviceId}/questions`, { method: "POST", json: body }),
      onDone,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label="Question (as the visitor sees it)">
          <Input required value={label} onChange={(e) => { setLabel(e.target.value); if (!keyTouched) setKey(toKey(e.target.value)); }} />
        </Field>
        <Field label="Key" hint="Used by conditions and pricing rules">
          <Input required value={key} pattern="[a-zA-Z][a-zA-Z0-9_]*" onChange={(e) => { setKeyTouched(true); setKey(e.target.value); }} className="font-mono" />
        </Field>
      </div>
      <Field label="Help text" hint="Plain-language explanation for non-experts (optional)">
        <Input value={helpText} onChange={(e) => setHelp(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Answer type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>
        </Field>
        <Field label="Save answer to lead as">
          <Select value={leadField} onChange={(e) => setLeadField(e.target.value)}>
            <option value="">—</option>
            <option value="industry">Industry</option>
            <option value="urgency">Urgency</option>
            <option value="company">Company</option>
          </Select>
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox label="Required" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
        </div>
      </div>
      {isNumeric && (
        <div className="grid gap-4 sm:grid-cols-4">
          {(["min", "max", "step"] as const).map((k) => (
            <Field key={k} label={titleCase(k)}><Input type="number" value={config[k] ?? ""} onChange={(e) => setConfig({ ...config, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Unit"><Input value={config.unit ?? ""} onChange={(e) => setConfig({ ...config, unit: e.target.value })} placeholder="e.g. employees" /></Field>
        </div>
      )}
      {!isSelect && type !== "BOOLEAN" && type !== "RANGE" && (
        <Field label="Placeholder"><Input value={config.placeholder ?? ""} onChange={(e) => setConfig({ ...config, placeholder: e.target.value })} /></Field>
      )}
      {isSelect && (
        <div>
          <p className="text-sm font-medium text-slate-700">Options</p>
          <div className="mt-2 space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o.label} placeholder="Label" onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input value={o.value} placeholder={toSnake(o.label) || "value"} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="w-48 font-mono" />
                <Button type="button" variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remove option">✕</Button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setOptions([...options, { label: "", value: "" }])}>+ Add option</Button>
          </div>
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-slate-700">Show this question only when…</p>
        <div className="mt-2">
          {fields.length ? (
            <ConditionBuilder value={visibleWhen} onChange={setVisibleWhen} fields={fields} emptyLabel="Always shown." />
          ) : (
            <p className="text-sm text-slate-500">This is the first question, so it is always shown.</p>
          )}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{question ? "Save question" : "Add question"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {question && (
          <Button
            type="button"
            variant="danger"
            className="ml-auto"
            disabled={busy}
            onClick={() => confirm("Delete this question? Existing quotes keep their answers.") && save(() => api(`/api/orgs/${orgSlug}/questions/${question.id}`, { method: "DELETE" }), onDone)}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Pricing rules (no-code rule builder)
// ---------------------------------------------------------------------------

function RulesPanel({ orgSlug, service, questions, rules, currency, canEdit }: { orgSlug: string; service: ServiceData; questions: QuestionData[]; rules: RuleData[]; currency: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const labels = Object.fromEntries(questions.map((q) => [q.key, q.label]));
  const { save, busy, error } = useSave();
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Every quote starts at the base price of <strong className="text-slate-900">{formatMoney(service.basePriceCents, currency)}</strong>
        {service.minimumPriceCents !== null && <> (minimum {formatMoney(service.minimumPriceCents, currency)})</>}. Rules then run from the lowest priority number to the highest; each rule whose condition matches adjusts the running total.
      </div>
      {error && <Alert>{error}</Alert>}
      {rules.map((r) =>
        editing === r.id ? (
          <Card key={r.id} title={`Edit rule: ${r.name}`}>
            <RuleForm orgSlug={orgSlug} serviceId={service.id} rule={r} questions={questions} currency={currency} onDone={() => setEditing(null)} />
          </Card>
        ) : (
          <div key={r.id} className={cn("flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm", !r.active && "opacity-60")}>
            <span className="mt-0.5 w-10 shrink-0 text-center text-xs tabular-nums text-slate-400">#{r.priority}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">{r.name} {!r.active && <Badge>Off</Badge>}</p>
              <p className="mt-1 font-mono text-xs text-slate-600">{describeRule(r, currency, labels)}</p>
            </div>
            {canEdit && (
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" disabled={busy} onClick={() => save(() => api(`/api/orgs/${orgSlug}/pricing-rules/${r.id}`, { method: "PATCH", json: { active: !r.active } }))}>{r.active ? "Turn off" : "Turn on"}</Button>
                <Button variant="secondary" onClick={() => setEditing(r.id)}>Edit</Button>
              </div>
            )}
          </div>
        ),
      )}
      {!rules.length && <p className="text-sm text-slate-500">No rules yet - every visitor gets the base price.</p>}
      {canEdit &&
        (editing === "new" ? (
          <Card title="New pricing rule">
            <RuleForm orgSlug={orgSlug} serviceId={service.id} questions={questions} currency={currency} onDone={() => setEditing(null)} nextPriority={(Math.max(0, ...rules.map((r) => r.priority)) || 0) + 10} />
          </Card>
        ) : (
          <Button onClick={() => setEditing("new")}>+ Add pricing rule</Button>
        ))}
    </div>
  );
}

const ACTION_LABEL: Record<PricingActionType, string> = {
  ADD: "Add an amount",
  SUBTRACT: "Subtract an amount",
  SET: "Set the price to",
  MULTIPLY: "Multiply the price by",
  PERCENTAGE: "Add a percentage",
  PER_UNIT: "Charge per unit of an answer",
  REQUIRE_REVIEW: "Send to human review (no price)",
};

function RuleForm({ orgSlug, serviceId, rule, questions, currency, onDone, nextPriority = 100 }: { orgSlug: string; serviceId: string; rule?: RuleData; questions: QuestionData[]; currency: string; onDone: () => void; nextPriority?: number }) {
  const a = (rule?.action ?? { type: "ADD", amountCents: 0 }) as Record<string, unknown>;
  const [name, setName] = useState(rule?.name ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? nextPriority));
  const [active, setActive] = useState(rule?.active ?? true);
  const [condition, setCondition] = useState<unknown>(rule?.condition ?? null);
  const [type, setType] = useState<PricingActionType>((a.type as PricingActionType) ?? "ADD");
  const [amount, setAmount] = useState(toDollars(a.amountCents as number | undefined));
  const [percent, setPercent] = useState(String(a.percent ?? "10"));
  const [factor, setFactor] = useState(String(a.factor ?? "1.5"));
  const numericQs = questions.filter((q) => q.type === "NUMBER" || q.type === "CURRENCY" || q.type === "RANGE");
  const [field, setField] = useState(String(a.field ?? numericQs[0]?.key ?? ""));
  const [included, setIncluded] = useState(a.includedUnits !== undefined ? String(a.includedUnits) : "");
  const [reason, setReason] = useState(String(a.reason ?? ""));
  const { save, busy, error } = useSave();
  const labels = Object.fromEntries(questions.map((q) => [q.key, q.label]));
  const fields: ConditionField[] = questions.map((q) => ({ key: q.key, label: q.label, type: q.type, options: q.options }));

  const action = useMemo(() => {
    switch (type) {
      case "ADD":
      case "SUBTRACT":
      case "SET":
        return { type, amountCents: toCents(amount) };
      case "MULTIPLY":
        return { type, factor: Number(factor) };
      case "PERCENTAGE":
        return { type, percent: Number(percent) };
      case "PER_UNIT":
        return { type, field, amountCents: toCents(amount), ...(included ? { includedUnits: Number(included) } : {}) };
      case "REQUIRE_REVIEW":
        return { type, ...(reason ? { reason } : {}) };
    }
  }, [type, amount, factor, percent, field, included, reason]);

  const preview = describeRule({ key: "x", name, priority: Number(priority), condition, action }, currency, labels);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { key: rule?.key ?? toSnake(name), name, priority: Number(priority), active, condition, action };
    void save(
      () => (rule ? api(`/api/orgs/${orgSlug}/pricing-rules/${rule.id}`, { method: "PATCH", json: body }) : api(`/api/orgs/${orgSlug}/services/${serviceId}/pricing-rules`, { method: "POST", json: body })),
      onDone,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto]">
        <Field label="Rule name" hint="Shown to visitors in the estimate breakdown"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Transaction volume over 250" /></Field>
        <Field label="Priority" hint="Lower runs first"><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
        <div className="flex items-end pb-2"><Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} /></div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">If</p>
        <ConditionBuilder value={condition} onChange={setCondition} fields={fields} emptyLabel="Always applies (no condition)." />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Then</p>
        <div className="flex flex-wrap items-end gap-3">
          <Select value={type} onChange={(e) => setType(e.target.value as PricingActionType)} className="!w-64">
            {PRICING_ACTION_TYPES.map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
          </Select>
          {(type === "ADD" || type === "SUBTRACT" || type === "SET" || type === "PER_UNIT") && (
            <Field label={`Amount (${currency})`}><Input type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="!w-32" /></Field>
          )}
          {type === "PERCENTAGE" && <Field label="Percent (negative = discount)"><Input type="number" step="0.1" value={percent} onChange={(e) => setPercent(e.target.value)} className="!w-32" /></Field>}
          {type === "MULTIPLY" && <Field label="Factor"><Input type="number" step="0.01" min={0} value={factor} onChange={(e) => setFactor(e.target.value)} className="!w-32" /></Field>}
          {type === "PER_UNIT" && (
            <>
              <Field label="Per unit of">
                <Select value={field} onChange={(e) => setField(e.target.value)} className="!w-56">
                  {numericQs.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
                </Select>
              </Field>
              <Field label="Included units"><Input type="number" min={0} value={included} onChange={(e) => setIncluded(e.target.value)} className="!w-28" placeholder="0" /></Field>
            </>
          )}
          {type === "REQUIRE_REVIEW" && <Field label="Reason (internal)"><Input value={reason} onChange={(e) => setReason(e.target.value)} className="!w-72" /></Field>}
        </div>
      </div>
      <div className="rounded-lg bg-slate-900 px-4 py-3 font-mono text-sm text-slate-100">{preview}</div>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{rule ? "Save rule" : "Add rule"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {rule && (
          <Button type="button" variant="danger" className="ml-auto" disabled={busy} onClick={() => confirm("Delete this rule? Existing quotes keep their stored calculation.") && save(() => api(`/api/orgs/${orgSlug}/pricing-rules/${rule.id}`, { method: "DELETE" }), onDone)}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Test sandbox: runs the live server engine without saving anything
// ---------------------------------------------------------------------------

function TestPanel({ orgSlug, service, questions, currency }: { orgSlug: string; service: ServiceData; questions: QuestionData[]; currency: string }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<{ valid: boolean; errors: Record<string, string>; outcome: QuoteOutcome } | null>(null);
  const { save, busy, error } = useSave();
  const visible = getVisibleQuestions(questions, answers);
  const run = () =>
    save(async () => setResult(await api(`/api/orgs/${orgSlug}/services/${service.id}/preview`, { method: "POST", json: { answers } })));
  const o = result?.outcome;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Sample answers">
        <div className="space-y-5">
          {visible.map((q) => (
            <div key={q.key}>
              <p className="mb-2 text-sm font-medium text-slate-800">{q.label}</p>
              <QuestionInput question={q} value={answers[q.key]} onChange={(v) => setAnswers({ ...answers, [q.key]: v })} onSubmit={run} theme={adminTheme} />
              {result?.errors[q.key] && <p className="mt-1 text-xs text-red-600">{result.errors[q.key]}</p>}
            </div>
          ))}
          <Button onClick={run} disabled={busy}>Calculate</Button>
          {error && <Alert>{error}</Alert>}
        </div>
      </Card>
      <Card title="Result (live rules, nothing saved)">
        {!o ? (
          <p className="text-sm text-slate-500">Fill in answers and press Calculate to see exactly what a visitor would get.</p>
        ) : (
          <div className="space-y-4 text-sm">
            {!result.valid && <Alert tone="amber">Some required questions are unanswered - the visitor could not complete yet.</Alert>}
            {o.kind === "PRICE" && <p className="text-3xl font-semibold tabular-nums">{formatMoney(o.priceCents, currency)}</p>}
            {o.kind === "RANGE" && <p className="text-3xl font-semibold tabular-nums">{formatMoney(o.lowCents, currency)}–{formatMoney(o.highCents, currency)}</p>}
            {o.kind === "REVIEW" && <Alert tone="amber">Routed to human review: {o.reasons.join("; ")}</Alert>}
            {o.kind === "CONTACT" && <Alert tone="blue">Contact-only service: no price is shown.</Alert>}
            {o.calculation && (
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-slate-100"><td className="py-1.5 text-slate-600">Base</td><td className="py-1.5 text-right tabular-nums">{formatMoney(o.calculation.basePriceCents, currency)}</td></tr>
                  {o.calculation.adjustments.map((a) => (
                    <tr key={a.rule} className="border-b border-slate-100">
                      <td className="py-1.5 text-slate-700">{a.ruleName}<span className="block text-xs text-slate-500">{a.description}</span></td>
                      <td className="py-1.5 text-right tabular-nums">{a.amountCents >= 0 ? "+" : "−"}{formatMoney(Math.abs(a.amountCents), currency)}</td>
                    </tr>
                  ))}
                  <tr><td className="py-1.5 font-semibold">Total</td><td className="py-1.5 text-right font-semibold tabular-nums">{formatMoney(o.calculation.totalCents, currency)}</td></tr>
                </tbody>
              </table>
            )}
            {!!o.calculation?.warnings.length && <Alert tone="amber">{o.calculation.warnings.join("; ")}</Alert>}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsPanel({ orgSlug, service, currency, canEdit }: { orgSlug: string; service: ServiceData; currency: string; canEdit: boolean }) {
  const router = useRouter();
  const [s, setS] = useState({
    name: service.name,
    description: service.description ?? "",
    quoteMode: service.quoteMode,
    billingPeriod: service.billingPeriod,
    base: toDollars(service.basePriceCents),
    min: toDollars(service.minimumPriceCents),
    range: service.estimateRangePercent === null ? "" : String(service.estimateRangePercent),
    inclusions: service.inclusions.join("\n"),
    assumptions: service.assumptions.join("\n"),
    active: service.active,
    order: String(service.order),
  });
  const { save, busy, error } = useSave();
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof s) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void save(
      () =>
        api(`/api/orgs/${orgSlug}/services/${service.id}`, {
          method: "PATCH",
          json: {
            name: s.name,
            description: s.description || null,
            quoteMode: s.quoteMode,
            billingPeriod: s.billingPeriod,
            basePriceCents: toCents(s.base),
            minimumPriceCents: s.min === "" ? null : toCents(s.min),
            estimateRangePercent: s.range === "" ? null : Number(s.range),
            inclusions: lines(s.inclusions),
            assumptions: lines(s.assumptions),
            active: s.active,
            order: Number(s.order) || 0,
          },
        }),
      () => setSaved(true),
    );
  };
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={s.name} onChange={set("name")} required /></Field>
            <Field label="Quote mode" hint="Human review and contact-only services never show a price.">
              <Select value={s.quoteMode} onChange={set("quoteMode")}>{QUOTE_MODES.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select>
            </Field>
          </div>
          <Field label="Description"><Input value={s.description} onChange={set("description")} /></Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={`Base price (${currency})`}><Input type="number" step="0.01" min={0} value={s.base} onChange={set("base")} /></Field>
            <Field label="Minimum price"><Input type="number" step="0.01" min={0} value={s.min} onChange={set("min")} placeholder="None" /></Field>
            <Field label="Billing"><Select value={s.billingPeriod} onChange={set("billingPeriod")}>{BILLING_PERIODS.map((b) => <option key={b} value={b}>{BILLING_LABEL[b]}</option>)}</Select></Field>
            <Field label="Estimate range ±%" hint="ESTIMATE mode only"><Input type="number" min={0} max={90} value={s.range} onChange={set("range")} placeholder="15" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What's included" hint="One per line - shown on the estimate screen"><Textarea value={s.inclusions} onChange={set("inclusions")} /></Field>
            <Field label="Assumptions" hint="One per line"><Textarea value={s.assumptions} onChange={set("assumptions")} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <Checkbox label="Active (visible on the quote page)" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />
            <Field label="Display order" className="!w-32"><Input type="number" value={s.order} onChange={set("order")} /></Field>
          </div>
        </fieldset>
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="green">Saved. New quotes use these settings; existing quotes are unchanged.</Alert>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>Save settings</Button>
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                confirm("Delete this service? Services with quote history are deactivated instead.") &&
                save(async () => {
                  const r = await api<{ deleted: boolean }>(`/api/orgs/${orgSlug}/services/${service.id}`, { method: "DELETE" });
                  if (r.deleted) router.push(`/dashboard/${orgSlug}/services`);
                })
              }
            >
              Delete service
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
