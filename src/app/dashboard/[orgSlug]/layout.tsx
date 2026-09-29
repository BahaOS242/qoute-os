import Link from "next/link";
import { requireOrgPage } from "@/server/page-auth";
import { DashboardNav } from "@/components/dashboard/nav";
import { SignOutButton } from "@/components/dashboard/sign-out";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col px-3 py-4">
          <Link href="/dashboard" className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">QuoteOS</Link>
          <p className="mt-1 truncate px-3 font-semibold text-slate-900">{ctx.organization.name}</p>
          <DashboardNav orgSlug={orgSlug} role={ctx.role} />
          <div className="mt-auto hidden space-y-1 border-t border-slate-100 pt-3 lg:block">
            <a href={`/q/${orgSlug}`} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">View quote page ↗</a>
            <SignOutButton className="w-full justify-start" />
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
