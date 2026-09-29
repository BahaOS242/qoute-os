import { requireOrgPage } from "@/server/page-auth";
import { listAutomations, listMessageTemplates } from "@/server/services/config-admin";
import { PageHeader } from "@/components/ui";
import { AutomationsEditor } from "@/components/dashboard/org-editors";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "ADMIN");
  const [{ automations, runs }, templates] = await Promise.all([listAutomations(ctx), listMessageTemplates(ctx)]);
  return (
    <>
      <PageHeader title="Automations" description="Trigger → condition → actions. Email is live; WhatsApp and SMS run through provider interfaces and are recorded until a provider is connected." />
      <AutomationsEditor
        orgSlug={orgSlug}
        automations={automations.map((a) => ({ id: a.id, name: a.name, trigger: a.trigger, condition: a.condition ?? null, actions: a.actions, active: a.active }))}
        templates={templates.map((t) => ({ id: t.id, key: t.key, channel: t.channel, name: t.name, subject: t.subject, body: t.body }))}
        runs={runs.map((r) => ({ id: r.id, name: r.automation.name, status: r.status, trigger: r.trigger, error: r.error, createdAt: formatDateTime(r.createdAt, ctx.organization.timezone) }))}
      />
    </>
  );
}
