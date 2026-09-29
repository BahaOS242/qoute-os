import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { listUserOrganizations } from "@/server/services/organizations";
import { ButtonLink, EmptyState } from "@/components/ui";
import { SignOutButton } from "@/components/dashboard/sign-out";

export const dynamic = "force-dynamic";

export default async function DashboardIndex() {
  const user = await requirePageUser();
  const orgs = await listUserOrganizations(user.id);
  if (orgs.length === 1) redirect(`/dashboard/${orgs[0].slug}`);
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your organizations</h1>
        <div className="flex gap-2">
          <SignOutButton />
          <ButtonLink href="/dashboard/new">New organization</ButtonLink>
        </div>
      </div>
      {orgs.length === 0 ? (
        <EmptyState title="No organizations yet" description="Create your first client from a recipe to get a working quote funnel in seconds." action={<ButtonLink href="/dashboard/new">Create organization</ButtonLink>} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/dashboard/${o.slug}`} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50">
                <span className="font-medium">{o.name}</span>
                <span className="text-xs text-slate-500">{o.role.toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
