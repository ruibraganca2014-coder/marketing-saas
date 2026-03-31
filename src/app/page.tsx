import Link from "next/link";
import {
  Users, Megaphone, Share2, Mail, BarChart3,
  Sparkles, Shield, Zap, ArrowRight, Check,
} from "lucide-react";

const features = [
  {
    icon: Users,
    title: "CRM & Leads",
    description: "Gerencie contatos, funil de vendas com Kanban, lead scoring e pipeline completo.",
  },
  {
    icon: Megaphone,
    title: "Campanhas",
    description: "Planeie e acompanhe campanhas com orcamento, datas, objetivos e metricas.",
  },
  {
    icon: Share2,
    title: "Social Media",
    description: "Agende posts para Instagram, Facebook, LinkedIn e X. Calendario editorial integrado.",
  },
  {
    icon: Mail,
    title: "Email Marketing",
    description: "Crie campanhas de email, acompanhe open rates, cliques e conversoes.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    description: "Dashboard com KPIs em tempo real, graficos de performance e ROI de campanhas.",
  },
  {
    icon: Sparkles,
    title: "AI Copilot",
    description: "Gere conteudo para posts e emails com inteligencia artificial integrada.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "0",
    description: "Para freelancers e pequenas equipas",
    features: ["Ate 500 contatos", "2 campanhas ativas", "1 utilizador", "Calendario editorial"],
    cta: "Comecar Gratis",
    popular: false,
  },
  {
    name: "Pro",
    price: "49",
    description: "Para equipas de marketing em crescimento",
    features: ["Contatos ilimitados", "Campanhas ilimitadas", "5 utilizadores", "AI Copilot", "Export CSV", "Integracoes sociais"],
    cta: "Comecar Pro",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "149",
    description: "Para grandes organizacoes",
    features: ["Tudo do Pro", "Utilizadores ilimitados", "API access", "SSO/SAML", "SLA dedicado", "Suporte prioritario"],
    cta: "Contactar Vendas",
    popular: false,
  },
];

export default function LandingPage() {
  return (
    <div style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-md" style={{ background: "rgba(10,10,10,0.8)", borderColor: "var(--border)" }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold" style={{ color: "var(--primary)" }}>MarketingSaaS</span>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm hover:underline" style={{ color: "var(--muted-foreground)" }}>Features</a>
            <a href="#pricing" className="text-sm hover:underline" style={{ color: "var(--muted-foreground)" }}>Precos</a>
            <Link href="/auth/login" className="text-sm font-medium" style={{ color: "var(--primary)" }}>Entrar</Link>
            <Link href="/auth/register" className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: "var(--primary)" }}>
              Comecar Gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="animate-fade-up inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-6" style={{ background: "var(--secondary)", color: "var(--primary)" }}>
            <Sparkles size={14} className="animate-float" />
            Com AI Copilot integrado
          </div>
          <h1 className="animate-fade-up animate-fade-up-delay-1 text-5xl md:text-6xl font-bold leading-tight mb-6">
            Toda a sua gestao de
            <br />
            <span style={{ color: "var(--primary)" }}>marketing num so lugar</span>
          </h1>
          <p className="animate-fade-up animate-fade-up-delay-2 text-lg max-w-2xl mx-auto mb-8" style={{ color: "var(--muted-foreground)" }}>
            CRM, campanhas, social media e email marketing. Tudo integrado com analytics em tempo real e AI para gerar conteudo.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/auth/register" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium text-white" style={{ background: "var(--primary)" }}>
              Comecar Gratis <ArrowRight size={16} />
            </Link>
            <Link href="/auth/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium border" style={{ borderColor: "var(--border)" }}>
              Ver Demo
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 mt-8 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-1"><Check size={14} className="text-green-500" /> Sem cartao de credito</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-green-500" /> Setup em 2 minutos</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-green-500" /> Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6" style={{ background: "var(--secondary)" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">Tudo o que precisa para crescer</h2>
            <p style={{ color: "var(--muted-foreground)" }}>Ferramentas poderosas para gerir todo o ciclo de marketing</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-xl border p-6 hover:shadow-lg transition-shadow" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="p-3 rounded-lg inline-block mb-4" style={{ background: "var(--secondary)" }}>
                  <feature.icon size={24} style={{ color: "var(--primary)" }} />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "10k+", label: "Utilizadores" },
            { value: "500k+", label: "Leads geridos" },
            { value: "2M+", label: "Posts agendados" },
            { value: "99.9%", label: "Uptime" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold" style={{ color: "var(--primary)" }}>{stat.value}</p>
              <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-6" style={{ background: "var(--secondary)" }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">O que dizem os nossos clientes</h2>
            <p style={{ color: "var(--muted-foreground)" }}>Empresas que transformaram o seu marketing connosco</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: "Ana Rodrigues", role: "CMO, TechStartup", text: "O MarketingSaaS centralizou tudo. Antes usavamos 5 ferramentas diferentes. Agora e tudo num so lugar com analytics em tempo real." },
              { name: "Pedro Santos", role: "CEO, AgenciaDigital", text: "O pipeline Kanban e o AI Copilot mudaram completamente a forma como gerimos campanhas. ROI aumentou 40% no primeiro trimestre." },
              { name: "Sofia Ferreira", role: "Head of Marketing, E-Corp", text: "A API REST permitiu-nos integrar com o nosso CRM interno. O calendário editorial e fantastico para planear conteudo." },
            ].map((t) => (
              <div key={t.name} className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                  &ldquo;{t.text}&rdquo;
                </p>
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">Precos simples e transparentes</h2>
            <p style={{ color: "var(--muted-foreground)" }}>Comece gratis. Escale conforme cresce.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-6 relative ${plan.popular ? "ring-2" : ""}`}
                style={{
                  background: "var(--card)",
                  borderColor: plan.popular ? "var(--primary)" : "var(--border)",
                  ...(plan.popular ? { ringColor: "var(--primary)" } : {}),
                }}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium text-white" style={{ background: "var(--primary)" }}>
                    Mais Popular
                  </div>
                )}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="text-sm mt-1 mb-4" style={{ color: "var(--muted-foreground)" }}>{plan.description}</p>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{plan.price}EUR</span>
                  <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>/mes</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check size={16} className="text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/register"
                  className={`block w-full text-center py-2.5 rounded-lg text-sm font-medium ${
                    plan.popular ? "text-white" : "border"
                  }`}
                  style={plan.popular ? { background: "var(--primary)" } : { borderColor: "var(--border)" }}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Pronto para transformar o seu marketing?</h2>
          <p className="mb-8" style={{ color: "var(--muted-foreground)" }}>
            Junte-se a milhares de empresas que ja usam o MarketingSaaS.
          </p>
          <Link href="/auth/register" className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-sm font-medium text-white" style={{ background: "var(--primary)" }}>
            Comecar Gratis Agora <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-6" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-sm font-bold" style={{ color: "var(--primary)" }}>MarketingSaaS</span>
          <div className="flex items-center gap-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-1"><Shield size={12} /> RGPD Compliant</span>
            <span className="flex items-center gap-1"><Zap size={12} /> 99.9% Uptime</span>
          </div>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            2026 MarketingSaaS. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
