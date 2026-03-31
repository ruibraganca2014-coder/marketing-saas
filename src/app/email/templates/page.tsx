"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Eye, Copy } from "lucide-react";
import type { EmailTemplate } from "@/types/database";

const defaultTemplates = [
  {
    name: "Newsletter Basica",
    subject: "As novidades de {{mes}}",
    category: "newsletter",
    html: `<div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="color:#3b82f6;margin-bottom:16px;">{{titulo}}</h1>
  <p style="color:#64748b;line-height:1.6;">{{conteudo}}</p>
  <a href="{{link}}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;">Ver Mais</a>
  <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;" />
  <p style="color:#94a3b8;font-size:12px;">{{empresa}} | <a href="{{unsubscribe}}">Cancelar subscricao</a></p>
</div>`,
  },
  {
    name: "Promocao",
    subject: "{{desconto}}% de desconto - so hoje!",
    category: "promo",
    html: `<div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;padding:24px;background:#0f172a;color:white;border-radius:12px;">
  <h1 style="color:#60a5fa;font-size:32px;text-align:center;">{{desconto}}% OFF</h1>
  <p style="text-align:center;color:#94a3b8;margin:16px 0;">{{descricao}}</p>
  <div style="text-align:center;">
    <a href="{{link}}" style="display:inline-block;background:#3b82f6;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Aproveitar Agora</a>
  </div>
  <p style="text-align:center;color:#64748b;font-size:12px;margin-top:24px;">Oferta valida ate {{data_fim}}</p>
</div>`,
  },
  {
    name: "Welcome",
    subject: "Bem-vindo a {{empresa}}!",
    category: "onboarding",
    html: `<div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="margin-bottom:8px;">Bem-vindo, {{nome}}!</h1>
  <p style="color:#64748b;line-height:1.6;">Obrigado por se juntar a {{empresa}}. Estamos entusiasmados por te-lo connosco.</p>
  <h3 style="margin-top:24px;">Proximos passos:</h3>
  <ul style="color:#64748b;line-height:2;">
    <li>Complete o seu perfil</li>
    <li>Explore as funcionalidades</li>
    <li>Convide a sua equipa</li>
  </ul>
  <a href="{{link}}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;">Comecar Agora</a>
</div>`,
  },
];

export default function EmailTemplatesPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", subject: "", category: "", html_content: "" });
  const [previewHtml, setPreviewHtml] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("mkt_email_templates")
      .select("*")
      .eq("org_id", organization.id)
      .order("created_at", { ascending: false });
    setTemplates((data || []) as EmailTemplate[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    if (organization) load();
  }, [organization, load]);

  function openNew(preset?: typeof defaultTemplates[0]) {
    setForm({
      name: preset?.name || "",
      subject: preset?.subject || "",
      category: preset?.category || "",
      html_content: preset?.html || "",
    });
    setEditingId(null);
    setShowEditor(true);
  }

  function openEdit(t: EmailTemplate) {
    setForm({
      name: t.name,
      subject: t.subject || "",
      category: t.category || "",
      html_content: t.html_content || "",
    });
    setEditingId(t.id);
    setShowEditor(true);
  }

  async function handleSave() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();

    const payload = {
      org_id: organization.id,
      name: form.name,
      subject: form.subject || null,
      category: form.category || null,
      html_content: form.html_content || null,
    };

    if (editingId) {
      await supabase.from("mkt_email_templates").update(payload).eq("id", editingId);
    } else {
      await supabase.from("mkt_email_templates").insert(payload);
    }

    setSaving(false);
    setShowEditor(false);
    toast(editingId ? "Template atualizado!" : "Template criado!");
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este template?")) return;
    const supabase = createClient();
    await supabase.from("mkt_email_templates").delete().eq("id", id);
    toast("Template eliminado");
    load();
  }

  function openPreview(html: string) {
    setPreviewHtml(html || "<p>Template vazio</p>");
    setShowPreview(true);
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
            <h1 className="text-2xl font-bold">Email Templates</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {templates.length} template{templates.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => window.location.href = "/email"}>
              Voltar a Email
            </Button>
            <Button onClick={() => openNew()}>
              <Plus size={16} /> Novo Template
            </Button>
          </div>
        </div>

        {/* Pre-built templates */}
        {templates.length === 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Comecar com um template:</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {defaultTemplates.map((dt) => (
                <button
                  key={dt.name}
                  onClick={() => openNew(dt)}
                  className="text-left rounded-xl border p-5 hover:shadow-md transition-shadow"
                  style={{ background: "var(--card)", borderColor: "var(--border)" }}
                >
                  <h4 className="font-semibold">{dt.name}</h4>
                  <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                    Assunto: {dt.subject}
                  </p>
                  <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--secondary)" }}>
                    {dt.category}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Saved templates */}
        {templates.length > 0 && (
          <div className="space-y-3">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border p-5 flex items-center justify-between"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <div>
                  <h3 className="font-semibold">{t.name}</h3>
                  {t.subject && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      Assunto: {t.subject}
                    </p>
                  )}
                  {t.category && (
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--secondary)" }}>
                      {t.category}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openPreview(t.html_content || "")} className="p-1.5 rounded hover:bg-gray-100/10" title="Preview">
                    <Eye size={14} />
                  </button>
                  <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-gray-100/10" title="Editar">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded hover:bg-gray-100/10 text-red-500" title="Eliminar">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <Modal open={showEditor} onClose={() => setShowEditor(false)} title={editingId ? "Editar Template" : "Novo Template"} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} placeholder="Ex: Newsletter Mensal" />
            <Input label="Categoria" value={form.category} onChange={(e) => setForm({ ...form, category: (e.target as HTMLInputElement).value })} placeholder="newsletter, promo, onboarding" />
          </div>
          <Input label="Assunto" value={form.subject} onChange={(e) => setForm({ ...form, subject: (e.target as HTMLInputElement).value })} placeholder="Assunto do email com {{variaveis}}" />
          <div>
            <label className="block text-sm font-medium mb-1">HTML do Email</label>
            <textarea
              value={form.html_content}
              onChange={(e) => setForm({ ...form, html_content: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border text-xs font-mono outline-none resize-none"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
              rows={12}
              placeholder="<div>O seu HTML aqui...</div>"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => openPreview(form.html_content)}>
              <Eye size={14} /> Preview
            </Button>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Use {`{{variavel}}`} para campos dinamicos: nome, empresa, link, etc.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowEditor(false)}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={!form.name}>
            {editingId ? "Guardar" : "Criar Template"}
          </Button>
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Preview do Email" wide>
        <div
          className="rounded-lg border p-4 min-h-[300px]"
          style={{ borderColor: "var(--border)", background: "#ffffff", color: "#171717" }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        <div className="flex justify-end mt-4">
          <Button variant="secondary" onClick={() => setShowPreview(false)}>Fechar</Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
