import { requireOrgPage } from "@/server/page-auth";
import { listMembers } from "@/server/services/organizations";
import { hasRole } from "@/server/authz";
import { TEMPLATES } from "@/templates/registry";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/dashboard/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "ADMIN");
  const o = ctx.organization;
  const members = await listMembers(ctx);
  return (
    <>
      <PageHeader title="Branding & settings" />
      <SettingsForm
        templates={TEMPLATES}
        canManageOwnerSettings={hasRole(ctx.role, "OWNER")}
        members={members.map((m) => ({ email: m.email, name: m.name, role: m.role }))}
        data={{
          name: o.name, slug: o.slug, templateKey: o.templateKey, logoUrl: o.logoUrl, currency: o.currency, timezone: o.timezone,
          contactEmail: o.contactEmail, contactPhone: o.contactPhone, website: o.website, notificationEmail: o.notificationEmail,
          bookingUrl: o.bookingUrl, highValueThresholdCents: o.highValueThresholdCents, quoteValidityDays: o.quoteValidityDays,
          brand: o.brand as never, glossary: (Array.isArray(o.glossary) ? o.glossary : []) as never,
        }}
      />
    </>
  );
}
