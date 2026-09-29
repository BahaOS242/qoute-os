import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteFunnel } from "@/components/funnel/quote-funnel";
import { getPublicConfig } from "@/server/services/quote-flow";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<Record<string, string | undefined>> };

async function load(slug: string) {
  try {
    return await getPublicConfig(slug);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug } = await params;
  const config = await load(orgSlug);
  return { title: `Get a quote - ${config.organization.name}`, description: (config.organization.brand.subheadline as string) ?? undefined };
}

export default async function QuotePage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const config = await load(orgSlug);
  return <QuoteFunnel config={config} initialService={sp.service ?? null} templateOverride={sp.template ?? null} />;
}
