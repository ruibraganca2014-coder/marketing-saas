"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();

    // 1. Criar usuario
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (!authData.user) {
      setError("Erro ao criar conta");
      setLoading(false);
      return;
    }

    // 2. Criar organizacao
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const { data: org, error: orgError } = await supabase
      .from("mkt_organizations")
      .insert({ name: orgName, slug })
      .select()
      .single();

    if (orgError) {
      setError(orgError.message);
      setLoading(false);
      return;
    }

    // 3. Adicionar usuario como admin da org
    const { error: memberError } = await supabase
      .from("mkt_org_members")
      .insert({ org_id: org.id, user_id: authData.user.id, role: "admin" });

    if (memberError) {
      setError(memberError.message);
      setLoading(false);
      return;
    }

    // 4. Criar pipeline stages padrão
    await supabase.from("mkt_pipeline_stages").insert([
      { org_id: org.id, name: "Novo Lead", color: "#3B82F6", position: 0 },
      { org_id: org.id, name: "Contactado", color: "#F59E0B", position: 1 },
      { org_id: org.id, name: "Qualificado", color: "#8B5CF6", position: 2 },
      { org_id: org.id, name: "Proposta", color: "#EC4899", position: 3 },
      { org_id: org.id, name: "Negociacao", color: "#F97316", position: 4 },
      { org_id: org.id, name: "Fechado", color: "#22C55E", position: 5 },
    ]);

    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-md p-8 rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>
            MarketingSaaS
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>
            Crie a sua conta e organizacao
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Nome completo</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
              placeholder="O seu nome"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Nome da organizacao</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
              placeholder="A sua empresa"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
              placeholder="email@exemplo.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
              placeholder="Minimo 6 caracteres"
              minLength={6}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: "var(--primary)" }}
          >
            {loading ? "A criar conta..." : "Criar conta"}
          </button>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: "var(--muted-foreground)" }}>
          Ja tem conta?{" "}
          <Link href="/auth/login" className="font-medium" style={{ color: "var(--primary)" }}>
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
