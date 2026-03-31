"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Modal } from "@/components/ui/modal";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, DollarSign } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import type { Deal, PipelineStage, Contact } from "@/types/database";

const emptyForm = {
  title: "",
  value: "",
  contact_id: "",
  stage_id: "",
  probability: "50",
  expected_close_date: "",
};

export default function DealsPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const [dealsRes, stagesRes, contactsRes] = await Promise.all([
      supabase.from("mkt_deals").select("*").eq("org_id", organization.id).order("created_at"),
      supabase.from("mkt_pipeline_stages").select("*").eq("org_id", organization.id).order("position"),
      supabase.from("mkt_contacts").select("id, first_name, last_name").eq("org_id", organization.id),
    ]);
    setDeals((dealsRes.data || []) as Deal[]);
    setStages((stagesRes.data || []) as PipelineStage[]);
    setContacts((contactsRes.data || []) as Contact[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    if (organization) load();
  }, [organization, load]);

  function openCreate(stageId?: string) {
    setForm({ ...emptyForm, stage_id: stageId || stages[0]?.id || "" });
    setShowModal(true);
  }

  async function handleSave() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();

    await supabase.from("mkt_deals").insert({
      org_id: organization.id,
      title: form.title,
      value: form.value ? parseFloat(form.value) : 0,
      contact_id: form.contact_id || null,
      stage_id: form.stage_id || null,
      probability: parseInt(form.probability) || 50,
      expected_close_date: form.expected_close_date || null,
      status: "open",
    });

    setSaving(false);
    setShowModal(false);
    load();
  }

  async function handleDrop(stageId: string) {
    if (!draggedDeal) return;
    const supabase = createClient();
    await supabase.from("mkt_deals").update({ stage_id: stageId }).eq("id", draggedDeal);
    setDraggedDeal(null);
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

  const totalValue = deals.filter((d) => d.status === "open").reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Pipeline de Vendas</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {deals.length} deal{deals.length !== 1 ? "s" : ""} | Valor total: {totalValue.toLocaleString("pt-PT")} EUR
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => window.location.href = "/contacts"}>
              Voltar a Contatos
            </Button>
            <Button onClick={() => openCreate()}>
              <Plus size={16} />
              Novo Deal
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stage_id === stage.id);
            const stageValue = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);

            return (
              <div
                key={stage.id}
                className="flex-shrink-0 w-72 rounded-xl border"
                style={{ borderColor: "var(--border)", background: "var(--background)" }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage.id)}
              >
                {/* Stage Header */}
                <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: stage.color }} />
                    <span className="text-sm font-semibold">{stage.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                      {stageDeals.length}
                    </span>
                  </div>
                  <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                    {stageValue.toLocaleString("pt-PT")} EUR
                  </span>
                </div>

                {/* Deals */}
                <div className="p-2 space-y-2 min-h-[120px]">
                  {stageDeals.map((deal) => {
                    const contact = contacts.find((c) => c.id === deal.contact_id);
                    return (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={() => setDraggedDeal(deal.id)}
                        className="rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                        style={{ background: "var(--card)", borderColor: "var(--border)" }}
                      >
                        <p className="text-sm font-medium">{deal.title}</p>
                        {contact && (
                          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                            {contact.first_name} {contact.last_name}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--primary)" }}>
                            <DollarSign size={12} />
                            {(deal.value || 0).toLocaleString("pt-PT")} EUR
                          </div>
                          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                            {deal.probability}%
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    onClick={() => openCreate(stage.id)}
                    className="w-full text-xs py-2 rounded-lg border border-dashed hover:bg-gray-50/5 transition-colors"
                    style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
                  >
                    + Adicionar deal
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Novo Deal">
        <div className="space-y-4">
          <Input label="Titulo" value={form.title} onChange={(e) => setForm({ ...form, title: (e.target as HTMLInputElement).value })} placeholder="Ex: Contrato Empresa X" required />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Valor (EUR)" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: (e.target as HTMLInputElement).value })} placeholder="0" />
            <Input label="Probabilidade (%)" type="number" value={form.probability} onChange={(e) => setForm({ ...form, probability: (e.target as HTMLInputElement).value })} min="0" max="100" />
          </div>
          <Select
            label="Contato"
            value={form.contact_id}
            onChange={(e) => setForm({ ...form, contact_id: (e.target as HTMLSelectElement).value })}
            options={[{ value: "", label: "Nenhum" }, ...contacts.map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }))]}
          />
          <Select
            label="Estagio"
            value={form.stage_id}
            onChange={(e) => setForm({ ...form, stage_id: (e.target as HTMLSelectElement).value })}
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Input label="Data prevista de fecho" type="date" value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: (e.target as HTMLInputElement).value })} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={!form.title}>Criar Deal</Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
