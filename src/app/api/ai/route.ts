import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `Es um assistente de marketing digital. Gera conteudo criativo, profissional e envolvente em portugues europeu.
Formata o output de forma limpa sem markdown excessivo. Se for um post para redes sociais, inclui hashtags relevantes.
Se for um assunto de email, da 3 opcoes. Se for descricao de campanha, sê conciso e orientado a resultados.`;

export async function POST(req: NextRequest) {
  try {
    const { prompt, type } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt obrigatorio" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    // If no API key, use a template-based fallback
    if (!apiKey) {
      const fallback = generateFallback(prompt, type);
      return NextResponse.json({ content: fallback });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "Nao foi possivel gerar conteudo.";

    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: "Erro ao gerar conteudo" }, { status: 500 });
  }
}

function generateFallback(prompt: string, type: string): string {
  const topic = prompt.toLowerCase();

  if (type === "social_post") {
    return `Descubra como transformar o seu negocio com as nossas solucoes inovadoras!

Estamos a revolucionar a forma como as empresas crescem no digital.

O que nos diferencia:
- Resultados comprovados
- Equipa especializada
- Suporte dedicado

Nao perca esta oportunidade.

#Marketing #Digital #Crescimento #Negocio #Inovacao`;
  }

  if (type === "email_subject") {
    return `Opcao 1: Descubra as novidades que preparamos para si
Opcao 2: A oportunidade que estava a espera acaba de chegar
Opcao 3: Resultados que falam por si - veja como`;
  }

  if (type === "campaign_description") {
    return `Campanha focada em aumentar a notoriedade da marca e gerar leads qualificados atraves de conteudo relevante e segmentacao precisa. Objetivo: crescer a base de contactos em 25% e melhorar a taxa de conversao no funil de vendas.`;
  }

  return `Conteudo gerado para: ${prompt}\n\nEste e um conteudo de demonstracao. Configure a variavel OPENAI_API_KEY no .env.local para gerar conteudo com AI real.`;
}
