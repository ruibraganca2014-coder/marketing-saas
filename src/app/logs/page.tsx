"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Users, Megaphone, Share2, Mail, Zap, Globe, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

type LogEntry = {
  id: string;
  user_id: string | null;
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

const entityColors: Record<string, string> = {
  contact: "bg-blue-100 text-blue-700",
  campaign: "bg-purple-100 text-purple-700",
  social_post: "bg-pink-100 text-pink-700",
  email_campaign: "bg-green-100 text-green-700",
  automation: "bg-yellow-100 text-yellow-700",
  webhook: "bg-orange-100 text-orange-700",
  onboarding: "bg-cyan-100 text-cyan-700",
};

export default function LogsPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState("");
  const pageSize = 20;

  const load = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("mkt_activity_log")
      .select("*", { count: "exact" })
      .eq("org_id", organization.id)
      .order("created_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (filterType) query = query.eq("entity_type", filterType);

    const { data, count } = await query;
    setLogs((data || []) as LogEntry[]);
    setTotal(count || 0);
    setLoading(false);
  }, [organization, page, filterType]);

  useEffect(() => {
    if (organization) load();
  }, [organization, load]);

  const totalPages = Math.ceil(total / pageSize);

  if (orgLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p style={{ color: "var(--muted-foreground)" }}>A carregar...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Logs de Atividade</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {total} entrad{total !== 1 ? "as" : "a"} no historico
            </p>
          </div>
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={14} /> Atualizar
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {["", "contact", "campaign", "social_post", "email_campaign", "webhook", "automation"].map((type) => (
            <button
              key={type}
              onClick={() => { setFilterType(type); setPage(0); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterType === type ? "text-white" : ""
              }`}
              style={filterType === type
                ? { background: "var(--primary)" }
                : { background: "var(--secondary)", color: "var(--muted-foreground)" }
              }
            >
              {type || "Todos"}
            </button>
          ))}
        </div>

        {/* Logs Table */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--secondary)" }}>
                <th className="text-left px-4 py-3 font-medium w-44">Data/Hora</th>
                <th className="text-left px-4 py-3 font-medium w-32">Tipo</th>
                <th className="text-left px-4 py-3 font-medium w-40">Acao</th>
                <th className="text-left px-4 py-3 font-medium">Detalhes</th>
                <th className="text-left px-4 py-3 font-medium w-24">Entity ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 rounded animate-pulse" style={{ background: "var(--secondary)" }} />
                    </td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center" style={{ color: "var(--muted-foreground)" }}>
                    Sem logs de atividade
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const Icon = entityIcons[log.entity_type] || Globe;
                  const color = entityColors[log.entity_type] || "bg-gray-100 text-gray-700";
                  return (
                    <tr key={log.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                        {new Date(log.created_at).toLocaleString("pt-PT")}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                          <Icon size={10} />
                          {log.entity_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">{log.action}</td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: "var(--muted-foreground)" }}>
                        {Object.keys(log.details || {}).length > 0
                          ? JSON.stringify(log.details).substring(0, 80)
                          : "—"
                        }
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--secondary)" }}>
                          {log.entity_id.substring(0, 8)}
                        </code>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Pagina {page + 1} de {totalPages}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                <ChevronLeft size={14} /> Anterior
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
                Seguinte <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
