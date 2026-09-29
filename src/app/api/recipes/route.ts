import { route } from "@/server/api";
import { requireUser } from "@/server/authz";
import { RECIPES } from "@/recipes";
import { TEMPLATES } from "@/templates/registry";

export const GET = route(async (req) => {
  await requireUser(req.headers);
  return {
    recipes: RECIPES.map(({ key, name, vertical, description, status, config }) => ({
      key, name, vertical, description, status, services: (config?.services ?? []).map((s) => s.name),
    })),
    templates: TEMPLATES,
  };
});
