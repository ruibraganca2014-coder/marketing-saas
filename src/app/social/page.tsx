"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Clock, Eye, Heart, MessageCircle, Trash2, Pencil, Globe, Hash, AtSign, Copy } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { CalendarView } from "@/components/social/calendar-view";
import { AICopilot } from "@/components/ui/ai-copilot";
import { PostPreview } from "@/components/social/post-preview";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import type { SocialPost, Campaign } from "@/types/database";

const platformConfig: Record<string, { icon: typeof Globe; color: string; label: string }> = {
  instagram: { icon: Hash, color: "#E4405F", label: "Instagram" },
  linkedin: { icon: Globe, color: "#0A66C2", label: "LinkedIn" },
  twitter: { icon: AtSign, color: "#1DA1F2", label: "X (Twitter)" },
  facebook: { icon: Globe, color: "#1877F2", label: "Facebook" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-gray-100 text-gray-700" },
  scheduled: { label: "Agendado", color: "bg-blue-100 text-blue-700" },
  published: { label: "Publicado", color: "bg-green-100 text-green-700" },
  error: { label: "Erro", color: "bg-red-100 text-red-700" },
};

const statusOptions = [
  { value: "draft", label: "Rascunho" },
  { value: "scheduled", label: "Agendado" },
];

const emptyForm = {
  content: "",
  platforms: [] as string[],
  status: "draft",
  scheduled_at: "",
  campaign_id: "",
};

export default function SocialPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"grid" | "calendar">("grid");

  const load = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const [postsRes, campaignsRes] = await Promise.all([
      supabase.from("mkt_social_posts").select("*").eq("org_id", organization.id).order("created_at", { ascending: false }),
      supabase.from("mkt_campaigns").select("id, name").eq("org_id", organization.id).order("name"),
    ]);
    setPosts((postsRes.data || []) as SocialPost[]);
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

  function openEdit(p: SocialPost) {
    setForm({
      content: p.content,
      platforms: p.platforms || [],
      status: p.status,
      scheduled_at: p.scheduled_at ? p.scheduled_at.slice(0, 16) : "",
      campaign_id: p.campaign_id || "",
    });
    setEditingId(p.id);
    setShowModal(true);
  }

  function togglePlatform(platform: string) {
    setForm((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform],
    }));
  }

  async function handleSave() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      org_id: organization.id,
      content: form.content,
      platforms: form.platforms,
      status: form.status,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      campaign_id: form.campaign_id || null,
      created_by: user?.id || null,
    };

    if (editingId) {
      await supabase.from("mkt_social_posts").update(payload).eq("id", editingId);
    } else {
      await supabase.from("mkt_social_posts").insert(payload);
    }

    setSaving(false);
    setShowModal(false);
    load();
  }

  async function handleClone(p: SocialPost) {
    if (!organization) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("mkt_social_posts").insert({
      org_id: organization.id,
      content: p.content,
      platforms: p.platforms,
      status: "draft",
      scheduled_at: null,
      campaign_id: p.campaign_id,
      created_by: user?.id || null,
    });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este post?")) return;
    const supabase = createClient();
    await supabase.from("mkt_social_posts").delete().eq("id", id);
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
            <h1 className="text-2xl font-bold">Social Media</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {posts.length} post{posts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setView(view === "grid" ? "calendar" : "grid")}>
              <Calendar size={16} />
              {view === "grid" ? "Calendario" : "Grid"}
            </Button>
            <Button onClick={openCreate}>
              <Plus size={16} />
              Novo Post
            </Button>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-12 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Sem posts. Crie o primeiro.
            </p>
          </div>
        ) : view === "calendar" ? (
          <CalendarView posts={posts} onPostClick={(p) => openEdit(p)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post) => {
              const config = statusConfig[post.status] || statusConfig.draft;
              return (
                <div
                  key={post.id}
                  className="rounded-xl border p-5 hover:shadow-md transition-shadow"
                  style={{ background: "var(--card)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-1.5">
                      {post.platforms.map((p) => {
                        const pc = platformConfig[p];
                        if (!pc) return null;
                        const Icon = pc.icon;
                        return (
                          <div key={p} className="p-1.5 rounded-lg" style={{ background: `${pc.color}15` }}>
                            <Icon size={14} style={{ color: pc.color }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                        {config.label}
                      </span>
                      <button onClick={() => openEdit(post)} className="p-1 rounded hover:bg-gray-100" title="Editar">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => handleClone(post)} className="p-1 rounded hover:bg-gray-100" title="Duplicar">
                        <Copy size={12} />
                      </button>
                      <button onClick={() => handleDelete(post.id)} className="p-1 rounded hover:bg-gray-100 text-red-500" title="Eliminar">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm line-clamp-3 mb-3">{post.content}</p>

                  {post.scheduled_at && (
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      <Clock size={12} />
                      <span>{new Date(post.scheduled_at).toLocaleString("pt-PT")}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? "Editar Post" : "Novo Post"} wide>
        <div className="space-y-4">
          <div>
            <Textarea
              label="Conteudo"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: (e.target as HTMLTextAreaElement).value })}
              placeholder="Escreva o conteudo do post..."
              rows={4}
            />
            <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
              <span>{form.content.length} caracteres</span>
              {form.platforms.includes("twitter") && (
                <span className={form.content.length > 280 ? "text-red-500 font-medium" : ""}>
                  X: {form.content.length}/280
                </span>
              )}
              {form.platforms.includes("linkedin") && (
                <span className={form.content.length > 3000 ? "text-red-500 font-medium" : ""}>
                  LinkedIn: {form.content.length}/3000
                </span>
              )}
              {form.platforms.includes("instagram") && (
                <span className={form.content.length > 2200 ? "text-red-500 font-medium" : ""}>
                  Instagram: {form.content.length}/2200
                </span>
              )}
            </div>
          </div>
          <AICopilot
            type="social_post"
            onInsert={(content) => setForm({ ...form, content })}
          />

          <div>
            <label className="block text-sm font-medium mb-2">Plataformas</label>
            <div className="flex gap-2">
              {Object.entries(platformConfig).map(([key, pc]) => {
                const Icon = pc.icon;
                const selected = form.platforms.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePlatform(key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                      selected ? "border-blue-500 bg-blue-50" : ""
                    }`}
                    style={!selected ? { borderColor: "var(--border)" } : undefined}
                  >
                    <Icon size={16} style={{ color: pc.color }} />
                    {pc.label}
                  </button>
                );
              })}
            </div>
          </div>

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
        {/* Live Preview */}
        {form.content && form.platforms.length > 0 && (
          <PostPreview content={form.content} platforms={form.platforms} orgName={organization?.name} />
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={!form.content || form.platforms.length === 0}>
            {editingId ? "Guardar" : "Criar Post"}
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
