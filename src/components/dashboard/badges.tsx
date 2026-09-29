import { Badge, type BadgeTone } from "@/components/ui";
import { titleCase } from "@/lib/format";

const STATUS_TONE: Record<string, BadgeTone> = {
  NEW: "blue",
  NEEDS_REVIEW: "amber",
  CONTACTED: "violet",
  QUALIFIED: "green",
  PROPOSAL_SENT: "violet",
  WON: "green",
  LOST: "slate",
  DISQUALIFIED: "slate",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{status === "NEEDS_REVIEW" ? "⚑ Needs review" : titleCase(status)}</Badge>;
}

export function IntentBadge({ intent }: { intent: string }) {
  const tone: BadgeTone = intent === "HIGH" ? "green" : intent === "MEDIUM" ? "blue" : "slate";
  return <Badge tone={tone}>{titleCase(intent)} intent</Badge>;
}

const MODE: Record<string, { label: string; tone: BadgeTone }> = {
  INSTANT: { label: "Instant quote", tone: "green" },
  ESTIMATE: { label: "Estimate range", tone: "blue" },
  HUMAN_REVIEW: { label: "Human review", tone: "amber" },
  CONTACT_ONLY: { label: "Contact only", tone: "slate" },
};

export function QuoteModeBadge({ mode }: { mode: string }) {
  const m = MODE[mode] ?? { label: mode, tone: "slate" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
