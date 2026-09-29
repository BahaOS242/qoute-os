import { requireOrgPage } from "@/server/page-auth";
import { PageHeader } from "@/components/ui";
import { ImportExport } from "@/components/dashboard/org-editors";

export default async function ConfigPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await requireOrgPage(orgSlug, "ADMIN");
  return (
    <>
      <PageHeader title="Import / export" description="Quote configurations are portable JSON documents - the same format as vertical recipes." />
      <ImportExport orgSlug={orgSlug} />
    </>
  );
}
