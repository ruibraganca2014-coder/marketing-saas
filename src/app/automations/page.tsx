"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Select } from "@/components/ui/input";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/components/ui/toast";
import { useState } from "react";
import { Plus, Zap, ArrowRight, Play, Pause, Trash2 } from "lucide-react";

type Automation = {
  id: string;
  name: string;
  trigger: string;
  action: string;
  active: boolean;
};

const triggerOptions = [
  { value: "", label: "Selecione um trigger..." },
  { value: "contact.created", label: "Quando contato e criado" },
  { value: "contact.status_changed", label: "Quando status do contato muda" },
  { value: "deal.created", label: "Quando deal e criado" },
  { value: "deal.stage_changed", label: "Quando deal muda de estagio" },
  { value: "campaign.started", label: "Quando campanha inicia" },
  { value: "post.published", label: "Quando post e publicado" },
];

const actionOptions = [
  { value: "", label: "Selecione uma acao..." },
  { value: "send_email", label: "Enviar email de notificacao" },
  { value: "update_score", label: "Atualizar lead score (+10)" },
  { value: "add_tag", label: "Adicionar tag ao contato" },
  { value: "move_pipeline", label: "Mover deal no pipeline" },
  { value: "create_task", label: "Criar tarefa de follow-up" },
  { value: "webhook", label: "Enviar webhook externo" },
];

const triggerLabels: Record<string, string> = Object.fromEntries(triggerOptions.filter(o => o.value).map(o => [o.value, o.label]));
const actionLabels: Record<string, string> = Object.fromEntries(actionOptions.filter(o => o.value).map(o => [o.value, o.label]));

export default function AutomationsPage() {
  const { loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [automations, setAutomations] = useState<Automation[]>([
    { id: "1", name: "Welcome email para novos leads", trigger: "contact.created", action: "send_email", active: true },
    { id: "2", name: "Score boost ao qualificar", trigger: "contact.status_changed", action: "update_score", active: true },
    { id: "3", name: "Notificar equipa de novo deal", trigger: "deal.created", action: "webhook", active: false },
  ]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", trigger: "", action: "" });

  function handleCreate() {
    if (!form.name || !form.trigger || !form.action) return;
    const newAuto: Automation = {
      id: Date.now().toString(),
      name: form.name,
      trigger: form.trigger,
      action: form.action,
      active: true,
    };
    setAutomations([...automations, newAuto]);
    setShowModal(false);
    setForm({ name: "", trigger: "", action: "" });
    toast("Automacao criada!");
  }

  function toggleActive(id: string) {
    setAutomations(automations.map((a) =>
      a.id === id ? { ...a, active: !a.active } : a
    ));
    const auto = automations.find((a) => a.id === id);
    toast(auto?.active ? "Automacao pausada" : "Automacao ativada");
  }

  function handleDelete(id: string) {
    if (!confirm("Eliminar esta automacao?")) return;
    setAutomations(automations.filter((a) => a.id !== id));
    toast("Automacao eliminada");
  }

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
            <h1 className="text-2xl font-bold">Automacoes</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {automations.filter((a) => a.active).length} ativas de {automations.length}
            </p>
          </div>
          <Button onClick={() => setShowModal(true)}>
            <Plus size={16} /> Nova Automacao
          </Button>
        </div>

        {/* Automations List */}
        <div className="space-y-3">
          {automations.map((auto) => (
            <div
              key={auto.id}
              className={`rounded-xl border p-5 transition-opacity ${!auto.active ? "opacity-50" : ""}`}
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${auto.active ? "bg-green-500/10" : "bg-gray-500/10"}`}>
                    <Zap size={20} className={auto.active ? "text-green-500" : "text-gray-400"} />
                  </div>
                  <div>
                    <h3 className="font-semibold">{auto.name}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      <span className="px-2 py-0.5 rounded-full" style={{ background: "var(--secondary)" }}>
                        {triggerLabels[auto.trigger] || auto.trigger}
                      </span>
                      <ArrowRight size={12} />
                      <span className="px-2 py-0.5 rounded-full" style={{ background: "var(--secondary)" }}>
                        {actionLabels[auto.action] || auto.action}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${auto.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {auto.active ? "Ativa" : "Pausada"}
                  </span>
                  <button onClick={() => toggleActive(auto.id)} className="p-1.5 rounded hover:bg-gray-100/10" title={auto.active ? "Pausar" : "Ativar"}>
                    {auto.active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button onClick={() => handleDelete(auto.id)} className="p-1.5 rounded hover:bg-gray-100/10 text-red-500" title="Eliminar">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {automations.length === 0 && (
            <div className="text-center py-12 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <Zap size={32} className="mx-auto mb-3" style={{ color: "var(--muted-foreground)" }} />
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                Sem automacoes. Crie a primeira para automatizar o seu marketing.
              </p>
            </div>
          )}
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nova Automacao">
        <div className="space-y-4">
          <Input label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} placeholder="Ex: Welcome email para novos leads" />
          <Select label="Quando (trigger)" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: (e.target as HTMLSelectElement).value })} options={triggerOptions} />
          <Select label="Entao (acao)" value={form.action} onChange={(e) => setForm({ ...form, action: (e.target as HTMLSelectElement).value })} options={actionOptions} />

          {form.trigger && form.action && (
            <div className="p-3 rounded-lg text-xs flex items-center gap-2" style={{ background: "var(--secondary)" }}>
              <Zap size={14} style={{ color: "var(--primary)" }} />
              <span>{triggerLabels[form.trigger]}</span>
              <ArrowRight size={12} />
              <span>{actionLabels[form.action]}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={!form.name || !form.trigger || !form.action}>
            Criar Automacao
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
