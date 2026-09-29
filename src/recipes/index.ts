/**
 * Vertical recipe catalog. A recipe is a portable QuoteConfig plus metadata; adding a vertical
 * means adding a file here - the engine does not change.
 */
import { accountingRecipe } from "./accounting";
import type { Recipe } from "./types";

export type { Recipe };

const planned = (key: string, name: string, vertical: string, description: string): Recipe => ({
  key,
  name,
  vertical,
  description,
  status: "planned",
  config: null,
});

export const RECIPES: Recipe[] = [
  accountingRecipe,
  planned("insurance", "Insurance", "Insurance brokers & agents", "Coverage-needs questionnaire with carrier routing."),
  planned("agency", "Agency", "Marketing, design & development agencies", "Scope-based project estimates and retainers."),
  planned("solar", "Solar", "Residential & commercial solar installers", "System sizing estimates from roof and usage data."),
  planned("contractor", "Contractor", "Home services & trades", "Job estimates with site-visit routing."),
];

export function getRecipe(key: string): Recipe | undefined {
  return RECIPES.find((r) => r.key === key);
}
