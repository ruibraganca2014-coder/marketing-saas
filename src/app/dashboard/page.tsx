"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { KpiCard } from "@/components/ui/kpi-card";
import { Users, Megaphone, Share2, Mail } from "lucide-react";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import { useEffect, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { ChannelsChart } from "@/components/dashboard/channels-chart";
import { CampaignROIChart } from "@/components/dashboard/campaign-roi-chart";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { DashboardSkeleton } from "@/components/ui/skeleton";

type DashboardStats = {
  totalContacts: number;
  activeCampaigns: number;
  scheduledPosts: number;
  emailsSent: number;
  recentActivity: { action: string; detail: string; time: string }[];
};

export default function DashboardPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [stats, setStats] = useState<DashboardStats>({
    totalContacts: 0,
    activeCampaigns: 0,
    scheduledPosts: 0,
    emailsSent: 0,
    recentActivity: [],
  });
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const orgId = organization.id;

    const [contacts, campaigns, posts, emails] = await Promise.all([
      supabase.from("mkt_contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("mkt_campaigns").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
      supabase.from("mkt_social_posts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "scheduled"),
      supabase.from("mkt_email_campaigns").select("total_sent").eq("org_id", orgId),
    ]);

    const totalEmailsSent = (emails.data || []).reduce((sum, e) => sum + (e.total_sent || 0), 0);

    setStats({
      totalContacts: contacts.count || 0,
      activeCampaigns: campaigns.count || 0,
      scheduledPosts: posts.count || 0,
      emailsSent: totalEmailsSent,
      recentActivity: [],
    });
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Realtime: refresh KPIs when data changes
  useRealtime("mkt_contacts", organization?.id, loadStats);
  useRealtime("mkt_campaigns", organization?.id, loadStats);
  useRealtime("mkt_social_posts", organization?.id, loadStats);

  if (orgLoading) {
    return (
      <AppLayout>
        <DashboardSkeleton />
      </AppLayout>
    );
  }

  if (!organization) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-lg font-medium">Sem organizacao</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
              Crie uma conta para comecar a usar o MarketingSaaS.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Visao geral - {organization.name}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Contatos" value={stats.totalContacts} icon={Users} />
          <KpiCard title="Campanhas Ativas" value={stats.activeCampaigns} icon={Megaphone} />
          <KpiCard title="Posts Agendados" value={stats.scheduledPosts} icon={Share2} />
          <KpiCard title="Emails Enviados" value={stats.emailsSent} icon={Mail} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PerformanceChart />
          <ChannelsChart />
        </div>

        {/* Bottom Row: ROI + Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <CampaignROIChart />

          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-lg font-semibold">Acoes Rapidas</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href="/contacts"
                className="rounded-xl border p-5 hover:shadow-md transition-shadow"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <Users size={24} style={{ color: "var(--primary)" }} />
                <h3 className="font-semibold mt-3">Adicionar Contato</h3>
                <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                  Criar novo lead ou contato no CRM
                </p>
              </a>
              <a
                href="/campaigns"
                className="rounded-xl border p-5 hover:shadow-md transition-shadow"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <Megaphone size={24} style={{ color: "var(--primary)" }} />
                <h3 className="font-semibold mt-3">Nova Campanha</h3>
                <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                  Planear campanha de marketing
                </p>
              </a>
              <a
                href="/social"
                className="rounded-xl border p-5 hover:shadow-md transition-shadow"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <Share2 size={24} style={{ color: "var(--primary)" }} />
                <h3 className="font-semibold mt-3">Agendar Post</h3>
                <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                  Criar e agendar conteudo social
                </p>
              </a>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <ActivityFeed orgId={organization.id} />
      </div>
    </AppLayout>
  );
}
