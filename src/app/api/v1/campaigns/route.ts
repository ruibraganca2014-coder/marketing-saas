import { NextRequest } from "next/server";
import { authenticateAPI, jsonResponse, paginationParams } from "@/lib/api-auth";

// GET /api/v1/campaigns
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId } = auth;
  const { limit, offset } = paginationParams(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  let query = supabase
    .from("mkt_campaigns")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({
    data,
    pagination: { total: count, page: Math.floor(offset / limit) + 1, limit },
  });
}

// POST /api/v1/campaigns
export async function POST(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId, user } = auth;
  const body = await req.json();

  const { data, error } = await supabase
    .from("mkt_campaigns")
    .insert({ ...body, org_id: orgId, created_by: user.id })
    .select()
    .single();

  if (error) return jsonResponse({ error: error.message }, 400);

  return jsonResponse({ data }, 201);
}
