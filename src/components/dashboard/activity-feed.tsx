"use client";

import { createClient } from "@/lib/supabase";
import { useEffect, useState, useCallback } from "react";
import { Users, Megaphone, Share2, Mail, Zap, Globe, Clock } from "lucide-react";

type Activity = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

const entityIcons: Record<string, typeof Users> = {
  contact: Users,
  campaign: Megaphone,
  social_post: Share2,
  email_campaign: Mail,
  automation: Zap,
  webhook: Globe,
  onboarding: Users,
};

const actionLabels: Record<string, string> = {
  created: "criou",
  updated: "atualizou",
  deleted: "eliminou",
  completed_onboarding: "completou onboarding",
  "contact.created": "contato criado via webhook",
  "social.published": "post publicado via webhook",
};

export function ActivityFeed({ orgId }: { orgId: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("mkt_activity_log")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(15);
    setActivities((data || []) as Activity[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m atras`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atras`;
    const days = Math.floor(hours / 24);
    return `${days}d atras`;
  }

  return (
    <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <h3 className="text-lg font-semibold mb-4">Atividade Recente</h3>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>A carregar...</p>
      ) : activities.length === 0 ? (
        <div className="text-center py-8">
          <Clock size={24} className="mx-auto mb-2" style={{ color: "var(--muted-foreground)" }} />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Sem atividade recente. As acoes no sistema aparecerao aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-0">
          {activities.map((activity, i) => {
            const Icon = entityIcons[activity.entity_type] || Globe;
            return (
              <div
                key={activity.id}
                className={`flex items-start gap-3 py-3 ${i < activities.length - 1 ? "border-b" : ""}`}
                style={{ borderColor: "var(--border)" }}
              >
                <div className="p-1.5 rounded-lg mt-0.5" style={{ background: "var(--secondary)" }}>
                  <Icon size={14} style={{ color: "var(--primary)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{activity.entity_type}</span>
                    {" "}
                    <span style={{ color: "var(--muted-foreground)" }}>
                      {actionLabels[activity.action] || activity.action}
                    </span>
                  </p>
                  {activity.details && Object.keys(activity.details).length > 0 && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
                      {JSON.stringify(activity.details).substring(0, 80)}
                    </p>
                  )}
                </div>
                <span className="text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>
                  {timeAgo(activity.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
