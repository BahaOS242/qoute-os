import { orgRoute } from "@/server/api";
import { rotateWebhookSecret } from "@/server/services/organizations";

export const POST = orgRoute("OWNER", async (_req, ctx) => rotateWebhookSecret(ctx));
