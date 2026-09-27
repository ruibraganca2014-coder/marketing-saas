// Configuração da Domus Energia — muda estes valores para os teus.
window.DOMUS = {
  // Servidor MQTT da área de cliente (app e site). Usa o mesmo host que
  // DOMUS_HOST em servidor/.env, ex.: "wss://mqtt.domusenergia.pt/mqtt".
  mqttUrl: "wss://SEU-SERVIDOR/mqtt",

  // Serviços no mesmo site, atrás do Caddy: https://HOST/api/ (pagamentos; e /api/orcamento,
  // o formulário de pedido de orçamento, que fica no painel da empresa).
  // Deixe "/api" quando o site e o /api estão no mesmo servidor (a CSP só deixa ligar ao próprio site).
  apiUrl: "/api",

  // Contactos (formato internacional, sem espaços nem "+")
  whatsapp: "351900000000",
  telefone: "+351900000000",
  telefoneVisivel: "900 000 000",
  email: "geral@domusenergia.pt",
};
