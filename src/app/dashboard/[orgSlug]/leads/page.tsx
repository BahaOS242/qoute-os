import Link from "next/link";
import { requireOrgPage } from "@/server/page-auth";
import { leadFiltersSchema, listLeads, LEAD_STATUSES } from "@/server/services/leads";
import { listServices } from "@/server/services/config-admin";
import { prisma } from "@/server/db";
import { Button, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Table, td, th } from "@/components/ui";
import { IntentBadge, StatusBadge } from "@/components/dashboard/badges";
import { formatMoney, titleCase } from "@/lib/format";
import { BILLING_SUFFIX } from "@/core/quote";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgPage(orgSlug);
  const filters = leadFiltersSchema.parse(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)));
  const [{ items, total }, services, sources, members] = await Promise.all([
    listLeads(ctx, filters),
    listServices(ctx),
    prisma.lead.groupBy({ by: ["source"], where: { organizationId: ctx.organizationId } }),
    prisma.membership.findMany({ where: { organizationId: ctx.organizationId }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const base = `/dashboard/${orgSlug}/leads`;
  const page = Math.floor(filters.skip / filters.take);
  const qs = (skip: number) => new URLSearchParams({ ...sp, skip: String(skip) }).toString();

  return (
    <>
      <PageHeader title="Leads" description={`${total} lead${total === 1 ? "" : "s"} matching your filters.`} />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" method="get">
        <Input name="q" placeholder="Search name, company, email" defaultValue={sp.q} className="lg:col-span-2" />
        <Select name="status" defaultValue={sp.status ?? ""}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select name="serviceId" defaultValue={sp.serviceId ?? ""}>
          <option value="">All services</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select name="source" defaultValue={sp.source ?? ""}>
          <option value="">All sources</option>
          {sources.map((s) => s.source && <option key={s.source} value={s.source}>{titleCase(s.source)}</option>)}
        </Select>
        <div className="flex gap-2">
          <Select name="ownerId" defaultValue={sp.ownerId ?? ""}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </div>
      </form>
      {items.length === 0 ? (
        <EmptyState title="No leads found" description="Leads appear here as soon as a visitor submits their details on your quote page." action={<ButtonLink href={`/q/${orgSlug}`} variant="secondary">Open quote page</ButtonLink>} />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                {["Name", "Company", "Service", "Estimated value", "Source", "Intent", "Status", "Created", "Assigned"].map((h) => <th key={h} className={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className={td}>
                    <Link href={`${base}/${l.id}`} className="font-medium text-slate-900 hover:underline">{l.name}</Link>
                    <span className="block text-xs text-slate-500">{l.email}</span>
                  </td>
                  <td className={td}>{l.company ?? "—"}</td>
                  <td className={td}>{l.service?.name ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>
                    {l.estimatedValueCents !== null ? `${formatMoney(l.estimatedValueCents, l.currency)}${l.billingPeriod ? BILLING_SUFFIX[l.billingPeriod] : ""}` : <span className="text-slate-400">Review</span>}
                  </td>
                  <td className={td}>
                    {titleCase(l.source ?? "direct")}
                    {l.campaign && <span className="block text-xs text-slate-500">{l.campaign}</span>}
                  </td>
                  <td className={td}><IntentBadge intent={l.intent} /></td>
                  <td className={td}><StatusBadge status={l.status} /></td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{l.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ctx.organization.timezone })}</td>
                  <td className={td}>{l.owner?.name ?? <span className="text-slate-400">Unassigned</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {total > filters.take && (
            <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500">
              <span>Page {page + 1} of {Math.ceil(total / filters.take)}</span>
              <div className="flex gap-2">
                {filters.skip > 0 && <ButtonLink variant="secondary" href={`${base}?${qs(Math.max(0, filters.skip - filters.take))}`}>Previous</ButtonLink>}
                {filters.skip + filters.take < total && <ButtonLink variant="secondary" href={`${base}?${qs(filters.skip + filters.take)}`}>Next</ButtonLink>}
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
