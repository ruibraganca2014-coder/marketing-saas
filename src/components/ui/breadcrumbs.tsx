"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  contacts: "Contatos",
  deals: "Pipeline",
  campaigns: "Campanhas",
  social: "Social Media",
  email: "Email Marketing",
  templates: "Templates",
  settings: "Configuracoes",
  analytics: "Analytics",
  automations: "Automacoes",
  logs: "Logs",
  profile: "Perfil",
  onboarding: "Onboarding",
  docs: "API Docs",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 1) return null;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label = routeLabels[seg] || (seg.length > 8 ? seg.substring(0, 8) + "..." : seg);
    const isLast = i === segments.length - 1;

    return { href, label, isLast };
  });

  return (
    <nav className="flex items-center gap-1 text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>
      <Link href="/dashboard" className="hover:text-blue-500 transition-colors">
        <Home size={12} />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight size={12} />
          {crumb.isLast ? (
            <span className="font-medium" style={{ color: "var(--foreground)" }}>{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-blue-500 transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
