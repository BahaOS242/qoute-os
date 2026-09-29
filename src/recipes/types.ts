import type { QuoteConfigInput } from "@/core/config/schema";

export interface Recipe {
  key: string;
  name: string;
  vertical: string;
  description: string;
  /** "available" recipes can be cloned; "planned" ones are placeholders in the catalog. */
  status: "available" | "planned";
  /** Configuration input (validated with validateQuoteConfig when applied). */
  config: QuoteConfigInput | null;
}
