import { orgRoute, readJson } from "@/server/api";
import { addMember, addMemberSchema, listMembers } from "@/server/services/organizations";

export const GET = orgRoute("MEMBER", async (_req, ctx) => listMembers(ctx));
export const POST = orgRoute("OWNER", async (req, ctx) => addMember(ctx, await readJson(req, addMemberSchema)));
