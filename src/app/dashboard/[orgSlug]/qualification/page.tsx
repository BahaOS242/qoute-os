import { requireOrgPage } from "@/server/page-auth";
import { listLeadRules } from "@/server/services/config-admin";
import { prisma } from "@/server/db";
import { toQuestionDef } from "@/server/services/config-loader";
import { PageHeader } from "@/components/ui";
import { LeadRulesEditor } from "@/components/dashboard/org-editors";
import type { ConditionField } from "@/components/dashboard/condition-builder";

export const dynamic = "force-dynamic";

export default async function QualificationPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "ADMIN");
  const [rules, services] = await Promise.all([
    listLeadRules(ctx),
    prisma.service.findMany({ where: { organizationId: ctx.organizationId }, include: { questions: { include: { options: true } } }, orderBy: { order: "asc" } }),
  ]);
  // Answer fields across services (deduplicated by key) for rule conditions.
  const answerFields = new Map<string, ConditionField>();
  for (const s of services) for (const q of s.questions) if (!answerFields.has(q.key)) {
    const d = toQuestionDef(q);
    answerFields.set(q.key, { key: q.key, label: `${q.label} (${s.name})`, type: q.type, options: d.options });
  }
  return (
    <>
      <PageHeader title="Qualification & routing" description="Rules run when a lead is created: score it, set intent, tag it, flag it for review or assign an owner. Intent defaults from score (≥50 high, ≥20 medium) unless a rule sets it." />
      <LeadRulesEditor
        orgSlug={orgSlug}
        rules={rules.map((r) => ({ id: r.id, name: r.name, serviceSlug: r.service?.slug ?? null, priority: r.priority, condition: r.condition ?? null, action: r.action, active: r.active }))}
        services={services.map((s) => ({ slug: s.slug, name: s.name }))}
        answerFields={[...answerFields.values()]}
      />
    </>
  );
}
