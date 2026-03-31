"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

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
            Entre na sua conta
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">
              {error}
            </div>
          )}

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
              placeholder="A sua password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: "var(--primary)" }}
          >
            {loading ? "A entrar..." : "Entrar"}
          </button>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: "var(--muted-foreground)" }}>
          Nao tem conta?{" "}
          <Link href="/auth/register" className="font-medium" style={{ color: "var(--primary)" }}>
            Registar
          </Link>
        </p>
      </div>
    </div>
  );
}
