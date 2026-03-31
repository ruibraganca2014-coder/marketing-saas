"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Send, Eye, MousePointer, AlertCircle, Trash2, Pencil } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import type { EmailCampaign, Campaign } from "@/types/database";

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-gray-100 text-gray-700" },
  scheduled: { label: "Agendado", color: "bg-blue-100 text-blue-700" },
  sending: { label: "A enviar", color: "bg-yellow-100 text-yellow-700" },
  sent: { label: "Enviado", color: "bg-green-100 text-green-700" },
};

const statusOptions = [
  { value: "draft", label: "Rascunho" },
  { value: "scheduled", label: "Agendado" },
];

const emptyForm = {
  name: "",
  subject: "",
  status: "draft",
  scheduled_at: "",
  campaign_id: "",
};

export default function EmailPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [emailCampaigns, setEmailCampaigns] = useState<EmailCampaign[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const [emailRes, campaignsRes] = await Promise.all([
      supabase.from("mkt_email_campaigns").select("*").eq("org_id", organization.id).order("created_at", { ascending: false }),
      supabase.from("mkt_campaigns").select("id, name").eq("org_id", organization.id).order("name"),
    ]);
    setEmailCampaigns((emailRes.data || []) as EmailCampaign[]);
    setCampaigns((campaignsRes.data || []) as Campaign[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    if (organization) load();
  }, [organization, load]);

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(ec: EmailCampaign) {
    setForm({
      name: ec.name,
      subject: ec.subject || "",
      status: ec.status,
      scheduled_at: ec.scheduled_at ? ec.scheduled_at.slice(0, 16) : "",
      campaign_id: ec.campaign_id || "",
    });
    setEditingId(ec.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();

    const payload = {
      org_id: organization.id,
      name: form.name,
      subject: form.subject || null,
      status: form.status,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      campaign_id: form.campaign_id || null,
    };

    if (editingId) {
      await supabase.from("mkt_email_campaigns").update(payload).eq("id", editingId);
    } else {
      await supabase.from("mkt_email_campaigns").insert(payload);
    }

    setSaving(false);
    setShowModal(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar esta campanha de email?")) return;
    const supabase = createClient();
    await supabase.from("mkt_email_campaigns").delete().eq("id", id);
    load();
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

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Email Marketing</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {emailCampaigns.length} campanha{emailCampaigns.length !== 1 ? "s" : ""} de email
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus size={16} />
            Nova Campanha Email
          </Button>
        </div>

        {emailCampaigns.length === 0 ? (
          <div className="text-center py-12 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Sem campanhas de email. Crie a primeira.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {emailCampaigns.map((ec) => {
              const config = statusConfig[ec.status] || statusConfig.draft;
              const openRate = ec.total_sent > 0 ? ((ec.total_opened / ec.total_sent) * 100).toFixed(1) : "0";
              const clickRate = ec.total_sent > 0 ? ((ec.total_clicked / ec.total_sent) * 100).toFixed(1) : "0";

              return (
                <div
                  key={ec.id}
                  className="rounded-xl border p-5 hover:shadow-md transition-shadow"
                  style={{ background: "var(--card)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold">{ec.name}</h3>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                          {config.label}
                        </span>
                      </div>
                      {ec.subject && (
                        <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
                          Assunto: {ec.subject}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      {ec.status === "sent" && (
                        <div className="flex items-center gap-6 text-sm mr-4">
                          <div className="text-center">
                            <div className="flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                              <Send size={14} />
                              <span className="text-xs">Enviados</span>
                            </div>
                            <p className="font-bold">{ec.total_sent.toLocaleString()}</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                              <Eye size={14} />
                              <span className="text-xs">Abertos</span>
                            </div>
                            <p className="font-bold">{openRate}%</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                              <MousePointer size={14} />
                              <span className="text-xs">Cliques</span>
                            </div>
                            <p className="font-bold">{clickRate}%</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                              <AlertCircle size={14} />
                              <span className="text-xs">Bounce</span>
                            </div>
                            <p className="font-bold">{ec.total_bounced}</p>
                          </div>
                        </div>
                      )}

                      <button onClick={() => openEdit(ec)} className="p-1.5 rounded hover:bg-gray-100">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(ec.id)} className="p-1.5 rounded hover:bg-gray-100 text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? "Editar Campanha Email" : "Nova Campanha Email"} wide>
        <div className="space-y-4">
          <Input label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} placeholder="Ex: Newsletter Abril" required />
          <Input label="Assunto" value={form.subject} onChange={(e) => setForm({ ...form, subject: (e.target as HTMLInputElement).value })} placeholder="Assunto do email..." />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: (e.target as HTMLSelectElement).value })} options={statusOptions} />
            <Select
              label="Campanha (opcional)"
              value={form.campaign_id}
              onChange={(e) => setForm({ ...form, campaign_id: (e.target as HTMLSelectElement).value })}
              options={[{ value: "", label: "Nenhuma" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
          {form.status === "scheduled" && (
            <Input
              label="Agendar para"
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: (e.target as HTMLInputElement).value })}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={!form.name}>
            {editingId ? "Guardar" : "Criar Campanha"}
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
