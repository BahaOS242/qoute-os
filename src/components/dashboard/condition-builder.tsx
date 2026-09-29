"use client";
/**
 * No-code editor for the condition DSL. Handles the common shapes (single rule, ALL/ANY of
 * rules) visually and falls back to a validated JSON editor for deeper nesting.
 */
import { useState } from "react";
import { describeCondition, OPERATOR_LABELS, validateCondition, type Condition, type Operator } from "@/core/conditions";
import { Button, Input, Select, Textarea } from "@/components/ui";

export interface ConditionField {
  key: string;
  label: string;
  type: string; // question type or NUMBER/TEXT/BOOLEAN/SELECT for meta fields
  options?: { label: string; value: string }[];
}

type Leaf = { field: string; op: Operator; value?: unknown };

const NUMERIC = new Set(["NUMBER", "CURRENCY", "RANGE"]);
function opsFor(f?: ConditionField): Operator[] {
  if (!f) return ["eq"];
  if (NUMERIC.has(f.type)) return ["gt", "gte", "lt", "lte", "between", "eq", "neq", "exists", "notExists"];
  if (f.type === "BOOLEAN") return ["eq", "exists", "notExists"];
  if (f.type === "MULTI_SELECT") return ["contains", "notContains", "exists", "notExists"];
  if (f.type === "SINGLE_SELECT" || f.type === "SELECT") return ["eq", "neq", "in", "notIn", "exists", "notExists"];
  return ["eq", "neq", "contains", "exists", "notExists"];
}

function defaultValue(f: ConditionField | undefined, op: Operator): unknown {
  if (op === "exists" || op === "notExists") return undefined;
  if (op === "between") return [0, 100];
  if (op === "in" || op === "notIn") return f?.options?.[0] ? [f.options[0].value] : [];
  if (!f) return "";
  if (NUMERIC.has(f.type)) return 0;
  if (f.type === "BOOLEAN") return true;
  if (f.options?.length) return f.options[0].value;
  return "";
}

function toFlat(c: unknown): { mode: "all" | "any"; leaves: Leaf[] } | null {
  if (c === null || c === undefined) return { mode: "all", leaves: [] };
  const n = c as Record<string, unknown>;
  const isLeaf = (x: unknown) => !!x && typeof x === "object" && typeof (x as Leaf).field === "string";
  if (isLeaf(n)) return { mode: "all", leaves: [n as unknown as Leaf] };
  if (Array.isArray(n.all) && n.all.every(isLeaf)) return { mode: "all", leaves: n.all as Leaf[] };
  if (Array.isArray(n.any) && n.any.every(isLeaf)) return { mode: "any", leaves: n.any as Leaf[] };
  return null;
}

function fromFlat(mode: "all" | "any", leaves: Leaf[]): Condition | null {
  const clean = leaves.map((l) => (l.op === "exists" || l.op === "notExists" ? { field: l.field, op: l.op } : l)) as Condition[];
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  return mode === "all" ? { all: clean } : { any: clean };
}

function ValueInput({ field, leaf, onChange }: { field?: ConditionField; leaf: Leaf; onChange: (v: unknown) => void }) {
  if (leaf.op === "exists" || leaf.op === "notExists") return null;
  const numeric = field && NUMERIC.has(field.type);
  if (leaf.op === "between") {
    const [a, b] = Array.isArray(leaf.value) ? leaf.value : [0, 0];
    return (
      <div className="flex items-center gap-1">
        <Input type="number" value={String(a)} onChange={(e) => onChange([Number(e.target.value), b])} className="!w-24" aria-label="Minimum" />
        <span className="text-xs text-slate-500">and</span>
        <Input type="number" value={String(b)} onChange={(e) => onChange([a, Number(e.target.value)])} className="!w-24" aria-label="Maximum" />
      </div>
    );
  }
  if ((leaf.op === "in" || leaf.op === "notIn") && field?.options?.length) {
    const arr = Array.isArray(leaf.value) ? (leaf.value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1">
        {field.options.map((o) => {
          const on = arr.includes(o.value);
          return (
            <button key={o.value} type="button" onClick={() => onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
              className={`rounded-md border px-2 py-1 text-xs ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  if (leaf.op === "in" || leaf.op === "notIn") {
    return <Input value={Array.isArray(leaf.value) ? leaf.value.join(", ") : ""} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="a, b, c" className="!w-48" />;
  }
  if (field?.type === "BOOLEAN") {
    return (
      <Select value={String(leaf.value)} onChange={(e) => onChange(e.target.value === "true")} className="!w-28">
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    );
  }
  if (field?.options?.length) {
    return (
      <Select value={String(leaf.value ?? "")} onChange={(e) => onChange(e.target.value)} className="!w-48">
        {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    );
  }
  return (
    <Input
      type={numeric ? "number" : "text"}
      value={leaf.value === undefined || leaf.value === null ? "" : String(leaf.value)}
      onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)}
      className="!w-40"
    />
  );
}

export function ConditionBuilder({ value, onChange, fields, emptyLabel = "Always" }: { value: unknown; onChange: (c: Condition | null) => void; fields: ConditionField[]; emptyLabel?: string }) {
  const flat = toFlat(value);
  const [json, setJson] = useState<string | null>(flat ? null : JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));

  if (json !== null || !flat) {
    return (
      <div className="space-y-2">
        <Textarea
          value={json ?? ""}
          onChange={(e) => {
            setJson(e.target.value);
            try {
              const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : null;
              const v = validateCondition(parsed);
              if (!v.ok) setJsonError(v.error);
              else {
                setJsonError(null);
                onChange(v.condition);
              }
            } catch {
              setJsonError("Invalid JSON");
            }
          }}
          className="font-mono text-xs"
        />
        {jsonError ? <p className="text-xs text-red-600">{jsonError}</p> : <p className="text-xs text-slate-500">{describeCondition(value, labels)}</p>}
        {toFlat(value) && (
          <Button type="button" variant="ghost" onClick={() => setJson(null)}>Use visual editor</Button>
        )}
      </div>
    );
  }

  const { mode, leaves } = flat;
  const update = (next: Leaf[], m = mode) => onChange(fromFlat(m, next));
  const addLeaf = () => {
    const f = fields[0];
    if (!f) return;
    const op = opsFor(f)[0];
    update([...leaves, { field: f.key, op, value: defaultValue(f, op) }]);
  };

  return (
    <div className="space-y-2">
      {leaves.length === 0 && <p className="text-sm text-slate-500">{emptyLabel}</p>}
      {leaves.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          Match
          <Select value={mode} onChange={(e) => update(leaves, e.target.value as "all" | "any")} className="!w-24 py-1 text-xs">
            <option value="all">ALL</option>
            <option value="any">ANY</option>
          </Select>
          of these conditions
        </div>
      )}
      {leaves.map((leaf, i) => {
        const f = byKey.get(leaf.field);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <Select
              value={leaf.field}
              onChange={(e) => {
                const nf = byKey.get(e.target.value);
                const op = opsFor(nf)[0];
                update(leaves.map((l, j) => (j === i ? { field: e.target.value, op, value: defaultValue(nf, op) } : l)));
              }}
              className="!w-72"
            >
              {!f && <option value={leaf.field}>{leaf.field} (unknown)</option>}
              {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </Select>
            <Select
              value={leaf.op}
              onChange={(e) => {
                const op = e.target.value as Operator;
                update(leaves.map((l, j) => (j === i ? { ...l, op, value: defaultValue(f, op) } : l)));
              }}
              className="!w-40"
            >
              {opsFor(f).map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
            </Select>
            <ValueInput field={f} leaf={leaf} onChange={(v) => update(leaves.map((l, j) => (j === i ? { ...l, value: v } : l)))} />
            <button type="button" onClick={() => update(leaves.filter((_, j) => j !== i))} className="ml-auto px-2 text-sm text-slate-400 hover:text-red-600" aria-label="Remove condition">
              ✕
            </button>
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={addLeaf} disabled={!fields.length}>+ Add condition</Button>
        <Button type="button" variant="ghost" onClick={() => setJson(JSON.stringify(value ?? null, null, 2))}>Edit as JSON</Button>
      </div>
    </div>
  );
}

/** Meta fields available to lead rules and automations in addition to answers. */
export const META_FIELDS: ConditionField[] = [
  { key: "$service", label: "Service (slug)", type: "TEXT" },
  { key: "$estimatedValue", label: "Estimated value", type: "NUMBER" },
  { key: "$hasPrice", label: "Has a price", type: "BOOLEAN" },
  { key: "$source", label: "Source", type: "TEXT" },
  { key: "$medium", label: "Medium", type: "TEXT" },
  { key: "$campaign", label: "Campaign", type: "TEXT" },
  { key: "$quoteMode", label: "Quote mode", type: "SELECT", options: ["INSTANT", "ESTIMATE", "HUMAN_REVIEW", "CONTACT_ONLY"].map((v) => ({ label: v, value: v })) },
];

export const LEAD_META_FIELDS: ConditionField[] = [
  ...META_FIELDS,
  { key: "$status", label: "Lead status", type: "SELECT", options: ["NEW", "NEEDS_REVIEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "WON", "LOST", "DISQUALIFIED"].map((v) => ({ label: v, value: v })) },
  { key: "$intent", label: "Lead intent", type: "SELECT", options: ["HIGH", "MEDIUM", "LOW"].map((v) => ({ label: v, value: v })) },
  { key: "$score", label: "Lead score", type: "NUMBER" },
];
