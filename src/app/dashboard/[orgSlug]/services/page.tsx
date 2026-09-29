import Link from "next/link";
import { requireOrgPage } from "@/server/page-auth";
import { listServices } from "@/server/services/config-admin";
import { hasRole } from "@/server/authz";
import { Badge, Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { QuoteModeBadge } from "@/components/dashboard/badges";
import { CreateServiceForm } from "@/components/dashboard/service-editor";
import { formatMoney, BILLING_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ServicesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);
  const services = await listServices(ctx);
  const canEdit = hasRole(ctx.role, "ADMIN");
  return (
    <>
      <PageHeader title="Services & pricing" description="Each service has its own questions, conditional logic and pricing rules. Changes apply to new quotes only - existing quotes keep their stored calculation." />
      {services.length === 0 ? (
        <EmptyState title="No services yet" description="Create a service, or import a recipe from Import / export." />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>{["Service", "Quote mode", "Base price", "Questions", "Rules", "Leads", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className={td}>
                    <Link href={`/dashboard/${orgSlug}/services/${s.id}`} className="font-medium text-slate-900 hover:underline">{s.name}</Link>
                    <span className="block text-xs text-slate-500">/q/{orgSlug}?service={s.slug}</span>
                  </td>
                  <td className={td}><QuoteModeBadge mode={s.quoteMode} /></td>
                  <td className={`${td} tabular-nums`}>
                    {s.quoteMode === "HUMAN_REVIEW" || s.quoteMode === "CONTACT_ONLY" ? <span className="text-slate-400">—</span> : formatMoney(s.basePriceCents, ctx.organization.currency)}
                    <span className="block text-xs text-slate-500">{BILLING_LABEL[s.billingPeriod]}</span>
                  </td>
                  <td className={td}>{s._count.questions}</td>
                  <td className={td}>{s._count.pricingRules}</td>
                  <td className={td}>{s._count.leads}</td>
                  <td className={td}>{s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {canEdit && (
        <div className="mt-6 max-w-2xl">
          <CreateServiceForm orgSlug={orgSlug} currency={ctx.organization.currency} />
        </div>
      )}
    </>
  );
}
