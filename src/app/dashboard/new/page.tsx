import { requirePageUser } from "@/server/page-auth";
import { RECIPES } from "@/recipes";
import { TEMPLATES } from "@/templates/registry";
import { NewOrganizationForm } from "@/components/dashboard/new-org-form";

export const metadata = { title: "New organization" };

export default async function NewOrganizationPage() {
  await requirePageUser("/dashboard/new");
  const recipes = RECIPES.map(({ key, name, vertical, description, status, config }) => ({
    key, name, vertical, description, status, services: (config?.services ?? []).map((s) => s.name),
  }));
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-xl font-semibold">Create a client organization</h1>
      <p className="mt-1 text-sm text-slate-500">Recipe + client branding + client pricing = a new, fully working quote funnel. Everything can be changed later.</p>
      <div className="mt-8">
        <NewOrganizationForm recipes={recipes} templates={TEMPLATES} />
      </div>
    </main>
  );
}
