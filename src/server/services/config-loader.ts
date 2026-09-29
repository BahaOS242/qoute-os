/** Maps database configuration rows onto the pure engine types. */
import type { PricingRule, Question, QuestionOption, Service } from "@prisma/client";
import type { QuestionConfig, QuestionDef } from "@/core/questions";
import type { PricingRuleDef } from "@/core/pricing";
import { prisma, type Tx } from "../db";
import { notFound } from "../errors";

export type QuestionWithOptions = Question & { options: QuestionOption[] };

export function toQuestionDef(q: QuestionWithOptions): QuestionDef {
  return {
    key: q.key,
    label: q.label,
    type: q.type,
    required: q.required,
    order: q.order,
    active: q.active,
    description: q.description,
    helpText: q.helpText,
    config: (q.config ?? {}) as QuestionConfig,
    visibleWhen: q.visibleWhen ?? null,
    leadField: q.leadField,
    options: [...q.options]
      .sort((a, b) => a.order - b.order)
      .map((o) => ({
        label: o.label,
        value: o.value,
        description: ((o.metadata ?? {}) as { description?: string }).description,
      })),
  };
}

export function toPricingRuleDef(r: PricingRule): PricingRuleDef {
  return { key: r.key, name: r.name, priority: r.priority, condition: r.condition ?? null, action: r.action, active: r.active };
}

export interface EngineConfig {
  service: Service;
  questions: QuestionDef[];
  rules: PricingRuleDef[];
}

/** Load a service's questions and rules, always scoped to its organization. */
export async function loadEngineConfig(organizationId: string, serviceId: string, db: Tx = prisma): Promise<EngineConfig> {
  const service = await db.service.findFirst({
    where: { id: serviceId, organizationId },
    include: {
      questions: { where: { active: true }, include: { options: true }, orderBy: { order: "asc" } },
      pricingRules: { where: { active: true } },
    },
  });
  if (!service) throw notFound("Service");
  const { questions, pricingRules, ...rest } = service;
  return { service: rest, questions: questions.map(toQuestionDef), rules: pricingRules.map(toPricingRuleDef) };
}
