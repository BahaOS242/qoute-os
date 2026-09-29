import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgPage } from "@/server/page-auth";
import { getServiceDetail } from "@/server/services/config-admin";
import { toQuestionDef } from "@/server/services/config-loader";
import { hasRole } from "@/server/authz";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui";
import { QuoteModeBadge } from "@/components/dashboard/badges";
import { ServiceEditor } from "@/components/dashboard/service-editor";

export const dynamic = "force-dynamic";

export default async function ServiceDetailPage({ params }: { params: Promise<{ orgSlug: string; serviceId: string }> }) {
  const { orgSlug, serviceId } = await params;
  const ctx = await requireOrgPage(orgSlug);
  let detail;
  try {
    detail = await getServiceDetail(ctx, serviceId);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const { service, issues } = detail;
  return (
    <>
      <Link href={`/dashboard/${orgSlug}/services`} className="text-sm text-slate-500 hover:text-slate-900">← All services</Link>
      <PageHeader
        title={<span className="flex items-center gap-3">{service.name} <QuoteModeBadge mode={service.quoteMode} /></span>}
        description={service.description ?? undefined}
        actions={<a className="text-sm font-medium text-slate-600 hover:text-slate-900" href={`/q/${orgSlug}?service=${service.slug}`} target="_blank" rel="noreferrer">Open quote page ↗</a>}
      />
      <ServiceEditor
        orgSlug={orgSlug}
        currency={ctx.organization.currency}
        canEdit={hasRole(ctx.role, "ADMIN")}
        issues={issues}
        service={{
          id: service.id,
          slug: service.slug,
          name: service.name,
          description: service.description,
          inclusions: service.inclusions,
          assumptions: service.assumptions,
          active: service.active,
          quoteMode: service.quoteMode,
          basePriceCents: service.basePriceCents,
          minimumPriceCents: service.minimumPriceCents,
          billingPeriod: service.billingPeriod,
          estimateRangePercent: service.estimateRangePercent,
          order: service.order,
        }}
        questions={service.questions.map((q) => ({ id: q.id, ...toQuestionDef(q) }))}
        rules={service.pricingRules.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, priority: r.priority, condition: r.condition ?? null, action: r.action, active: r.active }))}
      />
    </>
  );
}
