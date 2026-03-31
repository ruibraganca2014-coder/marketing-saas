import { NextRequest } from "next/server";
import { authenticateAPI, jsonResponse, paginationParams } from "@/lib/api-auth";

// GET /api/v1/contacts - List contacts
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId } = auth;
  const { limit, offset } = paginationParams(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  let query = supabase
    .from("mkt_contacts")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);

  const { data, count, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({
    data,
    pagination: { total: count, page: Math.floor(offset / limit) + 1, limit },
  });
}

// POST /api/v1/contacts - Create contact
export async function POST(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId } = auth;
  const body = await req.json();

  const { data, error } = await supabase
    .from("mkt_contacts")
    .insert({ ...body, org_id: orgId })
    .select()
    .single();

  if (error) return jsonResponse({ error: error.message }, 400);

  return jsonResponse({ data }, 201);
}
