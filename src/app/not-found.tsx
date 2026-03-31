import Link from "next/link";
import { Home, ArrowLeft, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--background)" }}>
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold mb-4" style={{ color: "var(--primary)" }}>404</div>
        <h1 className="text-2xl font-bold mb-2">Pagina nao encontrada</h1>
        <p className="text-sm mb-8" style={{ color: "var(--muted-foreground)" }}>
          A pagina que procura nao existe ou foi movida. Verifique o URL ou volte ao inicio.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: "var(--primary)" }}
          >
            <Home size={16} /> Ir ao Dashboard
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border"
            style={{ borderColor: "var(--border)" }}
          >
            <ArrowLeft size={16} /> Pagina Inicial
          </Link>
        </div>
        <p className="text-xs mt-6" style={{ color: "var(--muted-foreground)" }}>
          Dica: Use <kbd className="px-1.5 py-0.5 rounded border text-[10px]" style={{ borderColor: "var(--border)" }}>Ctrl+K</kbd> para navegar rapidamente.
        </p>
      </div>
    </div>
  );
}
