"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Mail, Phone, Building2, Briefcase, Tag,
  MessageSquare, Calendar, TrendingUp, Edit2, Star,
} from "lucide-react";
import type { Contact, Deal } from "@/types/database";

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  qualified: "bg-purple-100 text-purple-700",
  proposal: "bg-pink-100 text-pink-700",
  customer: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  new: "Novo",
  contacted: "Contactado",
  qualified: "Qualificado",
  proposal: "Proposta",
  customer: "Cliente",
  lost: "Perdido",
};

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { organization, loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!organization || !params.id) return;
    const supabase = createClient();

    const [contactRes, dealsRes] = await Promise.all([
      supabase.from("mkt_contacts").select("*").eq("id", params.id).eq("org_id", organization.id).single(),
      supabase.from("mkt_deals").select("*").eq("contact_id", params.id).eq("org_id", organization.id),
    ]);

    setContact(contactRes.data as Contact | null);
    setDeals((dealsRes.data || []) as Deal[]);
    setNote((contactRes.data as Contact | null)?.notes || "");
    setLoading(false);
  }, [organization, params.id]);

  useEffect(() => {
    if (organization) load();
  }, [organization, load]);

  async function saveNotes() {
    if (!contact) return;
    const supabase = createClient();
    await supabase.from("mkt_contacts").update({ notes: note }).eq("id", contact.id);
    toast("Notas guardadas!");
  }

  if (orgLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p style={{ color: "var(--muted-foreground)" }}>A carregar...</p>
        </div>
      </AppLayout>
    );
  }

  if (!contact) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <p>Contato nao encontrado.</p>
          <Button variant="secondary" onClick={() => router.push("/contacts")} className="mt-4">
            Voltar
          </Button>
        </div>
      </AppLayout>
    );
  }

  const totalDealValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/contacts")} className="p-2 rounded-lg hover:bg-gray-100/10">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{contact.first_name} {contact.last_name}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[contact.status] || ""}`}>
                {statusLabels[contact.status] || contact.status}
              </span>
            </div>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {contact.company} {contact.job_title ? `- ${contact.job_title}` : ""}
            </p>
          </div>
          <Button variant="secondary" onClick={() => router.push("/contacts")}>
            <Edit2 size={14} />
            Editar
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contact Info Card */}
            <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold mb-4">Informacoes de Contato</h3>
              <div className="grid grid-cols-2 gap-4">
                {contact.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail size={16} style={{ color: "var(--muted-foreground)" }} />
                    <a href={`mailto:${contact.email}`} className="hover:underline" style={{ color: "var(--primary)" }}>
                      {contact.email}
                    </a>
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone size={16} style={{ color: "var(--muted-foreground)" }} />
                    <span>{contact.phone}</span>
                  </div>
                )}
                {contact.company && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 size={16} style={{ color: "var(--muted-foreground)" }} />
                    <span>{contact.company}</span>
                  </div>
                )}
                {contact.job_title && (
                  <div className="flex items-center gap-2 text-sm">
                    <Briefcase size={16} style={{ color: "var(--muted-foreground)" }} />
                    <span>{contact.job_title}</span>
                  </div>
                )}
                {contact.source && (
                  <div className="flex items-center gap-2 text-sm">
                    <Tag size={16} style={{ color: "var(--muted-foreground)" }} />
                    <span>Origem: {contact.source}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Calendar size={16} style={{ color: "var(--muted-foreground)" }} />
                  <span>Criado: {new Date(contact.created_at).toLocaleDateString("pt-PT")}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <MessageSquare size={16} />
                  Notas
                </h3>
                <Button size="sm" onClick={saveNotes}>Guardar</Button>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Adicionar notas sobre este contato..."
                rows={5}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                style={{ borderColor: "var(--border)", background: "var(--background)" }}
              />
            </div>

            {/* Deals */}
            <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold mb-4">Deals ({deals.length})</h3>
              {deals.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  Sem deals associados.
                </p>
              ) : (
                <div className="space-y-2">
                  {deals.map((deal) => (
                    <div key={deal.id} className="flex items-center justify-between py-2 px-3 rounded-lg border" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-sm font-medium">{deal.title}</p>
                        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                          Status: {deal.status} | Prob: {deal.probability}%
                        </p>
                      </div>
                      <span className="text-sm font-bold" style={{ color: "var(--primary)" }}>
                        {(deal.value || 0).toLocaleString("pt-PT")} EUR
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column - Score & Stats */}
          <div className="space-y-6">
            {/* Score */}
            <div className="rounded-xl border p-6 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold mb-3">Lead Score</h3>
              <div className="relative w-24 h-24 mx-auto mb-3">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="40" fill="none"
                    stroke={contact.score > 70 ? "#22C55E" : contact.score > 40 ? "#F59E0B" : "#EF4444"}
                    strokeWidth="8"
                    strokeDasharray={`${contact.score * 2.51} 251`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold">{contact.score}</span>
                </div>
              </div>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {contact.score > 70 ? "Lead quente" : contact.score > 40 ? "Lead morno" : "Lead frio"}
              </p>
            </div>

            {/* Quick Stats */}
            <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold mb-4">Resumo</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--muted-foreground)" }}>Deals</span>
                  <span className="font-medium">{deals.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--muted-foreground)" }}>Valor total</span>
                  <span className="font-medium">{totalDealValue.toLocaleString("pt-PT")} EUR</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--muted-foreground)" }}>Tags</span>
                  <span className="font-medium">{contact.tags?.length || 0}</span>
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold mb-3">Tags</h3>
              {(!contact.tags || contact.tags.length === 0) ? (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Sem tags</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {contact.tags.map((tag) => (
                    <span key={tag} className="px-2 py-1 rounded-full text-xs" style={{ background: "var(--secondary)" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
