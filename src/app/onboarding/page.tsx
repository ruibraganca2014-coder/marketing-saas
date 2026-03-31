"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";
import {
  Users, Megaphone, Share2, Mail, BarChart3, Sparkles,
  ArrowRight, Check, Building2,
} from "lucide-react";

const steps = [
  {
    id: "welcome",
    title: "Bem-vindo ao MarketingSaaS!",
    subtitle: "Vamos configurar tudo em poucos passos.",
  },
  {
    id: "profile",
    title: "Sobre a sua empresa",
    subtitle: "Ajude-nos a personalizar a experiencia.",
  },
  {
    id: "goals",
    title: "Quais sao os seus objetivos?",
    subtitle: "Selecione o que mais importa para si.",
  },
  {
    id: "done",
    title: "Tudo pronto!",
    subtitle: "O seu workspace esta configurado.",
  },
];

const goals = [
  { id: "crm", label: "Gerir contatos e leads", icon: Users },
  { id: "campaigns", label: "Planear campanhas", icon: Megaphone },
  { id: "social", label: "Agendar posts sociais", icon: Share2 },
  { id: "email", label: "Email marketing", icon: Mail },
  { id: "analytics", label: "Analisar performance", icon: BarChart3 },
  { id: "ai", label: "Gerar conteudo com AI", icon: Sparkles },
];

const industries = [
  "Tecnologia", "E-commerce", "Saude", "Educacao",
  "Financas", "Imobiliario", "Restauracao", "Agencia",
  "Consultoria", "Outro",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleGoal(id: string) {
    setSelectedGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  async function handleComplete() {
    setSaving(true);
    // Save preferences to org custom_fields or just proceed
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Log onboarding activity
      const { data: membership } = await supabase
        .from("mkt_org_members")
        .select("org_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (membership) {
        await supabase.from("mkt_activity_log").insert({
          org_id: membership.org_id,
          user_id: user.id,
          entity_type: "onboarding",
          entity_id: user.id,
          action: "completed_onboarding",
          details: { industry, teamSize, goals: selectedGoals },
        });
      }
    }

    setSaving(false);
    toast("Onboarding concluido! Bem-vindo ao MarketingSaaS.");
    router.push("/dashboard");
  }

  const currentStep = steps[step];

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex gap-1.5 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-all"
              style={{ background: i <= step ? "var(--primary)" : "var(--border)" }}
            />
          ))}
        </div>

        {/* Step Content */}
        <div className="rounded-xl border p-8" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h1 className="text-2xl font-bold mb-1">{currentStep.title}</h1>
          <p className="text-sm mb-6" style={{ color: "var(--muted-foreground)" }}>{currentStep.subtitle}</p>

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Users, label: "CRM" },
                  { icon: Megaphone, label: "Campanhas" },
                  { icon: Share2, label: "Social" },
                  { icon: Mail, label: "Email" },
                  { icon: BarChart3, label: "Analytics" },
                  { icon: Sparkles, label: "AI" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-2 p-4 rounded-lg" style={{ background: "var(--secondary)" }}>
                    <item.icon size={24} style={{ color: "var(--primary)" }} />
                    <span className="text-xs font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
              <Button onClick={() => setStep(1)} className="w-full">
                Comecar <ArrowRight size={16} />
              </Button>
            </div>
          )}

          {/* Step 1: Profile */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Industria</label>
                <div className="grid grid-cols-2 gap-2">
                  {industries.map((ind) => (
                    <button
                      key={ind}
                      onClick={() => setIndustry(ind)}
                      className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                        industry === ind ? "border-blue-500 bg-blue-50/10" : ""
                      }`}
                      style={industry !== ind ? { borderColor: "var(--border)" } : undefined}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Tamanho da equipa</label>
                <div className="grid grid-cols-4 gap-2">
                  {["1-3", "4-10", "11-50", "50+"].map((size) => (
                    <button
                      key={size}
                      onClick={() => setTeamSize(size)}
                      className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                        teamSize === size ? "border-blue-500 bg-blue-50/10" : ""
                      }`}
                      style={teamSize !== size ? { borderColor: "var(--border)" } : undefined}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep(0)}>Voltar</Button>
                <Button onClick={() => setStep(2)} className="flex-1">Continuar <ArrowRight size={16} /></Button>
              </div>
            </div>
          )}

          {/* Step 2: Goals */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {goals.map((goal) => {
                  const selected = selectedGoals.includes(goal.id);
                  return (
                    <button
                      key={goal.id}
                      onClick={() => toggleGoal(goal.id)}
                      className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-all ${
                        selected ? "border-blue-500 bg-blue-50/10" : ""
                      }`}
                      style={!selected ? { borderColor: "var(--border)" } : undefined}
                    >
                      <goal.icon size={20} style={{ color: selected ? "var(--primary)" : "var(--muted-foreground)" }} />
                      <span className="text-sm">{goal.label}</span>
                      {selected && <Check size={16} className="ml-auto text-blue-500" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep(1)}>Voltar</Button>
                <Button onClick={() => setStep(3)} className="flex-1">Continuar <ArrowRight size={16} /></Button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "var(--secondary)" }}>
                <Check size={32} className="text-green-500" />
              </div>
              <div>
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  {industry && <span>Industria: <strong>{industry}</strong> | </span>}
                  {teamSize && <span>Equipa: <strong>{teamSize}</strong> | </span>}
                  {selectedGoals.length > 0 && <span>{selectedGoals.length} objetivos</span>}
                </p>
              </div>
              <Button onClick={handleComplete} loading={saving} className="w-full">
                <Building2 size={16} />
                Ir para o Dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
