/**
 * UI template registry (data only - safe to import on the server).
 *
 * A template is purely presentational: it receives the same funnel state and actions from the
 * headless useQuoteFunnel() hook and renders them differently. Quote logic never lives here.
 * React implementations are registered in ./index.tsx.
 */
export const TEMPLATE_KEYS = ["professional", "modern", "premium"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateMeta {
  key: TemplateKey;
  name: string;
  audience: string;
  description: string;
  defaults: { primaryColor: string; accentColor: string };
}

export const TEMPLATES: TemplateMeta[] = [
  {
    key: "professional",
    name: "Professional",
    audience: "Accounting, law, consulting",
    description: "Trust-first split layout with a progress sidebar and itemized estimate.",
    defaults: { primaryColor: "#1e3a5f", accentColor: "#c8a24a" },
  },
  {
    key: "modern",
    name: "Modern",
    audience: "Technology, agencies, SaaS",
    description: "Centered card, bold gradient, pill-style answers and a progress bar.",
    defaults: { primaryColor: "#4f46e5", accentColor: "#06b6d4" },
  },
  {
    key: "premium",
    name: "Premium",
    audience: "Luxury professional services",
    description: "Dark, editorial serif layout with generous spacing and understated detail.",
    defaults: { primaryColor: "#b08d57", accentColor: "#e7d8bd" },
  },
];

export function isTemplateKey(k: string): k is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(k);
}

export function getTemplateMeta(k: string): TemplateMeta {
  return TEMPLATES.find((t) => t.key === k) ?? TEMPLATES[0];
}
