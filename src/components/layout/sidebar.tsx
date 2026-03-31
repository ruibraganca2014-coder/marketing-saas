"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Megaphone, Share2, Mail, Settings,
  LogOut, ChevronLeft, ChevronRight, Kanban, Sun, Moon, Menu, X,
  BarChart3, Zap, Bell,
} from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/hooks/use-organization";
import { useTheme } from "@/hooks/use-theme";
import { NotificationsDropdown } from "./notifications-dropdown";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contatos / CRM", icon: Users },
  { href: "/contacts/deals", label: "Pipeline Vendas", icon: Kanban },
  { href: "/campaigns", label: "Campanhas", icon: Megaphone },
  { href: "/social", label: "Social Media", icon: Share2 },
  { href: "/email", label: "Email Marketing", icon: Mail },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/automations", label: "Automacoes", icon: Zap },
  { href: "/settings", label: "Configuracoes", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { organization } = useOrganization();
  const { theme, setTheme } = useTheme();

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close mobile on resize
  useEffect(() => {
    const handler = () => { if (typeof window !== "undefined" && window.innerWidth >= 768) setMobileOpen(false); };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {!collapsed && (
          <h1 className="text-lg font-bold tracking-tight">MarketingSaaS</h1>
        )}
        <button
          onClick={() => { if (mobileOpen) setMobileOpen(false); else setCollapsed(!collapsed); }}
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          {mobileOpen ? <X size={18} /> : collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Ctrl+K hint */}
      {!collapsed && (
        <div className="mx-2 mt-3 mb-1">
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 border border-white/10 hover:bg-white/5 transition-colors"
          >
            <LayoutDashboard size={14} />
            <span className="flex-1 text-left">Pesquisar...</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-white/20">Ctrl+K</kbd>
          </button>
        </div>
      )}

      {/* Notifications */}
      {!collapsed && organization && (
        <div className="mx-2 mb-1">
          <NotificationsDropdown orgId={organization.id} />
        </div>
      )}

      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? "bg-blue-600 text-white font-medium"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={20} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-white/10">
        {!collapsed && organization && (
          <div className="px-3 py-2 mb-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Organizacao</p>
            <p className="text-sm font-medium text-slate-300 truncate">{organization.name}</p>
          </div>
        )}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/10 hover:text-white transition-all w-full"
        >
          {theme === "dark" ? <Sun size={18} className="shrink-0" /> : <Moon size={18} className="shrink-0" />}
          {!collapsed && <span>{theme === "dark" ? "Modo Claro" : "Modo Escuro"}</span>}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/10 hover:text-white transition-all w-full"
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-3 left-3 z-50 p-2 rounded-lg md:hidden"
        style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-fg)" }}
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-[60] md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Desktop sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen flex-col transition-all duration-300 z-[70] hidden md:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
        style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-fg)" }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 flex flex-col z-[70] md:hidden transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-fg)" }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
