import Link from "next/link";
import { ArrowLeft, Key, Globe, Webhook, Code } from "lucide-react";

const endpoints = [
  {
    method: "GET",
    path: "/api/v1/contacts",
    description: "Listar contatos com paginacao e filtros",
    params: [
      { name: "page", type: "number", desc: "Pagina (default: 1)" },
      { name: "limit", type: "number", desc: "Itens por pagina (default: 20, max: 100)" },
      { name: "status", type: "string", desc: "Filtrar por status (new, contacted, qualified, proposal, customer, lost)" },
      { name: "search", type: "string", desc: "Pesquisar por nome, email ou empresa" },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/contacts",
    description: "Criar novo contato",
    body: '{ "first_name": "Joao", "last_name": "Silva", "email": "joao@empresa.pt", "company": "EmpresaX", "status": "new" }',
  },
  {
    method: "GET",
    path: "/api/v1/campaigns",
    description: "Listar campanhas",
    params: [
      { name: "page", type: "number", desc: "Pagina" },
      { name: "limit", type: "number", desc: "Itens por pagina" },
      { name: "status", type: "string", desc: "Filtrar por status (planning, active, paused, completed)" },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/campaigns",
    description: "Criar nova campanha",
    body: '{ "name": "Black Friday", "objective": "sales", "budget_planned": 5000, "start_date": "2026-11-20" }',
  },
  {
    method: "GET",
    path: "/api/v1/social-posts",
    description: "Listar posts sociais",
    params: [
      { name: "status", type: "string", desc: "draft, scheduled, published, error" },
      { name: "platform", type: "string", desc: "instagram, facebook, linkedin, twitter" },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/social-posts",
    description: "Criar post social",
    body: '{ "content": "Novo post!", "platforms": ["instagram", "linkedin"], "status": "scheduled", "scheduled_at": "2026-04-01T09:00:00Z" }',
  },
];

const webhookEvents = [
  { event: "contact.created", desc: "Criar contato via webhook", data: '{ "first_name": "Ana", "email": "ana@test.com" }' },
  { event: "contact.updated", desc: "Atualizar contato", data: '{ "id": "uuid", "status": "qualified" }' },
  { event: "social.published", desc: "Marcar post como publicado", data: '{ "post_id": "uuid" }' },
  { event: "email.metrics", desc: "Atualizar metricas de email", data: '{ "campaign_id": "uuid", "total_sent": 1000, "total_opened": 350 }' },
];

const methodColors: Record<string, string> = {
  GET: "bg-green-100 text-green-700",
  POST: "bg-blue-100 text-blue-700",
};

export default function DocsPage() {
  return (
    <div style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <nav className="border-b sticky top-0 backdrop-blur-md z-10" style={{ background: "rgba(10,10,10,0.9)", borderColor: "var(--border)" }}>
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm" style={{ color: "var(--primary)" }}>
            <ArrowLeft size={16} />
            MarketingSaaS
          </Link>
          <span className="text-sm font-semibold">API Documentation</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        {/* Intro */}
        <div>
          <h1 className="text-3xl font-bold mb-3">API Reference</h1>
          <p style={{ color: "var(--muted-foreground)" }}>
            API REST para integrar o MarketingSaaS com as suas ferramentas. Autenticacao via Bearer token.
          </p>
        </div>

        {/* Auth */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Key size={20} style={{ color: "var(--primary)" }} />
            <h2 className="text-xl font-semibold">Autenticacao</h2>
          </div>
          <p className="text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
            Todas as requests precisam de um Bearer token no header Authorization. Use o access_token do Supabase Auth.
          </p>
          <pre className="p-4 rounded-lg text-xs overflow-x-auto" style={{ background: "var(--secondary)" }}>
{`curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
     https://your-app.vercel.app/api/v1/contacts`}
          </pre>
        </div>

        {/* Endpoints */}
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Globe size={20} style={{ color: "var(--primary)" }} />
            <h2 className="text-xl font-semibold">Endpoints</h2>
          </div>

          <div className="space-y-4">
            {endpoints.map((ep, i) => (
              <div key={i} className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${methodColors[ep.method]}`}>
                    {ep.method}
                  </span>
                  <code className="text-sm font-mono">{ep.path}</code>
                </div>
                <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>{ep.description}</p>

                {ep.params && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold mb-1">Query Parameters:</p>
                    <div className="space-y-1">
                      {ep.params.map((p) => (
                        <div key={p.name} className="flex items-center gap-2 text-xs">
                          <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--secondary)" }}>{p.name}</code>
                          <span style={{ color: "var(--muted-foreground)" }}>{p.type}</span>
                          <span>— {p.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ep.body && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Body:</p>
                    <pre className="p-3 rounded-lg text-xs overflow-x-auto" style={{ background: "var(--secondary)" }}>
                      {ep.body}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Webhooks */}
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Webhook size={20} style={{ color: "var(--primary)" }} />
            <h2 className="text-xl font-semibold">Webhooks</h2>
          </div>

          <div className="rounded-xl border p-5 mb-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
              Envie eventos para <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--secondary)" }}>POST /api/webhooks</code> com header <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--secondary)" }}>X-Webhook-Secret</code>.
            </p>
            <pre className="p-4 rounded-lg text-xs overflow-x-auto" style={{ background: "var(--secondary)" }}>
{`curl -X POST https://your-app.vercel.app/api/webhooks \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Secret: YOUR_SECRET" \\
  -d '{"event": "contact.created", "org_id": "uuid", "data": {...}}'`}
            </pre>
          </div>

          <div className="space-y-3">
            {webhookEvents.map((wh) => (
              <div key={wh.event} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-sm font-mono font-semibold" style={{ color: "var(--primary)" }}>{wh.event}</code>
                </div>
                <p className="text-xs mb-2" style={{ color: "var(--muted-foreground)" }}>{wh.desc}</p>
                <pre className="p-2 rounded text-xs" style={{ background: "var(--secondary)" }}>data: {wh.data}</pre>
              </div>
            ))}
          </div>
        </div>

        {/* SDKs */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Code size={20} style={{ color: "var(--primary)" }} />
            <h2 className="text-xl font-semibold">SDKs & Integracoes</h2>
          </div>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Em breve: SDKs para JavaScript, Python e integracoes com Zapier, Make e n8n.
          </p>
        </div>
      </div>
    </div>
  );
}
