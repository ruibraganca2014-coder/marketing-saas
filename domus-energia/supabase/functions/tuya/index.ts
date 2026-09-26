// Edge Function "tuya": ponte segura entre os clientes (app/site) e a Tuya Cloud.
// A chave secreta da Tuya só existe aqui, como secret do Supabase.
//
// Pedidos (POST, com o login do cliente no header Authorization):
//   { "action": "list" }
//   { "action": "command", "device_id": "...", "code": "switch_1", "value": true }

import { createClient } from "npm:@supabase/supabase-js@2";

const TUYA_ENDPOINT = Deno.env.get("TUYA_ENDPOINT") ?? "https://openapi.tuyaeu.com";
const TUYA_ACCESS_ID = Deno.env.get("TUYA_ACCESS_ID") ?? "";
const TUYA_ACCESS_SECRET = Deno.env.get("TUYA_ACCESS_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const encoder = new TextEncoder();
const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(text: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function hmacSha256Upper(message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TUYA_ACCESS_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message))).toUpperCase();
}

// Token da Tuya reutilizado enquanto a instância da função estiver viva.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function tuyaRequest(method: string, path: string, body?: unknown, withToken = true): Promise<any> {
  const token = withToken ? await tuyaToken() : "";
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const stringToSign = `${method}\n${await sha256Hex(bodyText)}\n\n${path}`;
  const sign = await hmacSha256Upper(TUYA_ACCESS_ID + token + t + nonce + stringToSign);

  const headers: Record<string, string> = {
    client_id: TUYA_ACCESS_ID,
    sign,
    t,
    nonce,
    sign_method: "HMAC-SHA256",
    "Content-Type": "application/json",
  };
  if (withToken) headers.access_token = token;

  const res = await fetch(TUYA_ENDPOINT + path, {
    method,
    headers,
    body: method === "GET" ? undefined : bodyText,
  });
  const json = await res.json();
  if (!json.success) {
    // Token expirado: limpa-o para ser pedido outro no próximo pedido.
    if (String(json.msg).toLowerCase().includes("token")) cachedToken = null;
    throw new Error(`Tuya: ${json.msg ?? "erro desconhecido"} (código ${json.code})`);
  }
  return json.result;
}

async function tuyaToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const result = await tuyaRequest("GET", "/v1.0/token?grant_type=1", undefined, false);
  cachedToken = {
    value: result.access_token,
    expiresAt: Date.now() + (result.expire_time - 60) * 1000,
  };
  return cachedToken.value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  // Cliente Supabase com o login de quem fez o pedido: o RLS só deixa ver os seus aparelhos.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sessão inválida. Entra outra vez." }, 401);

  const { data: aparelhos, error } = await supabase.from("aparelhos").select("device_id, nome");
  if (error) return json({ error: error.message }, 500);

  try {
    const payload = await req.json();

    if (payload.action === "list") {
      const devices = await Promise.all(
        aparelhos.map(async (a) => {
          try {
            const d = await tuyaRequest("GET", `/v1.0/devices/${encodeURIComponent(a.device_id)}`);
            return { id: d.id, name: a.nome || d.name, online: d.online, category: d.category, status: d.status ?? [] };
          } catch {
            return { id: a.device_id, name: a.nome || a.device_id, online: false, category: "", status: [] };
          }
        }),
      );
      return json({ devices });
    }

    if (payload.action === "command") {
      const { device_id, code, value } = payload;
      if (!aparelhos.some((a) => a.device_id === device_id)) {
        return json({ error: "Aparelho não pertence a esta conta." }, 403);
      }
      // Por agora só se permite ligar e desligar circuitos.
      if (typeof code !== "string" || !code.startsWith("switch") || typeof value !== "boolean") {
        return json({ error: "Comando não permitido." }, 400);
      }
      await tuyaRequest("POST", `/v1.0/devices/${encodeURIComponent(device_id)}/commands`, {
        commands: [{ code, value }],
      });
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
