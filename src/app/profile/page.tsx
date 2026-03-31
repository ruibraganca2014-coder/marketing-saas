"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUser } from "@/hooks/use-user";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase";
import { useState, useEffect } from "react";
import { User, Mail, Shield, Calendar, Key } from "lucide-react";

export default function ProfilePage() {
  const { user, loading: userLoading } = useUser();
  const { organization, membership } = useOrganization();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setFullName(user.user_metadata.full_name);
    }
  }, [user]);

  async function handleSaveProfile() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName },
    });
    if (error) {
      toast("Erro: " + error.message, "error");
    } else {
      toast("Perfil atualizado!");
    }
    setSaving(false);
  }

  async function handleChangePassword() {
    if (newPassword.length < 6) {
      toast("Password deve ter no minimo 6 caracteres", "warning");
      return;
    }
    setChangingPassword(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast("Erro: " + error.message, "error");
    } else {
      toast("Password alterada com sucesso!");
      setNewPassword("");
    }
    setChangingPassword(false);
  }

  if (userLoading) {
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
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold">Perfil</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Gerir o seu perfil e seguranca
          </p>
        </div>

        {/* Avatar + Info */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {(fullName || user?.email || "U").charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fullName || "Sem nome"}</h2>
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>{user?.email}</p>
            </div>
          </div>

          <div className="space-y-4">
            <Input
              label="Nome completo"
              value={fullName}
              onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
              placeholder="O seu nome"
            />

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg" style={{ background: "var(--secondary)" }}>
                <Mail size={16} style={{ color: "var(--muted-foreground)" }} />
                <div>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Email</p>
                  <p className="font-medium">{user?.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg" style={{ background: "var(--secondary)" }}>
                <Shield size={16} style={{ color: "var(--muted-foreground)" }} />
                <div>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Role</p>
                  <p className="font-medium capitalize">{membership?.role || "N/A"}</p>
                </div>
              </div>
            </div>

            {organization && (
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg" style={{ background: "var(--secondary)" }}>
                <Calendar size={16} style={{ color: "var(--muted-foreground)" }} />
                <div>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Organizacao</p>
                  <p className="font-medium">{organization.name} ({organization.plan})</p>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleSaveProfile} loading={saving}>Guardar Perfil</Button>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Key size={18} />
            <h3 className="text-lg font-semibold">Alterar Password</h3>
          </div>
          <div className="space-y-4">
            <Input
              label="Nova password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword((e.target as HTMLInputElement).value)}
              placeholder="Minimo 6 caracteres"
            />
            <div className="flex justify-end">
              <Button onClick={handleChangePassword} loading={changingPassword} disabled={!newPassword}>
                Alterar Password
              </Button>
            </div>
          </div>
        </div>

        {/* Session Info */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold mb-3">Informacao da Sessao</h3>
          <div className="space-y-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <p>User ID: <code className="px-1 py-0.5 rounded" style={{ background: "var(--secondary)" }}>{user?.id}</code></p>
            <p>Criado em: {user?.created_at ? new Date(user.created_at).toLocaleDateString("pt-PT") : "N/A"}</p>
            <p>Ultimo login: {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("pt-PT") : "N/A"}</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
