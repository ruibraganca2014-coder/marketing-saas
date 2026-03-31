"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";
import { useState, useEffect, useCallback } from "react";
import { Trash2, UserPlus, Shield, Pencil, Eye } from "lucide-react";

type Member = {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  email?: string;
};

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  manager: "Gestor",
  editor: "Editor",
  viewer: "Visualizador",
};

const roleIcons: Record<string, typeof Shield> = {
  admin: Shield,
  manager: Shield,
  editor: Pencil,
  viewer: Eye,
};

export default function SettingsPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [orgName, setOrgName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  const loadMembers = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("mkt_org_members")
      .select("*")
      .eq("org_id", organization.id);
    setMembers((data || []) as Member[]);
  }, [organization]);

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name);
      loadMembers();
    }
  }, [organization, loadMembers]);

  async function handleSaveOrg() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("mkt_organizations")
      .update({ name: orgName, updated_at: new Date().toISOString() })
      .eq("id", organization.id);

    if (error) {
      toast("Erro ao guardar: " + error.message, "error");
    } else {
      toast("Organizacao atualizada com sucesso!");
    }
    setSaving(false);
  }

  async function handleDeleteMember(memberId: string) {
    if (!confirm("Remover este membro?")) return;
    const supabase = createClient();
    await supabase.from("mkt_org_members").delete().eq("id", memberId);
    toast("Membro removido");
    loadMembers();
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
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold">Configuracoes</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Gerir organizacao, equipa e integracoes
          </p>
        </div>

        {/* Organization Settings */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4">Organizacao</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                label="Nome da organizacao"
                value={orgName}
                onChange={(e) => setOrgName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div>
              <Input
                label="Slug"
                value={organization?.slug || ""}
                disabled
              />
            </div>
          </div>
          <div className="flex justify-between items-center mt-4">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Plano: <span className="font-medium capitalize">{organization?.plan || "free"}</span>
            </p>
            <Button onClick={handleSaveOrg} loading={saving}>Guardar</Button>
          </div>
        </div>

        {/* Team Members */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Equipa ({members.length})</h3>
            <Button size="sm" onClick={() => setShowInvite(true)}>
              <UserPlus size={14} />
              Convidar
            </Button>
          </div>

          <div className="space-y-2">
            {members.map((member) => {
              const RoleIcon = roleIcons[member.role] || Eye;
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-3 px-4 rounded-lg border"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--secondary)", color: "var(--primary)" }}>
                      {member.user_id.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{member.user_id.substring(0, 8)}...</p>
                      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                        Adicionado em {new Date(member.created_at).toLocaleDateString("pt-PT")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "var(--secondary)" }}>
                      <RoleIcon size={12} />
                      {roleLabels[member.role] || member.role}
                    </span>
                    {members.length > 1 && (
                      <button onClick={() => handleDeleteMember(member.id)} className="p-1 rounded hover:bg-red-50 text-red-500">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Social Media Integrations */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4">Integracoes - Redes Sociais</h3>
          <div className="space-y-3">
            {[
              { name: "Instagram", color: "#E4405F", connected: false },
              { name: "Facebook", color: "#1877F2", connected: false },
              { name: "LinkedIn", color: "#0A66C2", connected: false },
              { name: "X (Twitter)", color: "#1DA1F2", connected: false },
            ].map((platform) => (
              <div key={platform.name} className="flex items-center justify-between py-3 px-4 rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ background: platform.color }} />
                  <span className="text-sm font-medium">{platform.name}</span>
                </div>
                <Button
                  size="sm"
                  variant={platform.connected ? "ghost" : "secondary"}
                  onClick={() => toast("Integracao com " + platform.name + " em breve!", "warning")}
                >
                  {platform.connected ? "Conectado" : "Conectar"}
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Email Integrations */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4">Integracoes - Email Marketing</h3>
          <div className="space-y-3">
            {["Mailchimp", "Resend", "SendGrid"].map((service) => (
              <div key={service} className="flex items-center justify-between py-3 px-4 rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <span className="text-sm font-medium">{service}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => toast("Integracao com " + service + " em breve!", "warning")}
                >
                  Configurar
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-xl border border-red-500/30 p-6" style={{ background: "var(--card)" }}>
          <h3 className="text-lg font-semibold text-red-500 mb-2">Zona de Perigo</h3>
          <p className="text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
            Acoes irreversiveis. Tenha cuidado.
          </p>
          <Button variant="danger" size="sm" onClick={() => toast("Funcionalidade desativada no MVP", "warning")}>
            Eliminar Organizacao
          </Button>
        </div>
      </div>

      {/* Invite Modal */}
      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Convidar Membro">
        <div className="space-y-4">
          <Input
            label="Email do membro"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail((e.target as HTMLInputElement).value)}
            placeholder="email@exemplo.com"
          />
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            O membro recebera um convite por email para se juntar a organizacao.
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowInvite(false)}>Cancelar</Button>
          <Button
            onClick={() => {
              toast("Convite enviado para " + inviteEmail + " (simulado)", "success");
              setShowInvite(false);
              setInviteEmail("");
            }}
            disabled={!inviteEmail}
          >
            Enviar Convite
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
