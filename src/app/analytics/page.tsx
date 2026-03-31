"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from "recharts";
import type { Contact, Campaign, SocialPost } from "@/types/database";

export default function AnalyticsPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const [c, camp, p] = await Promise.all([
      supabase.from("mkt_contacts").select("*").eq("org_id", organization.id),
      supabase.from("mkt_campaigns").select("*").eq("org_id", organization.id),
      supabase.from("mkt_social_posts").select("*").eq("org_id", organization.id),
    ]);
    setContacts((c.data || []) as Contact[]);
    setCampaigns((camp.data || []) as Campaign[]);
    setPosts((p.data || []) as SocialPost[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    if (organization) load();
  }, [organization, load]);

  if (orgLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p style={{ color: "var(--muted-foreground)" }}>A carregar analytics...</p>
        </div>
      </AppLayout>
    );
  }

  // Build chart data from real data
  const statusCounts = contacts.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  const sourceCounts = contacts.reduce((acc, c) => {
    const source = c.source || "desconhecido";
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sourceData = Object.entries(sourceCounts)
    .map(([name, leads]) => ({ name, leads }))
    .sort((a, b) => b.leads - a.leads);

  const campaignData = campaigns.map((c) => ({
    name: c.name.length > 15 ? c.name.substring(0, 15) + "..." : c.name,
    planeado: c.budget_planned,
    gasto: c.budget_spent,
  }));

  const postsByPlatform = posts.reduce((acc, p) => {
    (p.platforms || []).forEach((plat) => {
      acc[plat] = (acc[plat] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);

  const platformData = Object.entries(postsByPlatform).map(([name, value]) => ({ name, value }));

  const postsByStatus = posts.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const postStatusData = Object.entries(postsByStatus).map(([name, value]) => ({ name, value }));

  const scoreDistribution = [
    { range: "0-20", count: contacts.filter((c) => c.score <= 20).length },
    { range: "21-40", count: contacts.filter((c) => c.score > 20 && c.score <= 40).length },
    { range: "41-60", count: contacts.filter((c) => c.score > 40 && c.score <= 60).length },
    { range: "61-80", count: contacts.filter((c) => c.score > 60 && c.score <= 80).length },
    { range: "81-100", count: contacts.filter((c) => c.score > 80).length },
  ];

  const colors = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4"];

  const totalBudget = campaigns.reduce((s, c) => s + (c.budget_planned || 0), 0);
  const totalSpent = campaigns.reduce((s, c) => s + (c.budget_spent || 0), 0);
  const avgScore = contacts.length > 0 ? Math.round(contacts.reduce((s, c) => s + c.score, 0) / contacts.length) : 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Analise detalhada de {organization?.name}
          </p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Contatos", value: contacts.length },
            { label: "Score Medio", value: avgScore },
            { label: "Orcamento Total", value: `${totalBudget.toLocaleString("pt-PT")} EUR` },
            { label: "Gasto Total", value: `${totalSpent.toLocaleString("pt-PT")} EUR` },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{kpi.label}</p>
              <p className="text-xl font-bold mt-1">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contacts by Status */}
          <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold mb-4">Contatos por Status</h3>
            <div className="h-56">
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {statusData.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-center pt-20" style={{ color: "var(--muted-foreground)" }}>Sem dados</p>
              )}
            </div>
          </div>

          {/* Contacts by Source */}
          <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold mb-4">Contatos por Origem</h3>
            <div className="h-56">
              {sourceData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceData} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={80} />
                    <Tooltip />
                    <Bar dataKey="leads" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-center pt-20" style={{ color: "var(--muted-foreground)" }}>Sem dados</p>
              )}
            </div>
          </div>

          {/* Campaign Budgets */}
          <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold mb-4">Orcamento vs Gasto por Campanha</h3>
            <div className="h-56">
              {campaignData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={campaignData} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <Tooltip />
                    <Bar dataKey="planeado" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="gasto" fill="#22C55E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-center pt-20" style={{ color: "var(--muted-foreground)" }}>Sem campanhas</p>
              )}
            </div>
          </div>

          {/* Lead Score Distribution */}
          <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold mb-4">Distribuicao de Lead Score</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreDistribution} margin={{ left: -10, right: 10 }}>
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="range" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="#8B5CF6" fill="url(#scoreGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Posts by Platform */}
          <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold mb-4">Posts por Plataforma</h3>
            <div className="h-56">
              {platformData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={platformData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {platformData.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-center pt-20" style={{ color: "var(--muted-foreground)" }}>Sem posts</p>
              )}
            </div>
          </div>

          {/* Posts by Status */}
          <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold mb-4">Posts por Status</h3>
            <div className="h-56">
              {postStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={postStatusData} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-center pt-20" style={{ color: "var(--muted-foreground)" }}>Sem posts</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
