"use client";

import { Sparkles, Copy, Check, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";

type AICopilotProps = {
  type: "social_post" | "email_subject" | "campaign_description";
  context?: string;
  onInsert?: (content: string) => void;
};

const typeLabels: Record<string, string> = {
  social_post: "post para redes sociais",
  email_subject: "assunto de email",
  campaign_description: "descricao de campanha",
};

const placeholders: Record<string, string> = {
  social_post: "Ex: post sobre lancamento de produto de marketing digital",
  email_subject: "Ex: newsletter sobre tendencias de marketing 2026",
  campaign_description: "Ex: campanha de Black Friday para e-commerce",
};

export function AICopilot({ type, context, onInsert }: AICopilotProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(context || "");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Gera um ${typeLabels[type]} sobre: ${prompt}`,
          type,
        }),
      });

      const data = await res.json();
      setResult(data.content || data.error || "Erro ao gerar");
    } catch {
      setResult("Erro de conexao ao gerar conteudo.");
    }

    setLoading(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleInsert() {
    onInsert?.(result);
    setOpen(false);
    setResult("");
    setPrompt("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:bg-purple-50 hover:border-purple-300"
        style={{ borderColor: "var(--border)", color: "#8B5CF6" }}
      >
        <Sparkles size={14} />
        Gerar com AI
      </button>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "#8B5CF6", background: "rgba(139, 92, 246, 0.05)" }}>
      <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#8B5CF6" }}>
        <Sparkles size={16} />
        AI Copilot - Gerar {typeLabels[type]}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholders[type]}
          className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
          style={{ borderColor: "var(--border)", background: "var(--background)" }}
          onKeyDown={(e) => e.key === "Enter" && generate()}
        />
        <Button onClick={generate} loading={loading} disabled={!prompt.trim()}>
          {result ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {result ? "Regenerar" : "Gerar"}
        </Button>
      </div>

      {result && (
        <div>
          <div className="rounded-lg p-3 text-sm whitespace-pre-wrap" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
            {result}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100/10 transition-colors"
              style={{ color: "var(--muted-foreground)" }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copiado!" : "Copiar"}
            </button>
            {onInsert && (
              <Button size="sm" onClick={handleInsert}>
                Inserir
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setResult(""); }}>
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
