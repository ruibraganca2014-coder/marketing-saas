import { NextRequest } from "next/server";
import { authenticateAPI, jsonResponse, paginationParams } from "@/lib/api-auth";

// GET /api/v1/social-posts
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId } = auth;
  const { limit, offset } = paginationParams(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");

  let query = supabase
    .from("mkt_social_posts")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (platform) query = query.contains("platforms", [platform]);

  const { data, count, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({
    data,
    pagination: { total: count, page: Math.floor(offset / limit) + 1, limit },
  });
}

// POST /api/v1/social-posts
export async function POST(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId, user } = auth;
  const body = await req.json();

  if (!body.content || !body.platforms || body.platforms.length === 0) {
    return jsonResponse({ error: "content and platforms are required" }, 400);
  }

  const { data, error } = await supabase
    .from("mkt_social_posts")
    .insert({
      ...body,
      org_id: orgId,
      created_by: user.id,
      scheduled_at: body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null,
    })
    .select()
    .single();

  if (error) return jsonResponse({ error: error.message }, 400);

  return jsonResponse({ data }, 201);
}
