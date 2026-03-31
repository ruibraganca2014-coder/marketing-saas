"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Share2,
  Mail,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Kanban,
} from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/hooks/use-organization";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contatos / CRM", icon: Users },
  { href: "/contacts/deals", label: "Pipeline Vendas", icon: Kanban },
  { href: "/campaigns", label: "Campanhas", icon: Megaphone },
  { href: "/social", label: "Social Media", icon: Share2 },
  { href: "/email", label: "Email Marketing", icon: Mail },
  { href: "/settings", label: "Configuracoes", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const { organization } = useOrganization();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <aside
      className={`fixed left-0 top-0 h-screen flex flex-col transition-all duration-300 z-50 ${
        collapsed ? "w-16" : "w-64"
      }`}
      style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-fg)" }}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {!collapsed && (
          <h1 className="text-lg font-bold tracking-tight">MarketingSaaS</h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
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
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-slate-500">Organizacao</p>
            <p className="text-sm font-medium text-slate-300 truncate">{organization.name}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-white/10 hover:text-white transition-all w-full"
        >
          <LogOut size={20} className="shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
