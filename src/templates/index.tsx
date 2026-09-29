"use client";
/** Maps template keys to React implementations. All share the same headless funnel. */
import type { ComponentType } from "react";
import type { Funnel } from "@/components/funnel/use-quote-funnel";
import type { TemplateKey } from "./registry";
import ProfessionalTemplate from "./professional";
import ModernTemplate from "./modern";
import PremiumTemplate from "./premium";

export const TEMPLATE_COMPONENTS: Record<TemplateKey, ComponentType<{ f: Funnel }>> = {
  professional: ProfessionalTemplate,
  modern: ModernTemplate,
  premium: PremiumTemplate,
};
