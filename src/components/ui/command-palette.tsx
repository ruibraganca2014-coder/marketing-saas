"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Users, Megaphone, Share2, Mail,
  Settings, Plus, Kanban,
} from "lucide-react";

type Command = {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  action: () => void;
  keywords: string[];
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();

  const commands: Command[] = useMemo(() => [
    { id: "dashboard", label: "Dashboard", description: "Ver visao geral", icon: LayoutDashboard, action: () => router.push("/dashboard"), keywords: ["home", "inicio", "kpi"] },
    { id: "contacts", label: "Contatos / CRM", description: "Gerir contatos e leads", icon: Users, action: () => router.push("/contacts"), keywords: ["leads", "crm", "clientes"] },
    { id: "deals", label: "Pipeline Vendas", description: "Kanban de deals", icon: Kanban, action: () => router.push("/contacts/deals"), keywords: ["vendas", "pipeline", "kanban", "funil"] },
    { id: "campaigns", label: "Campanhas", description: "Gerir campanhas", icon: Megaphone, action: () => router.push("/campaigns"), keywords: ["marketing", "campanha"] },
    { id: "social", label: "Social Media", description: "Posts e calendario", icon: Share2, action: () => router.push("/social"), keywords: ["instagram", "facebook", "linkedin", "twitter", "posts"] },
    { id: "email", label: "Email Marketing", description: "Campanhas de email", icon: Mail, action: () => router.push("/email"), keywords: ["newsletter", "email"] },
    { id: "settings", label: "Configuracoes", description: "Org, equipa, integracoes", icon: Settings, action: () => router.push("/settings"), keywords: ["config", "equipa", "team"] },
    { id: "new-contact", label: "Novo Contato", description: "Criar contato", icon: Plus, action: () => router.push("/contacts"), keywords: ["adicionar", "criar", "novo", "lead"] },
    { id: "new-campaign", label: "Nova Campanha", description: "Criar campanha", icon: Plus, action: () => router.push("/campaigns"), keywords: ["adicionar", "criar", "nova"] },
    { id: "new-post", label: "Novo Post", description: "Criar post social", icon: Plus, action: () => router.push("/social"), keywords: ["adicionar", "criar", "agendar", "post"] },
  ], [router]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.keywords.some((k) => k.includes(q))
    );
  }, [query, commands]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  function handleSelect(cmd: Command) {
    cmd.action();
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
      <div
        className="relative w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <Search size={18} style={{ color: "var(--muted-foreground)" }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pesquisar paginas e acoes..."
            className="flex-1 text-sm bg-transparent outline-none"
            autoFocus
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            ESC
          </kbd>
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--muted-foreground)" }}>
              Sem resultados para &quot;{query}&quot;
            </p>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => handleSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIndex ? "bg-blue-500/10" : ""
                }`}
              >
                <cmd.icon size={18} style={{ color: i === selectedIndex ? "var(--primary)" : "var(--muted-foreground)" }} />
                <div>
                  <p className="text-sm font-medium">{cmd.label}</p>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{cmd.description}</p>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t text-[10px] flex gap-3" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
          <span>↑↓ navegar</span>
          <span>↵ selecionar</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  );
}
