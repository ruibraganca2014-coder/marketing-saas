// Configuração da Domus Energia — muda estes valores para os teus.
window.DOMUS = {
  // Servidor MQTT da área de cliente (app e site). Usa o mesmo host que
  // DOMUS_HOST em servidor/.env, ex.: "wss://mqtt.domusenergia.pt/mqtt".
  mqttUrl: "wss://SEU-SERVIDOR/mqtt",

  // Supabase → Project Settings → API (usado só pelo formulário de orçamento)
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseAnonKey: "COLAR_A_ANON_KEY_AQUI",

  // Contactos (formato internacional, sem espaços nem "+")
  whatsapp: "351900000000",
  telefone: "+351900000000",
  telefoneVisivel: "900 000 000",
  email: "geral@domusenergia.pt",
};
