import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgPage } from "@/server/page-auth";
import { getLeadDetail } from "@/server/services/leads";
import { AppError } from "@/server/errors";
import { Badge, Card, PageHeader } from "@/components/ui";
import { IntentBadge, QuoteModeBadge, StatusBadge } from "@/components/dashboard/badges";
import { LeadActions, LeadNotes, LeadTasks } from "@/components/dashboard/lead-actions";
import { formatDateTime, formatEstimate, formatMoney, titleCase } from "@/lib/format";
import { describeAction } from "@/core/pricing";
import { describeCondition } from "@/core/conditions";
import type { PriceCalculation } from "@/core/pricing";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  QUOTE_STARTED: "Started a quote",
  QUESTION_ANSWERED: "Answered a question",
  QUOTE_COMPLETED: "Completed the quote",
  QUOTE_ABANDONED: "Abandoned the quote",
  LEAD_CREATED: "Lead created",
  LEAD_STATUS_CHANGED: "Status changed",
  LEAD_ASSIGNED: "Owner changed",
  NOTE_ADDED: "Note added",
  EMAIL_SENT: "Email sent",
  WHATSAPP_SENT: "WhatsApp sent",
  SMS_SENT: "SMS sent",
  NOTIFICATION_SENT: "Team notified",
  TASK_CREATED: "Task created",
  CRM_RECORD_CREATED: "CRM record created",
  CONSULTATION_BOOKED: "Consultation booked",
  QUOTE_ACCEPTED: "Quote accepted",
  AUTOMATION_FAILED: "Automation failed",
};

function eventDetail(type: string, p: Record<string, unknown>): string | null {
  if (type === "QUESTION_ANSWERED") return String(p.key ?? "");
  if (type === "LEAD_STATUS_CHANGED") return `${titleCase(String(p.from))} → ${titleCase(String(p.to))}`;
  if (type === "QUOTE_COMPLETED") return String(p.outcome ?? "");
  if (type === "EMAIL_SENT") return `${p.template} → ${(p.to as string[] | undefined)?.join(", ") ?? ""}`;
  if (type === "TASK_CREATED") return String(p.title ?? "");
  if (type === "AUTOMATION_FAILED") return `${p.automation}: ${p.error}`;
  if (type === "LEAD_CREATED") return `${titleCase(String(p.status))} · ${titleCase(String(p.intent))} intent`;
  return null;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ orgSlug: string; leadId: string }> }) {
  const { orgSlug, leadId } = await params;
  const ctx = await requireOrgPage(orgSlug);
  let detail;
  try {
    detail = await getLeadDetail(ctx, leadId);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const { lead, events, members, answers, serviceSnapshot } = detail;
  const quote = lead.quote;
  const calc = (quote?.calculation ?? null) as PriceCalculation | null;
  const tz = ctx.organization.timezone;
  const labels = Object.fromEntries(answers.map((a) => [a.key, a.label]));
  const qualification = lead.qualification as { tags?: string[]; matchedRules?: string[]; reviewReasons?: string[] };
  const estimate = quote ? formatEstimate(quote) : null;
  // Collapse per-question events into one timeline row.
  const answeredCount = events.filter((e) => e.type === "QUESTION_ANSWERED").length;
  const timeline = events.filter((e, i, arr) => e.type !== "QUESTION_ANSWERED" || arr.findIndex((x) => x.type === "QUESTION_ANSWERED") === i);

  return (
    <>
      <Link href={`/dashboard/${orgSlug}/leads`} className="text-sm text-slate-500 hover:text-slate-900">← All leads</Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {lead.company || lead.name}
            <StatusBadge status={lead.status} />
            <IntentBadge intent={lead.intent} />
          </span>
        }
        description={`${lead.service?.name ?? serviceSnapshot?.name ?? "—"} · created ${formatDateTime(lead.createdAt, tz)}`}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {lead.summary && (
            <Card title="Summary">
              <p className="text-sm leading-relaxed text-slate-700">{lead.summary}</p>
            </Card>
          )}

          <Card title="Quote" actions={quote && <QuoteModeBadge mode={quote.quoteMode} />}>
            {!quote ? (
              <p className="text-sm text-slate-500">No quote attached.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{estimate ? "Estimated value shown to visitor" : "Outcome"}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">{estimate ?? (quote.status === "NEEDS_REVIEW" ? "Personalized review" : "Contact request")}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>Generated {formatDateTime(quote.generatedAt, tz)}</p>
                    {quote.expiresAt && <p>Valid until {formatDateTime(quote.expiresAt, tz)}</p>}
                    <p>Status: {titleCase(quote.status)}</p>
                  </div>
                </div>
                {calc?.requiresReview && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    ⚑ Sent to review: {calc.reviewReasons.join("; ")}. The internal calculation below was not shown to the visitor.
                  </p>
                )}
                {calc && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-slate-900">Pricing calculation (stored snapshot)</h3>
                    <table className="mt-2 w-full text-sm">
                      <tbody>
                        <tr className="border-b border-slate-100">
                          <td className="py-2 text-slate-600">Base price</td>
                          <td />
                          <td className="py-2 text-right tabular-nums">{formatMoney(calc.basePriceCents, calc.currency)}</td>
                        </tr>
                        {calc.adjustments.map((a) => (
                          <tr key={a.rule} className="border-b border-slate-100">
                            <td className="py-2 text-slate-700">{a.ruleName}</td>
                            <td className="py-2 text-xs text-slate-500">{a.description}</td>
                            <td className="py-2 text-right tabular-nums">
                              {a.amountCents >= 0 ? "+" : "−"}
                              {formatMoney(Math.abs(a.amountCents), calc.currency)}
                            </td>
                          </tr>
                        ))}
                        {calc.minimumApplied && (
                          <tr className="border-b border-slate-100">
                            <td className="py-2 text-slate-600" colSpan={2}>Minimum price applied</td>
                            <td className="py-2 text-right tabular-nums">{formatMoney(calc.minimumPriceCents ?? 0, calc.currency)}</td>
                          </tr>
                        )}
                        <tr>
                          <td className="py-2 font-semibold">Total</td>
                          <td />
                          <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(calc.totalCents, calc.currency)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <details className="mt-3 text-xs text-slate-500">
                      <summary className="cursor-pointer select-none">All {calc.rules.length} rules evaluated · engine v{calc.engineVersion} · fingerprint {calc.rulesFingerprint}</summary>
                      <ul className="mt-2 space-y-1">
                        {calc.rules.map((r) => (
                          <li key={r.key} className="flex gap-2">
                            <Badge tone={r.matched ? "green" : "slate"}>{r.matched ? "matched" : "skipped"}</Badge>
                            <span>
                              <strong className="font-medium text-slate-700">{r.name}</strong>: IF {describeCondition(r.condition, labels)} THEN {describeAction(r.action, calc.currency, labels)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {calc.warnings.length > 0 && <p className="mt-2 text-amber-700">Warnings: {calc.warnings.join("; ")}</p>}
                    </details>
                  </div>
                )}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-900">Answers</h3>
                  <dl className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {answers.map((a) => (
                      <div key={a.key}>
                        <dt className="text-xs text-slate-500">{a.label}</dt>
                        <dd className="text-sm text-slate-900">{a.display}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </>
            )}
          </Card>

          <Card title="Timeline">
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {timeline.map((e) => {
                const p = (e.payload ?? {}) as Record<string, unknown>;
                const detailText = e.type === "QUESTION_ANSWERED" ? `${answeredCount} answers saved` : eventDetail(e.type, p);
                return (
                  <li key={e.id} className="relative">
                    <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${e.type === "AUTOMATION_FAILED" ? "bg-red-500" : "bg-slate-400"}`} />
                    <p className="text-sm text-slate-900">{EVENT_LABEL[e.type] ?? titleCase(e.type)}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(e.createdAt, tz)}
                      {detailText ? ` · ${detailText}` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-slate-500">Name</dt><dd>{lead.name}</dd></div>
              {lead.company && <div><dt className="text-xs text-slate-500">Company</dt><dd>{lead.company}</dd></div>}
              <div><dt className="text-xs text-slate-500">Email</dt><dd><a className="text-sky-700 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></dd></div>
              {lead.phone && <div><dt className="text-xs text-slate-500">Phone</dt><dd><a className="text-sky-700 hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a></dd></div>}
              {lead.industry && <div><dt className="text-xs text-slate-500">Industry</dt><dd>{lead.industry}</dd></div>}
              {lead.urgency && <div><dt className="text-xs text-slate-500">Urgency</dt><dd>{lead.urgency}</dd></div>}
            </dl>
          </Card>
          <LeadActions orgSlug={orgSlug} leadId={lead.id} status={lead.status} ownerId={lead.ownerId} members={members} quoteAccepted={quote?.status === "ACCEPTED"} hasQuote={!!quote} />
          <Card title="Attribution">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {([
                ["Source", lead.source], ["Medium", lead.medium], ["Campaign", lead.campaign], ["Content", lead.content], ["Term", lead.term],
              ] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v ?? "—"}</dd></div>
              ))}
              <div className="col-span-2"><dt className="text-xs text-slate-500">Referrer</dt><dd className="break-all">{lead.referrer ?? "—"}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-slate-500">Landing page</dt><dd className="break-all">{lead.landingPage ?? "—"}</dd></div>
            </dl>
          </Card>
          <Card title="Qualification">
            <p className="text-sm">Score <strong className="tabular-nums">{lead.score}</strong></p>
            {!!qualification.tags?.length && <p className="mt-2 flex flex-wrap gap-1">{qualification.tags.map((t) => <Badge key={t}>{t}</Badge>)}</p>}
            {!!qualification.matchedRules?.length && (
              <ul className="mt-2 list-disc pl-4 text-xs text-slate-600">{qualification.matchedRules.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
          </Card>
          <LeadTasks orgSlug={orgSlug} tasks={lead.tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt?.toISOString() ?? null, completed: !!t.completedAt }))} />
          <LeadNotes orgSlug={orgSlug} leadId={lead.id} notes={lead.notes.map((n) => ({ id: n.id, body: n.body, author: n.author?.name ?? "Visitor / system", createdAt: formatDateTime(n.createdAt, tz) }))} />
          {lead.messages.length > 0 && (
            <Card title="Messages">
              <ul className="space-y-2 text-xs text-slate-600">
                {lead.messages.map((m) => (
                  <li key={m.id}>
                    <span className="font-medium text-slate-800">{m.channel.toLowerCase()}</span> → {m.to} · {m.subject ?? m.body.slice(0, 40)} <Badge tone={m.status === "sent" ? "green" : "slate"}>{m.status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
