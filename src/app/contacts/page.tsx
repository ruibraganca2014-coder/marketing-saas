"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Search, Trash2, Pencil, MoreHorizontal, Upload, Filter, X } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { createClient } from "@/lib/supabase";
import { ImportCSVModal } from "@/components/contacts/import-csv-modal";
import { TableSkeleton } from "@/components/ui/skeleton";
import type { Contact } from "@/types/database";

const statusOptions = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Qualificado" },
  { value: "proposal", label: "Proposta" },
  { value: "customer", label: "Cliente" },
  { value: "lost", label: "Perdido" },
];

const sourceOptions = [
  { value: "", label: "Selecione..." },
  { value: "website", label: "Website" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "referral", label: "Indicacao" },
  { value: "email", label: "Email" },
  { value: "ads", label: "Anuncios" },
  { value: "other", label: "Outro" },
];

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

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  company: "",
  job_title: "",
  source: "",
  status: "new",
  notes: "",
};

export default function ContactsPage() {
  const { organization, loading: orgLoading } = useOrganization();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const loadContacts = useCallback(async () => {
    if (!organization) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("mkt_contacts")
      .select("*")
      .eq("org_id", organization.id)
      .order("created_at", { ascending: false });
    setContacts((data || []) as Contact[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    if (organization) loadContacts();
  }, [organization, loadContacts]);

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(contact: Contact) {
    setForm({
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
      email: contact.email || "",
      phone: contact.phone || "",
      company: contact.company || "",
      job_title: contact.job_title || "",
      source: contact.source || "",
      status: contact.status || "new",
      notes: contact.notes || "",
    });
    setEditingId(contact.id);
    setShowModal(true);
    setMenuOpen(null);
  }

  async function handleSave() {
    if (!organization) return;
    setSaving(true);
    const supabase = createClient();

    const payload = { ...form, org_id: organization.id };

    if (editingId) {
      await supabase
        .from("mkt_contacts")
        .update(payload)
        .eq("id", editingId);
    } else {
      await supabase
        .from("mkt_contacts")
        .insert(payload);
    }

    setSaving(false);
    setShowModal(false);
    loadContacts();
  }

  async function handleDelete(id: string) {
    if (!confirm("Tem certeza que quer eliminar este contato?")) return;
    const supabase = createClient();
    await supabase.from("mkt_contacts").delete().eq("id", id);
    setMenuOpen(null);
    loadContacts();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  }

  async function handleBulkDelete() {
    if (!confirm(`Eliminar ${selected.size} contatos?`)) return;
    const supabase = createClient();
    await supabase.from("mkt_contacts").delete().in("id", Array.from(selected));
    setSelected(new Set());
    loadContacts();
  }

  function exportCSV() {
    if (contacts.length === 0) return;
    const headers = ["Nome", "Apelido", "Email", "Telefone", "Empresa", "Cargo", "Status", "Score", "Origem"];
    const rows = contacts.map((c) => [
      c.first_name || "", c.last_name || "", c.email || "", c.phone || "",
      c.company || "", c.job_title || "", c.status || "", String(c.score || 0), c.source || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contatos-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtered = contacts.filter((c) => {
    const matchesSearch = `${c.first_name} ${c.last_name} ${c.email} ${c.company}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesStatus = !filterStatus || c.status === filterStatus;
    const matchesSource = !filterSource || c.source === filterSource;
    return matchesSearch && matchesStatus && matchesSource;
  });

  const activeFilters = [filterStatus, filterSource].filter(Boolean).length;

  if (orgLoading || loading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="h-8 w-48 rounded-lg animate-pulse" style={{ background: "var(--secondary)" }} />
          <div className="h-10 w-full rounded-lg animate-pulse" style={{ background: "var(--secondary)" }} />
          <TableSkeleton rows={5} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Contatos / CRM</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {contacts.length} contato{contacts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={14} />
              Importar
            </Button>
            <Button variant="secondary" onClick={exportCSV}>
              Exportar CSV
            </Button>
            <Button onClick={openCreate}>
              <Plus size={16} />
              Novo Contato
            </Button>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar contatos..."
              className="w-full pl-9 pr-4 py-2 rounded-lg border text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: activeFilters > 0 ? "var(--primary)" : "var(--border)", background: "var(--card)" }}
          >
            <Filter size={14} />
            Filtros
            {activeFilters > 0 && (
              <span className="w-5 h-5 rounded-full text-xs flex items-center justify-center text-white" style={{ background: "var(--primary)" }}>
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
            >
              <option value="">Todos os status</option>
              {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
            >
              <option value="">Todas as origens</option>
              {sourceOptions.filter((s) => s.value).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {activeFilters > 0 && (
              <button
                onClick={() => { setFilterStatus(""); setFilterSource(""); }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100/10"
                style={{ color: "var(--muted-foreground)" }}
              >
                <X size={12} /> Limpar
              </button>
            )}
          </div>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {contacts.length === 0 ? "Sem contatos. Adicione o primeiro." : "Nenhum resultado encontrado."}
            </p>
          </div>
        ) : (
          <>
          {/* Bulk Action Bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: "var(--primary)", background: "rgba(59,130,246,0.05)" }}>
              <span className="text-sm font-medium">{selected.size} selecionado{selected.size !== 1 ? "s" : ""}</span>
              <Button size="sm" variant="danger" onClick={handleBulkDelete}>
                <Trash2 size={12} /> Eliminar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
                Cancelar
              </Button>
            </div>
          )}

          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--secondary)" }}>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Nome</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Empresa</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Score</th>
                  <th className="text-left px-4 py-3 font-medium">Origem</th>
                  <th className="text-right px-4 py-3 font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className={`border-t ${selected.has(c.id) ? "bg-blue-500/5" : ""}`} style={{ borderColor: "var(--border)" }}>
                    <td className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <a href={`/contacts/${c.id}`} className="hover:underline" style={{ color: "var(--primary)" }}>
                        {c.first_name} {c.last_name}
                      </a>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--muted-foreground)" }}>{c.email}</td>
                    <td className="px-4 py-3">{c.company}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[c.status] || ""}`}>
                        {statusLabels[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${c.score}%`,
                              background: c.score > 70 ? "#22C55E" : c.score > 40 ? "#F59E0B" : "#EF4444",
                            }}
                          />
                        </div>
                        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{c.score}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--muted-foreground)" }}>{c.source}</td>
                    <td className="px-4 py-3 text-right relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)}
                        className="p-1 rounded hover:bg-gray-100"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuOpen === c.id && (
                        <div className="absolute right-4 top-10 z-50 rounded-lg border shadow-lg py-1 min-w-[120px]" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                          <button onClick={() => openEdit(c)} className="flex items-center gap-2 px-3 py-2 text-sm w-full hover:bg-gray-50">
                            <Pencil size={14} /> Editar
                          </button>
                          <button onClick={() => handleDelete(c.id)} className="flex items-center gap-2 px-3 py-2 text-sm w-full hover:bg-gray-50 text-red-600">
                            <Trash2 size={14} /> Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? "Editar Contato" : "Novo Contato"}
        wide
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nome" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: (e.target as HTMLInputElement).value })} placeholder="Nome" />
          <Input label="Apelido" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: (e.target as HTMLInputElement).value })} placeholder="Apelido" />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: (e.target as HTMLInputElement).value })} placeholder="email@exemplo.com" />
          <Input label="Telefone" value={form.phone} onChange={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} placeholder="+351 900 000 000" />
          <Input label="Empresa" value={form.company} onChange={(e) => setForm({ ...form, company: (e.target as HTMLInputElement).value })} placeholder="Nome da empresa" />
          <Input label="Cargo" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: (e.target as HTMLInputElement).value })} placeholder="Cargo" />
          <Select label="Origem" value={form.source} onChange={(e) => setForm({ ...form, source: (e.target as HTMLSelectElement).value })} options={sourceOptions} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: (e.target as HTMLSelectElement).value })} options={statusOptions} />
        </div>
        <div className="mt-4">
          <Textarea label="Notas" value={form.notes} onChange={(e) => setForm({ ...form, notes: (e.target as HTMLTextAreaElement).value })} placeholder="Notas sobre o contato..." rows={3} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving}>
            {editingId ? "Guardar" : "Criar Contato"}
          </Button>
        </div>
      </Modal>

      {organization && (
        <ImportCSVModal
          open={showImport}
          onClose={() => setShowImport(false)}
          orgId={organization.id}
          onImported={loadContacts}
        />
      )}
    </AppLayout>
  );
}
