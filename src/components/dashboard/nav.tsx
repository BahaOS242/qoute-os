"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function DashboardNav({ orgSlug, role }: { orgSlug: string; role: string }) {
  const path = usePathname();
  const base = `/dashboard/${orgSlug}`;
  const admin = role !== "MEMBER";
  const items = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/leads`, label: "Leads" },
    { href: `${base}/services`, label: "Services & pricing" },
    ...(admin
      ? [
          { href: `${base}/qualification`, label: "Qualification" },
          { href: `${base}/automations`, label: "Automations" },
          { href: `${base}/assistant`, label: "AI assistant" },
          { href: `${base}/settings`, label: "Branding & settings" },
          { href: `${base}/config`, label: "Import / export" },
        ]
      : []),
  ];
  return (
    <nav className="mt-4 flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((i) => {
        const active = i.exact ? path === i.href : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm", active ? "bg-slate-900 font-medium text-white" : "text-slate-600 hover:bg-slate-100")}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
