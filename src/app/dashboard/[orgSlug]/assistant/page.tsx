import { requireOrgPage } from "@/server/page-auth";
import { listProposals } from "@/server/services/ai-config";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { AiAssistant } from "@/components/dashboard/org-editors";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "ADMIN");
  const [proposals, services] = await Promise.all([
    listProposals(ctx),
    prisma.service.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true }, orderBy: { order: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="AI configuration assistant" description="Describe pricing in your own words; review the structured proposal; approve to activate." />
      <AiAssistant
        orgSlug={orgSlug}
        currency={ctx.organization.currency}
        services={services}
        proposals={proposals.map((p) => ({ ...p, createdAt: formatDateTime(p.createdAt, ctx.organization.timezone), proposal: p.proposal as never }))}
      />
    </>
  );
}
