import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Webhook endpoint for receiving events from external services
 *
 * POST /api/webhooks
 *
 * Headers:
 *   X-Webhook-Secret: <webhook_secret>
 *
 * Body:
 *   { event: string, data: object }
 *
 * Supported events:
 *   - contact.created: Create a new contact
 *   - contact.updated: Update an existing contact
 *   - social.published: Mark a social post as published
 *   - email.sent: Update email campaign metrics
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret");
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhooks not configured. Set WEBHOOK_SECRET env var." }, { status: 503 });
  }

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { event, data, org_id } = body;

    if (!event || !data || !org_id) {
      return NextResponse.json({ error: "event, data, and org_id are required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    let result;

    switch (event) {
      case "contact.created":
        result = await supabase
          .from("mkt_contacts")
          .insert({ ...data, org_id })
          .select()
          .single();
        break;

      case "contact.updated":
        if (!data.id) return NextResponse.json({ error: "data.id required for update" }, { status: 400 });
        result = await supabase
          .from("mkt_contacts")
          .update(data)
          .eq("id", data.id)
          .eq("org_id", org_id)
          .select()
          .single();
        break;

      case "social.published":
        if (!data.post_id) return NextResponse.json({ error: "data.post_id required" }, { status: 400 });
        result = await supabase
          .from("mkt_social_posts")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("id", data.post_id)
          .eq("org_id", org_id)
          .select()
          .single();
        break;

      case "email.metrics":
        if (!data.campaign_id) return NextResponse.json({ error: "data.campaign_id required" }, { status: 400 });
        result = await supabase
          .from("mkt_email_campaigns")
          .update({
            total_sent: data.total_sent || 0,
            total_opened: data.total_opened || 0,
            total_clicked: data.total_clicked || 0,
            total_bounced: data.total_bounced || 0,
          })
          .eq("id", data.campaign_id)
          .eq("org_id", org_id)
          .select()
          .single();
        break;

      default:
        return NextResponse.json({ error: `Unknown event: ${event}` }, { status: 400 });
    }

    if (result?.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    // Log the webhook event
    await supabase.from("mkt_activity_log").insert({
      org_id,
      entity_type: "webhook",
      entity_id: result?.data?.id || "unknown",
      action: event,
      details: { source: "webhook", event },
    });

    return NextResponse.json({ success: true, data: result?.data });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
