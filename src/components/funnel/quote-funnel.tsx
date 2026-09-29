"use client";
import { useQuoteFunnel } from "./use-quote-funnel";
import { TEMPLATE_COMPONENTS } from "@/templates";
import { isTemplateKey } from "@/templates/registry";
import type { PublicConfig } from "@/server/services/quote-flow";

/** Renders the organization's active template (or a preview override) around one funnel instance. */
export function QuoteFunnel({ config, initialService, templateOverride }: { config: PublicConfig; initialService?: string | null; templateOverride?: string | null }) {
  const f = useQuoteFunnel(config, { initialService });
  const key = templateOverride && isTemplateKey(templateOverride) ? templateOverride : isTemplateKey(config.organization.templateKey) ? config.organization.templateKey : "professional";
  const Template = TEMPLATE_COMPONENTS[key];
  return <Template f={f} />;
}
