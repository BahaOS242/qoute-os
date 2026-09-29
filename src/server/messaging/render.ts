/**
 * Minimal, safe {{placeholder}} rendering for message templates. Unknown placeholders render
 * as empty strings; values are HTML-escaped when rendering HTML.
 */
export type TemplateVars = Record<string, string | number | null | undefined>;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderTemplate(template: string, vars: TemplateVars, opts: { html?: boolean } = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    const s = v === null || v === undefined ? "" : String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

/** Plain text -> simple HTML email body (escaped, paragraphs + line breaks, links clickable). */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join("\n");
}

export const TEMPLATE_VARIABLES = [
  "org.name",
  "lead.name",
  "lead.firstName",
  "lead.company",
  "lead.email",
  "lead.phone",
  "lead.status",
  "lead.intent",
  "lead.source",
  "lead.campaign",
  "lead.urgency",
  "lead.summary",
  "service.name",
  "quote.estimate",
  "bookingUrl",
  "dashboardUrl",
] as const;
