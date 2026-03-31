import { NextRequest } from "next/server";
import { authenticateAPI, jsonResponse } from "@/lib/api-auth";

// GET /api/v1/stats - Get dashboard stats (uses DB function for efficiency)
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if ("error" in auth) return auth.error;

  const { supabase, orgId } = auth;

  const { data, error } = await supabase.rpc("mkt_dashboard_stats", { p_org_id: orgId });

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({ data });
}
