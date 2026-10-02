// Configuração da Domus Energia — muda estes valores para os teus.
window.DOMUS = {
  // Servidor MQTT da área de cliente (app e site). Usa o mesmo host que
  // DOMUS_HOST em servidor/.env, ex.: "wss://mqtt.domusenergia.pt/mqtt".
  mqttUrl: "wss://SEU-SERVIDOR/mqtt",

  // Serviços no mesmo site, atrás do Caddy: https://HOST/api/ (pagamentos; e /api/orcamento,
  // o formulário de pedido de orçamento, que fica no painel da empresa).
  // Deixe "/api" quando o site e o /api estão no mesmo servidor (a CSP só deixa ligar ao próprio site).
  apiUrl: "/api",

  // Painel da empresa (pedido de orçamento, catálogo e conta de cliente: /api/orcamento*, /api/catalogo,
  // /api/conta/*) noutro endereço, ex.: site no Vercel (https://domusenergia.pt) e servidor em
  // "https://api.domusenergia.pt". Vazio = o mesmo site (servidor com o Caddy). Com endereço, o painel tem
  // de ter SITE_ORIGENS com a origem do site e a CSP do site tem de deixar ligar a ele (docs/CONTA-CLIENTE.md).
  apiBase: "",

  // Contactos (formato internacional, sem espaços nem "+")
  whatsapp: "351900000000",
  telefone: "+351900000000",
  telefoneVisivel: "900 000 000",
  email: "geral@domusenergia.pt",

  // Identificação da empresa nas páginas legais (privacidade.html, termos.html, cookies.html; web/legal.js).
  // Preencha uma vez aqui: as três páginas atualizam-se sozinhas. Enquanto estiver "[A PREENCHER]" aparece assinalado.
  empresa: {
    nome: "Estação Nómada, Unipessoal Lda.",       // nome legal (certidão permanente; marca Domus Energia)
    nif: "519 588 533",                              // NIPC
    morada: "Rua 1.º de Maio, n.º 2, 2730-144 Barcarena (Oeiras)",   // sede
    ral: "CNIACC — Centro Nacional de Informação e Arbitragem de Conflitos de Consumo, www.cniacc.pt",
  },
};
