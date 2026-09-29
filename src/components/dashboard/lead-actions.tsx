"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { titleCase } from "@/lib/format";
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

const STATUSES = ["NEW", "NEEDS_REVIEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "WON", "LOST", "DISQUALIFIED"];

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  };
  return { run, pending, error };
}

export function LeadActions(props: {
  orgSlug: string;
  leadId: string;
  status: string;
  ownerId: string | null;
  members: { id: string; name: string }[];
  quoteAccepted: boolean;
  hasQuote: boolean;
}) {
  const base = `/api/orgs/${props.orgSlug}/leads/${props.leadId}`;
  const { run, pending, error } = useAction();
  const [when, setWhen] = useState("");
  return (
    <Card title="Follow-up">
      <div className="space-y-4">
        <Field label="Status">
          <Select value={props.status} disabled={pending} onChange={(e) => run(() => api(base, { method: "PATCH", json: { status: e.target.value } }))}>
            {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select value={props.ownerId ?? ""} disabled={pending} onChange={(e) => run(() => api(base, { method: "PATCH", json: { ownerId: e.target.value || null } }))}>
            <option value="">Unassigned</option>
            {props.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          {props.hasQuote && !props.quoteAccepted && (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => api(`${base}/accept`, { method: "POST" }))}>Mark quote accepted</Button>
          )}
          <Button variant="secondary" disabled={pending} onClick={() => run(() => api(`${base}/summary`, { method: "POST" }))}>Regenerate summary</Button>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (when) run(() => api(`${base}/appointments`, { method: "POST", json: { startsAt: new Date(when).toISOString() } }));
          }}
        >
          <Field label="Record consultation" className="flex-1">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending || !when}>Save</Button>
        </form>
        {error && <Alert>{error}</Alert>}
      </div>
    </Card>
  );
}

export function LeadNotes({ orgSlug, leadId, notes }: { orgSlug: string; leadId: string; notes: { id: string; body: string; author: string; createdAt: string }[] }) {
  const { run, pending, error } = useAction();
  const [body, setBody] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    void run(async () => {
      await api(`/api/orgs/${orgSlug}/leads/${leadId}/notes`, { method: "POST", json: { body } });
      setBody("");
    });
  };
  return (
    <Card title="Notes">
      <form onSubmit={submit} className="space-y-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for your team…" className="min-h-20" />
        <Button type="submit" disabled={pending || !body.trim()}>Add note</Button>
      </form>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      <ul className="mt-4 space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="whitespace-pre-wrap text-slate-800">{n.body}</p>
            <p className="mt-1 text-xs text-slate-500">{n.author} · {n.createdAt}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function LeadTasks({ orgSlug, tasks }: { orgSlug: string; tasks: { id: string; title: string; dueAt: string | null; completed: boolean }[] }) {
  const { run, pending } = useAction();
  if (!tasks.length) return null;
  return (
    <Card title="Tasks">
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <Checkbox
              checked={t.completed}
              disabled={pending}
              onChange={(e) => run(() => api(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", json: { completed: e.target.checked } }))}
              label={
                <span className={t.completed ? "text-slate-400 line-through" : ""}>
                  {t.title}
                  {t.dueAt && <span className="ml-1 text-xs text-slate-500">· due {new Date(t.dueAt).toLocaleDateString()}</span>}
                </span>
              }
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
