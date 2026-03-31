"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Trash2, Pencil, Copy } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import type { Campaign } from "@/types/database";

const statusOptions = [
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativa" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluida" },
];

const objectiveOptions = [
  { value: "", label: "Selecione..." },
  { value: "awareness", label: "Notoriedade" },
  { value: "leads", label: "Geracao de Leads" },
  { value: "sales", label: "Vendas" },
  { value: "engagement", label: "Engagement" },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  planning: { label: "Planejamento", color: "bg-gray-100 text-gray-700" },
  active: { label: "Ativa", color: "bg-green-100 text-green-700" },
  paused: { label: "Pausada", color: "bg-yellow-100 text-yellow-700" },
  completed: { label: "Concluida", color: "bg-blue-100 text-blue-700" },
};

const emptyForm = {
  name: "",
  description: "",
  objective: "",
  status: "planning",
  budget_planned: "",
  start_date: "",
  end_date: "",
};

export default function CampaignsPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadCampaigns = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("mkt_campaigns")
      .select("*")
      .eq("org_id", organization.id)
      .order("created_at", { ascending: false });
    setCampaigns((data || []) as Campaign[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    if (organization) loadCampaigns();
  }, [organization, loadCampaigns]);

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(c: Campaign) {
    setForm({
      name: c.name,
      description: c.description || "",
      objective: c.objective || "",
      status: c.status,
      budget_planned: c.budget_planned?.toString() || "",
      start_date: c.start_date || "",
      end_date: c.end_date || "",
    });
    setEditingId(c.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      org_id: organization.id,
      name: form.name,
      description: form.description || null,
      objective: form.objective || null,
      status: form.status,
      budget_planned: form.budget_planned ? parseFloat(form.budget_planned) : 0,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      created_by: user?.id || null,
    };

    if (editingId) {
      await supabase.from("mkt_campaigns").update(payload).eq("id", editingId);
    } else {
      await supabase.from("mkt_campaigns").insert(payload);
    }

    setSaving(false);
    setShowModal(false);
    loadCampaigns();
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar esta campanha?")) return;
    const supabase = createClient();
    await supabase.from("mkt_campaigns").delete().eq("id", id);
    loadCampaigns();
  }

  async function handleClone(c: Campaign) {
    if (!organization) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("mkt_campaigns").insert({
      org_id: organization.id,
      name: c.name + " (copia)",
      description: c.description,
      objective: c.objective,
      status: "planning",
      budget_planned: c.budget_planned,
      budget_spent: 0,
      start_date: null,
      end_date: null,
      created_by: user?.id || null,
    });
    loadCampaigns();
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
            <h1 className="text-2xl font-bold">Campanhas</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus size={16} />
            Nova Campanha
          </Button>
        </div>

        {campaigns.length === 0 ? (
          <div className="text-center py-12 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Sem campanhas. Crie a primeira.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {campaigns.map((c) => {
              const progress = c.budget_planned > 0 ? (c.budget_spent / c.budget_planned) * 100 : 0;
              const config = statusConfig[c.status] || statusConfig.planning;
              return (
                <div
                  key={c.id}
                  className="rounded-xl border p-5 hover:shadow-md transition-shadow"
                  style={{ background: "var(--card)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold">{c.name}</h3>
                      {c.objective && (
                        <p className="text-xs mt-1 capitalize" style={{ color: "var(--muted-foreground)" }}>
                          Objetivo: {c.objective}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                        {config.label}
                      </span>
                      <button onClick={() => openEdit(c)} className="p-1 rounded hover:bg-gray-100" title="Editar">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleClone(c)} className="p-1 rounded hover:bg-gray-100" title="Duplicar">
                        <Copy size={14} />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1 rounded hover:bg-gray-100 text-red-500" title="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {c.description && (
                    <p className="text-xs mb-3 line-clamp-2" style={{ color: "var(--muted-foreground)" }}>{c.description}</p>
                  )}

                  {c.budget_planned > 0 && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: "var(--muted-foreground)" }}>Orcamento</span>
                        <span className="font-medium">
                          {c.budget_spent.toLocaleString("pt-PT")} / {c.budget_planned.toLocaleString("pt-PT")} EUR
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ background: "var(--secondary)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(progress, 100)}%`,
                            background: progress > 90 ? "#EF4444" : "var(--primary)",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                    <Calendar size={12} />
                    <span>
                      {c.start_date || "Sem data"} {c.end_date ? `- ${c.end_date}` : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? "Editar Campanha" : "Nova Campanha"} wide>
        <div className="space-y-4">
          <Input label="Nome da Campanha" value={form.name} onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} placeholder="Ex: Black Friday 2026" required />
          <Textarea label="Descricao" value={form.description} onChange={(e) => setForm({ ...form, description: (e.target as HTMLTextAreaElement).value })} placeholder="Descreva a campanha..." rows={3} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Objetivo" value={form.objective} onChange={(e) => setForm({ ...form, objective: (e.target as HTMLSelectElement).value })} options={objectiveOptions} />
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: (e.target as HTMLSelectElement).value })} options={statusOptions} />
            <Input label="Orcamento (EUR)" type="number" value={form.budget_planned} onChange={(e) => setForm({ ...form, budget_planned: (e.target as HTMLInputElement).value })} placeholder="0.00" />
            <div />
            <Input label="Data Inicio" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: (e.target as HTMLInputElement).value })} />
            <Input label="Data Fim" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: (e.target as HTMLInputElement).value })} />
          </div>
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
