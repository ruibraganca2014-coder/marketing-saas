// Pedidos de orçamento: quadro por estado (computador) ou lista (telemóvel); ficha com notas, data da
// visita, valor da proposta, motivo de perda, histórico e "Converter em cliente e obra" (orçamento aceite).
// Com simulação: "Relatório técnico" (#/orcamentos/<id>/relatorio), vista para imprimir / guardar PDF.
// Fotos do cliente (simulador): galeria na ficha (CEO/comercial podem apagar) e no relatório.
// Diagnóstico de avarias (docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): nos pedidos de avaria/reparação, a secção
// "Diagnóstico" (o que o cliente descreveu → tipos prováveis e primeiras verificações; lista de verificação com medições;
// tipo encontrado; conclusão) → POST orcamentos/:id/diagnostico; aparece no relatório técnico e no relatório completo do cliente.
// Pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md): relatório completo, visita, avaria, sinal e restante com o
// estado; "Libertar relatório ao cliente" (CEO, depois de o cliente o comprar); "Marcar visita" (data e hora, com a
// disponibilidade do cliente); "Aceite — a aguardar sinal" até o sinal estar pago; "Marcar obra concluída".
import { pedir, campo, lista, numero, idPedido, palavraPasse } from "../api.js";
import { h, ESTADOS_ORC, NOMES_ESTADO_ORC, MOTIVOS_PERDA, KITS, euros, data, selo, campoForm, escolha, dados, janela, mensagem, avisar, carregando, erroEcra, txt, isoDia, mostrarPalavraPasse } from "../ui.js";
import { RE_CODIGO, sugerirCodigo } from "./clientes.js";
import { vistaSimulacao, aparelhosDaSimulacao, relatorioTecnico, galeriaFotos, nomeTipoFoto, urgenciaDe, visitaTxt, URGENCIAS, ehAvaria, servicosDe, blocoDiagnostico } from "./simulacao.js";
import { CHECKLIST, NOME_TIPO, PROBLEMAS, sugestoesPara, MAX_CONCLUSAO } from "./diagnostico-conteudo.js";
// Conteúdo técnico do relatório completo (cópia de web/simulador/simbolos.js): planta técnica, esquemas, ensaios.
import { seccaoTecnica } from "../vendor/simbolos.js";
// Esquema do quadro feito pelo eletricista (ronda B; cópia de web/simulador/quadro-desenho.js): desenho e modelo.
import {
  desenharQuadroCliente, nomeComponente, normalizarEsquema, esquemaVazio, esquemaDaLeitura, esquemaTemAlgo, resumoEsquema, ESTADOS_QUADRO, AMPERES_GERAL,
  AMPERES_DIFERENCIAL, AMPERES_DISJUNTOR, MA_DIFERENCIAL, MAX_ESQUEMA,
} from "../vendor/quadro-desenho.js";
import { urlFoto } from "./simulacao.js";
import { blocoEletricista } from "./atribuicao.js";

const CHAVE_VISTA = "domus.painel.orcamentos.vista";
const ler = () => { try { return localStorage.getItem(CHAVE_VISTA); } catch { return null; } };
const gravar = (v) => { try { localStorage.setItem(CHAVE_VISTA, v); } catch {} };
/** "AAAA-MM-DDTHH:MM" para <input type=datetime-local>. */
const paraInput = (v) => {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T09:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${isoDia(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function orcamentos(el, ctx) {
  const ctrl = new AbortController();
  let todos = [];
  let arquivados = null;   // pedidos arquivados (RGPD): só com o filtro "Arquivados" (CEO), pedidos à parte
  let ficha = null;
  let vista = ler() ?? (matchMedia("(min-width: 960px)").matches ? "quadro" : "lista");

  const bQuadro = h("button", { class: "segmento", type: "button", text: "Quadro", "aria-pressed": "false", onclick: () => mudarVista("quadro") });
  const bLista = h("button", { class: "segmento", type: "button", text: "Lista", "aria-pressed": "false", onclick: () => mudarVista("lista") });
  const fEstado = escolha("estado", { "": "Todos os estados", ...ESTADOS_ORC, ...(ctx.pode("ceo") ? { arquivado: "Arquivados (RGPD)" } : {}) }, "", { "aria-label": "Filtrar por estado" });
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar nome ou localidade", "aria-label": "Procurar pedido", maxlength: "80" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "zona-orcamentos" }, carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Orçamentos" }), h("div", { class: "segmentos", role: "group", "aria-label": "Mostrar como" }, bQuadro, bLista)),
    h("div", { class: "filtros" }, fTexto, fEstado), contagem, zona);
  fEstado.addEventListener("change", () => { if (fEstado.value === "arquivado" && !arquivados) carregarArquivados(); else desenhar(); });
  fTexto.addEventListener("input", desenhar);

  function mudarVista(v) { vista = v; gravar(v); desenhar(); }

  async function carregar() {
    try { todos = lista(await pedir("orcamentos", { sinal: ctrl.signal }), "orcamentos", "pedidos"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    desenhar();
  }

  /** Os arquivados (RGPD) não vêm na lista normal: GET orcamentos?estado=arquivado (só CEO). */
  async function carregarArquivados() {
    zona.replaceChildren(carregando());
    try { arquivados = lista(await pedir("orcamentos?estado=arquivado", { sinal: ctrl.signal }), "orcamentos", "pedidos"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregarArquivados)); return; }
    desenhar();
  }

  function desenhar() {
    bQuadro.setAttribute("aria-pressed", String(vista === "quadro"));
    bLista.setAttribute("aria-pressed", String(vista === "lista"));
    fEstado.hidden = vista === "quadro";
    const t = fTexto.value.trim().toLowerCase();
    const verArquivados = vista === "lista" && fEstado.value === "arquivado";
    const vis = (verArquivados ? arquivados ?? [] : todos)
      .filter((o) => !t || [campo(o, "nome"), campo(o, "localidade"), campo(o, "servico")].some((v) => String(v ?? "").toLowerCase().includes(t)))
      .filter((o) => vista === "quadro" || !fEstado.value || campo(o, "estado") === fEstado.value)
      .sort((a, b) => String(campo(b, "criado", "criado_em") ?? "").localeCompare(String(campo(a, "criado", "criado_em") ?? "")));
    const novos = todos.filter((o) => campo(o, "estado") === "novo").length;
    contagem.textContent = `${vis.length} ${vis.length === 1 ? "pedido" : "pedidos"}${novos ? ` · ${novos} ${novos === 1 ? "novo" : "novos"}` : ""}`;
    if (!todos.length && !verArquivados) { zona.replaceChildren(h("p", { class: "vazio", text: "Ainda não há pedidos de orçamento." })); return; }
    if (vista === "quadro") {
      zona.replaceChildren(h("div", { class: "quadro", id: "quadro-orcamentos" }, ...Object.entries(ESTADOS_ORC).map(([k, nome]) => {
        const col = vis.filter((o) => (campo(o, "estado") ?? "novo") === k);
        return h("section", { class: `coluna coluna-${k}`, dataset: { estado: k }, "aria-label": `${nome}: ${col.length}` },
          h("h2", {}, nome, " ", h("span", { class: "contagem num", text: String(col.length) })),
          col.length ? h("ul", { class: "cartoes-orc" }, ...col.map(cartao)) : h("p", { class: "vazio", text: "Nenhum." }));
      })));
    } else {
      zona.replaceChildren(vis.length ? h("ul", { class: "linhas", id: "lista-orcamentos" }, ...vis.map((o) => cartao(o, true))) : h("p", { class: "vazio", text: "Nenhum pedido com estes filtros." }));
    }
  }

  function cartao(o, comEstado = false) {
    const id = String(campo(o, "id"));
    const estado = campo(o, "estado") ?? "novo";
    const valor = campo(o, "valor_proposta");
    return h("li", {}, h("a", { class: "linha cartao-orc", href: `#/orcamentos/${encodeURIComponent(id)}`, dataset: { id } },
      h("span", { class: "linha-principal" }, h("strong", { text: txt(o, "nome") }), h("span", { class: "ajuda", text: `${txt(o, "servico")} · ${txt(o, "localidade")}` })),
      h("span", { class: "linha-selos" },
        comEstado ? selo(NOMES_ESTADO_ORC[estado] ?? estado, `orc-${estado}`) : null,
        urgenciaPedido(o) === "urgente" ? selo("Urgente", "aviso") : urgenciaPedido(o) === "semana" ? selo("Esta semana", "info") : null,
        campo(o, "aguarda_sinal") === true ? selo("Aceite — a aguardar sinal", "info") : null,
        campo(o, "data_visita") && estado === "visita_marcada" ? selo(`Visita ${data(campo(o, "data_visita"))}`, "info") : null,
        valor != null && valor !== "" ? selo(euros(valor), "valor") : null,
        simulacaoDe(o) || campo(o, "tem_simulacao") === true ? selo("Com simulação", "info") : null,
        numero(campo(o, "n_fotos")) > 0 ? selo(`${campo(o, "n_fotos")} ${campo(o, "n_fotos") === 1 ? "foto" : "fotos"}`, "info") : null),
      h("span", { class: "linha-extra ajuda", text: `Recebido ${data(campo(o, "criado", "criado_em"))}` })));
  }

  // ---------- Ficha ----------
  function abrirFicha(id) {
    if (ficha?.id === id) return;
    ficha?.j.fechar();
    const j = janela("Pedido de orçamento", { larga: true, aoFechar: () => { if (ficha?.j === j) ficha = null; if (location.hash === `#/orcamentos/${encodeURIComponent(id)}`) ctx.navegar("orcamentos"); } });
    ficha = { id, j };
    const o = todos.find((x) => String(campo(x, "id")) === id);
    if (o) desenharFicha(j, o); else j.corpo.append(carregando());
    // A lista não traz a simulação nem o histórico: pede o pedido completo (GET orcamentos/:id).
    pedir(`orcamentos/${encodeURIComponent(id)}`).then((r) => {
      const completo = campo(r, "orcamento") ?? r;
      if (ficha?.j !== j || !completo || typeof completo !== "object") return;
      substituir(completo, false);
      desenharFicha(j, completo, true);
    }).catch(async (e) => {
      if (ficha?.j !== j) return;
      await esperarLista;
      const x = todos.find((y) => String(campo(y, "id")) === id);
      if (x && !o) desenharFicha(j, x);
      else if (!x) j.corpo.replaceChildren(e.estado === 404 || e.estado === 0 ? h("p", { class: "vazio", text: "Pedido não encontrado." }) : erroEcra(e));
    });
  }

  function desenharFicha(j, o, manterFoco = false) {
    const id = String(campo(o, "id"));
    // Não apaga o que a pessoa já está a escrever quando chega o pedido completo.
    const emEdicao = manterFoco && j.corpo.querySelector("#form-orcamento, #form-converter")?.matches(":focus-within");
    if (emEdicao) {
      const sim = simulacaoDe(o), antes = j.corpo.querySelector("#simulacao-cliente");
      if (sim && (!antes || antes.dataset.carregando !== undefined)) { const v = vistaSimulacao(sim, catalogoDe(o)); if (antes) antes.replaceWith(v); else j.corpo.querySelector("#form-orcamento")?.before(v); }
      return;
    }
    const estado = campo(o, "estado") ?? "novo";
    const arquivado = estado === "arquivado";
    j.titulo.textContent = txt(o, "nome");
    const tel = campo(o, "telefone"), email = campo(o, "email");
    const contactos = h("div", { class: "form-botoes" },
      tel ? h("a", { class: "btn sec pequeno", href: `tel:${String(tel).replace(/[^\d+]/g, "")}`, text: `Ligar ${tel}` }) : null,
      email ? h("a", { class: "btn sec pequeno", href: `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`, text: "Enviar email" }) : null,
      simulacaoDe(o) || campo(o, "tem_simulacao") === true
        ? h("a", { class: "btn sec pequeno", id: "abrir-relatorio", href: `#/orcamentos/${encodeURIComponent(id)}/relatorio`, text: "Relatório técnico" }) : null,
      campo(o, "crm_cliente_id") ? h("a", { class: "btn sec pequeno", id: "abrir-crm", href: `#/crm/${encodeURIComponent(campo(o, "crm_cliente_id"))}`, text: "Ficha do cliente (CRM)" }) : null);
    const partes = [
      h("div", { class: "linha-selos" }, selo(NOMES_ESTADO_ORC[estado] ?? estado, `orc-${estado}`),
        urgenciaPedido(o) === "urgente" ? selo("Urgente", "aviso") : null,
        campo(o, "aguarda_sinal") === true ? selo("Aceite — a aguardar sinal", "info") : null),
      dados([["Serviço", txt(o, "servico")], ["Localidade", txt(o, "localidade")], ...(campo(o, "morada") ? [["Morada", txt(o, "morada")]] : []),
        ["Telefone", txt(o, "telefone")], ["Email", txt(o, "email")], ["Conta de cliente", textoConta(campo(o, "conta"))], ["Recebido", data(campo(o, "criado", "criado_em"))]]),
      contactos,
    ];
    if (campo(o, "anonimizado")) partes.unshift(h("div", { class: "msg info bloco", id: "pedido-anonimizado", text: `Anonimizado (RGPD) em ${data(campo(o, "anonimizado"))}: a conta foi apagada; ficam os valores, as referências e os pagamentos (contabilidade).` }));
    if (campo(o, "mensagem")) partes.push(h("h3", { text: "Mensagem do cliente" }), h("p", { class: "mensagem-cliente", text: String(campo(o, "mensagem")) }));
    // Assistente (IA; docs/ASSISTENTE-IA.md): só na ficha completa (a que traz `ia`).
    if (o && typeof o === "object" && "ia" in o) partes.push(seccaoIa(j, o, "resumo", arquivado));
    const sim = simulacaoDe(o);
    if (sim) partes.push(vistaSimulacao(sim, catalogoDe(o)));
    else if (campo(o, "tem_simulacao") === true) partes.push(h("section", { class: "simulacao", id: "simulacao-cliente", dataset: { carregando: "" } }, h("h3", { text: "Simulação do cliente" }), carregando()));
    const fotos = lista(campo(o, "fotos") ?? [], "fotos");
    if (fotos.length) {
      partes.push(h("section", { class: "fotos-pedido", id: "fotos-pedido" },
        h("h3", { text: `Fotos do cliente (${fotos.length})` }),
        h("p", { class: "ajuda", text: "Enviadas pelo cliente (no simulador ou na conta). Toque numa foto para a ver inteira." }),
        galeriaFotos(id, fotos, { aoApagar: arquivado ? null : (f, b) => apagarFoto(j, id, f, b) })));
    }
    // Ronda B: o esquema do quadro feito pelo eletricista a partir da foto do cliente (a ficha completa traz `esquema_quadro`).
    if (o && typeof o === "object" && "esquema_quadro" in o) partes.push(seccaoEsquemaQuadro(j, o, fotos, arquivado));
    // Diagnóstico de avarias: nos pedidos da avaria rápida e nos que têm reparações (a ficha completa traz `diagnostico`).
    if (o && typeof o === "object" && "diagnostico" in o && precisaDiagnostico(sim)) partes.push(seccaoDiagnostico(j, o, sim, arquivado));
    const plano = campo(o, "plano_escolhido") ? ` Plano mensal escolhido: ${PLANOS_NOME[campo(o, "plano_escolhido")] ?? campo(o, "plano_escolhido")}.` : "";
    if (campo(o, "aguarda_sinal") === true) partes.push(h("div", { class: "msg info bloco", id: "proposta-aceite-online" }, `Aceite pelo cliente em ${data(campo(o, "proposta_aceite"))} — a aguardar o sinal.${plano}`));
    else if (campo(o, "proposta_aceite")) partes.push(h("div", { class: "msg ok bloco", id: "proposta-aceite-online" }, `Proposta aceite pelo cliente (online) em ${data(campo(o, "proposta_aceite"))}.${plano}`));
    partes.push(...blocoPagamentos(j, o, arquivado));
    // Eletricista externo (CEO; docs/ELETRICISTAS.md): atribuir o pedido (obra, visita paga ou diagnóstico) ou pô-lo na
    // bolsa; só na ficha completa (a que traz o histórico), para não pedir duas vezes.
    if (ctx.pode("ceo") && ctx.eletricistas && !arquivado && o && typeof o === "object" && "historico" in o) partes.push(blocoEletricista(id));
    // Ensaios medidos (relatório completo): só com simulação, fora dos arquivados; a ficha completa traz `ensaios`
    // (null enquanto não há medições: `campo()` devolve undefined para null, por isso vê-se a chave).
    if ((sim || campo(o, "tem_simulacao") === true) && !arquivado && o && typeof o === "object" && "ensaios" in o) partes.push(formEnsaios(j, o));
    if (campo(o, "codigo_cliente") && !campo(o, "cliente")) partes.push(h("p", { class: "ajuda", text: `Pedido feito por um cliente que já existe: ${campo(o, "codigo_cliente")}.` }));

    // Formulário de acompanhamento
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const sEstado = escolha("estado", ESTADOS_ORC, estado);
    const motivo = campoForm("Motivo da perda", h("input", { name: "motivo_perda", maxlength: "300", value: campo(o, "motivo_perda") ?? "" }));
    // CRM (docs/CRM-TAREFAS.md): o motivo escolhido (preço, prazo, sem resposta, outro); o texto fica como pormenor.
    const motivoTipo = campoForm("Motivo (tipo)", escolha("motivo_perda_tipo", { "": "Escolha…", ...MOTIVOS_PERDA }, campo(o, "motivo_perda_tipo") ?? ""));
    // Proposta em três partes (sem IVA; decisão 15): mão de obra, material e deslocação; o valor da proposta é a soma.
    // Vazias = proposta de um só valor (como antes). "Preencher pela simulação" (ou escolher "Proposta enviada" sem
    // valores) põe as partes recalculadas pelo servidor a partir do catálogo; o CEO acerta-as depois da visita.
    const pPartes = campo(o, "proposta_partes");
    const sugerida = campo(o, "proposta_sugerida");
    const parte = (nome, valor) => h("input", { name: nome, type: "number", min: "0", step: "0.01", inputmode: "decimal", value: valor ?? "" });
    const pMao = parte("proposta_mao_obra", pPartes?.mao_obra), pMat = parte("proposta_material", pPartes?.material), pDes = parte("proposta_deslocacao", pPartes?.deslocacao);
    const iValor = h("input", { name: "valor_proposta", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: campo(o, "valor_proposta") ?? "" });
    const temPartes = () => [pMao, pMat, pDes].some((i) => i.value.trim() !== "");
    // Apagadas as três partes, o valor volta ao valor único de antes (vazio se o pedido já tinha partes: era a soma delas).
    const valorUnico = pPartes ? "" : iValor.value;
    const faltaParte = h("p", { class: "msg info", id: "proposta-partes-falta", "aria-live": "polite", hidden: true, text: "Preencha as três partes (0 se não houver) ou deixe as três vazias." });
    const somar = () => {
      const com = temPartes();
      if (!com && iValor.readOnly) iValor.value = valorUnico;
      iValor.readOnly = com;
      faltaParte.hidden = !com || [pMao, pMat, pDes].every((i) => i.value.trim() !== "");
      if (com) iValor.value = (Math.round([pMao, pMat, pDes].reduce((t, i) => t + (numero(i.value) ?? 0), 0) * 100) / 100).toFixed(2);
    };
    for (const i of [pMao, pMat, pDes]) i.addEventListener("input", somar);
    const preencher = () => {
      if (!sugerida) return;
      pMao.value = sugerida.mao_obra ?? ""; pMat.value = sugerida.material ?? ""; pDes.value = sugerida.deslocacao ?? "";
      somar();
    };
    const bPreencher = sugerida ? h("button", { class: "btn sec pequeno", type: "button", id: "preencher-proposta", text: "Preencher pela simulação", onclick: preencher }) : null;
    const blocoPartes = h("fieldset", { class: "grupo", id: "proposta-partes" }, h("legend", { text: "Proposta (€, sem IVA)" }),
      h("div", { class: "tres" }, campoForm("Mão de obra", pMao), campoForm("Material", pMat), campoForm("Deslocação", pDes)),
      faltaParte,
      h("p", { class: "ajuda", text: `O total é a soma das três partes; o cliente vê o detalhe. Vazias = um só valor.${sugerida?.horas ? ` A simulação dá cerca de ${String(sugerida.horas).replace(".", ",")} h de mão de obra.` : ""}` }),
      bPreencher);
    const f = h("form", { class: "form-grelha", id: "form-orcamento", novalidate: true },
      h("h3", { text: "Acompanhamento" }),
      h("div", { class: "duas" },
        campoForm("Estado", sEstado),
        campoForm("Data da visita", h("input", { name: "data_visita", type: "datetime-local", value: paraInput(campo(o, "data_visita")) }))),
      blocoPartes,
      campoForm("Valor da proposta (€, sem IVA)", iValor),
      campoForm("Texto da proposta (o cliente vê-o na conta)", h("textarea", { name: "proposta_texto", maxlength: "4000", rows: "3" }, campo(o, "proposta_texto") ?? ""),
        campo(o, "conta") ? "Com o estado \"Proposta enviada\" e o valor, o cliente vê a proposta na conta e pode carregar em \"Aceito a proposta\" (valor + IVA)." : "Este pedido não tem conta de cliente: a proposta vai por email ou em mão."),
      motivoTipo, motivo,
      campoForm("Notas", h("textarea", { name: "notas", maxlength: "4000", rows: "4" }, campo(o, "notas") ?? "")),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar" })),
      msg);
    if (arquivado) {
      // Arquivado (RGPD): só leitura — nem o estado nem os dados mudam (o servidor recusa).
      partes.push(h("p", { class: "msg info bloco", id: "pedido-arquivado", text: "Pedido arquivado (RGPD): fica só para a contabilidade (pagamentos e CSV); não se muda o estado nem os dados." }));
      const hist = lista(campo(o, "historico") ?? [], "historico");
      if (hist.length) partes.push(h("h3", { text: "Histórico" }), h("ol", { class: "historico-p" }, ...hist.map((x) =>
        h("li", {}, h("span", { class: "num ajuda", text: data(campo(x, "quando", "em", "data")) }), " ", h("span", { text: textoHistorico(x, sim) })))));
      j.corpo.replaceChildren(...partes);
      return;
    }
    const mostrarMotivo = () => { motivo.hidden = motivoTipo.hidden = sEstado.value !== "perdido"; };
    sEstado.addEventListener("change", mostrarMotivo); mostrarMotivo();
    // Abrir a proposta ("Proposta enviada") ainda sem valores: as três partes vêm pré-preenchidas pela simulação.
    sEstado.addEventListener("change", () => { if (sEstado.value === "proposta_enviada" && !temPartes() && iValor.value.trim() === "") preencher(); });
    somar();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const v = el.valor_proposta.value.trim();
      const valor = v === "" ? null : numero(v);
      if (v !== "" && (valor === null || valor < 0)) { mensagem(msg, "O valor da proposta tem de ser um número igual ou maior que 0."); el.valor_proposta.focus(); return; }
      if (el.estado.value === "visita_marcada" && !el.data_visita.value) { mensagem(msg, "Indique a data da visita."); el.data_visita.focus(); return; }
      if (el.estado.value === "perdido" && !el.motivo_perda.value.trim() && (!el.motivo_perda_tipo.value || el.motivo_perda_tipo.value === "outro")) { mensagem(msg, "Indique o motivo da perda."); el.motivo_perda.focus(); return; }
      const corpo = {
        estado: el.estado.value,
        notas: el.notas.value.trim(),
        data_visita: el.data_visita.value || null,
        valor_proposta: valor,
        proposta_texto: el.proposta_texto.value.trim() || null,
        motivo_perda: el.estado.value === "perdido" ? el.motivo_perda.value.trim() : null,
        ...(el.estado.value === "perdido" ? { motivo_perda_tipo: el.motivo_perda_tipo.value || null } : {}),
      };
      // As três partes ou nenhuma: com elas o servidor faz a soma; sem elas (e se as havia) passa a um só valor.
      if (temPartes()) {
        for (const i of [pMao, pMat, pDes]) {
          const n = i.value.trim() === "" ? null : numero(i.value);
          if (n === null || n < 0) { mensagem(msg, "Preencha as três partes da proposta (mão de obra, material e deslocação), ou deixe as três vazias."); i.focus(); return; }
          corpo[i.name] = n;
        }
        delete corpo.valor_proposta;
      } else if (pPartes) Object.assign(corpo, { proposta_mao_obra: null, proposta_material: null, proposta_deslocacao: null });
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}`, { corpo });
        const novo = campo(r, "orcamento") ?? (r && typeof r === "object" && campo(r, "id") !== undefined ? r : { ...o, ...corpo });
        substituir(novo);
        avisar("Pedido de orçamento guardado.");
        desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    partes.push(f);

    // Converter (só aceite, e ainda não convertido)
    const obra = campo(o, "obra_id", "obra");
    // A obra nasce com o sinal pago; "convertido" = a casa já está ligada (o pedido tem cliente).
    const convertido = campo(o, "cliente", "cliente_codigo");
    const ob = campo(o, "obra");
    if (convertido) {
      partes.push(h("div", { class: "msg ok bloco" }, "Convertido em cliente ",
        h("a", { href: `#/clientes/${encodeURIComponent(typeof convertido === "string" ? convertido : "")}`, text: typeof convertido === "string" ? convertido : "" }),
        obra ? [" e ", h("a", { href: `#/obras/${encodeURIComponent(typeof obra === "object" ? campo(obra, "id") : obra)}`, text: "obra" })] : null, "."));
    } else if (estado === "aceite") {
      // Decisão 1: a casa só se liga com a obra toda paga. Com os pagamentos desligados (ou sem conta) liga-se, com aviso.
      const lig = campo(o, "ligar_casa");
      // A obra já existe (por agendar ou com data): agenda-se e atribui-se o técnico no ecrã Obras.
      if (ob && typeof ob === "object") {
        partes.push(h("div", { class: "msg info bloco", id: "obra-do-pedido" }, h("span", {}, "Obra criada com o sinal: ",
          h("a", { href: `#/obras/${encodeURIComponent(ob.id)}`, text: ob.estado === "cancelada" ? "cancelada" : ob.estado === "concluida" ? "concluída" : ob.por_agendar ? "por agendar" : `agendada para ${data(ob.data, { hora: false })}` }),
          lig && lig.pode === false ? ". Casa por ligar — falta o restante." : ". Casa por ligar.")));
      }
      if (lig && lig.pode === false) {
        partes.push(h("section", { class: "form-grelha converter", id: "converter-bloqueado" },
          h("h3", { text: "Ligar casa" }),
          h("p", { class: "msg info", id: "converter-falta", text: `Falta o cliente pagar o restante (${euros(lig.falta)}). A casa (app e mensalidade) só se liga com a obra paga.` }),
          h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "button", disabled: true, text: "Ligar casa" }))));
      } else {
        if (lig?.aviso) partes.push(h("p", { class: "msg info bloco", id: "converter-aviso", text: lig.aviso }));
        partes.push(formConverter(j, o));
      }
      // Antes de a obra ser feita, o CEO pode cancelá-la e devolver o sinal (todo ou parte).
      const sinalPago = lista(campo(o, "pagamentos") ?? [], "pagamentos").find((x) => campo(x, "fase") === "sinal" && campo(x, "estado") === "pago" && campo(x, "devolvido") == null && campo(x, "a_devolver") == null);
      if (ctx.pode("ceo") && sinalPago && !campo(o, "obra_concluida")) partes.push(formDevolverSinal(j, o, sinalPago));
    }

    const hist = lista(campo(o, "historico") ?? [], "historico");
    if (hist.length) partes.push(h("h3", { text: "Histórico" }), h("ol", { class: "historico-p" }, ...hist.map((x) =>
      h("li", {}, h("span", { class: "num ajuda", text: data(campo(x, "quando", "em", "data")) }), " ", h("span", { text: textoHistorico(x, sim) }), campo(x, "por", "utilizador", "email") ? h("span", { class: "ajuda", text: ` · ${txt(x, "por", "utilizador", "email")}` }) : null))));
    j.corpo.replaceChildren(...partes);
  }

  async function apagarFoto(j, id, f, b) {
    try {
      const r = await pedir(`orcamentos/${encodeURIComponent(id)}/fotos/${encodeURIComponent(f.id)}/apagar`, { corpo: {} });
      const novo = campo(r, "orcamento") ?? r;
      substituir(novo);
      avisar("Foto apagada.");
      if (ficha?.j === j) desenharFicha(j, novo);
    } catch (erro) {
      b.disabled = false; b.textContent = "Apagar";
      avisar(erro.message, "erro");
    }
  }

  /** Pagamentos do pedido, relatório para o cliente (CEO liberta) e fim da obra. */
  function blocoPagamentos(j, o, arquivado = false) {
    const id = String(campo(o, "id"));
    const pags = lista(campo(o, "pagamentos") ?? [], "pagamentos");
    const out = [];
    const acoes = [];
    const sim = simulacaoDe(o) || campo(o, "tem_simulacao") === true;
    const acao = async (b, caminho, aviso, corpo = {}) => {
      b.disabled = true;
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/${caminho}`, { corpo });
        const novo = campo(r, "orcamento") ?? r;
        substituir(novo);
        avisar(aviso);
        if (ficha?.j === j) desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; avisar(erro.message, "erro"); }
    };
    if (sim && !arquivado) {
      // O CEO vê primeiro o que o cliente vai ver (lista de trabalho, material e preços do catálogo) e depois liberta.
      if (ctx.pode("ceo")) acoes.push(h("button", { class: "btn sec pequeno", type: "button", id: "previa-relatorio-cliente", text: "Pré-visualizar versão do cliente",
        onclick: (e) => previaRelatorio(id, e.currentTarget) }));
      // Fase 3: o relatório básico é grátis e automático; o pormenorizado só se liberta depois de o cliente o comprar
      // (com os pagamentos desligados não se compra: o CEO decide).
      const cp = campo(o, "compras");
      const comprado = !cp || cp.relatorio?.comprado || cp.ativas === false;
      if (campo(o, "relatorio_libertado")) out.push(h("p", { class: "ajuda", id: "relatorio-libertado", text: `Relatório completo libertado ao cliente em ${data(campo(o, "relatorio_libertado"))}.` }));
      else if (!comprado) out.push(h("p", { class: "ajuda", id: "relatorio-por-comprar", text: cp?.avaria ? "Avaria: sem relatório completo (o cliente tem o básico)." : "O cliente tem o relatório básico; o completo ainda não foi comprado." }));
      else if (ctx.pode("ceo")) acoes.push(h("button", { class: "btn pequeno", type: "button", id: "libertar-relatorio", text: "Libertar relatório ao cliente",
        onclick: (e) => acao(e.currentTarget, "libertar-relatorio", "Relatório libertado: o cliente já o vê na conta.") }));
      else out.push(h("p", { class: "ajuda", text: "Relatório completo em revisão: o CEO liberta-o ao cliente (até 24 h)." }));
      out.push(...blocoVisitaPainel(j, o, acao));
    }
    // Proposta sem IVA → o que o cliente paga online (com IVA): total, sinal e restante.
    const vp = campo(o, "valores_pagamento");
    if (vp && typeof vp === "object") {
      // Decisões de 2026-10-02: o sinal cobre o material (o maior entre 30 % e o material); obra mínima (cobra-se o
      // mínimo e o que foi pago antes não se desconta); a proposta em três partes.
      const desconto = vp.desconto ?? vp.pago_antes ?? vp.relatorio ?? 0;
      const sinalTxt = vp.sinal_material ? `cobre o material${vp.material_origem === "venda" ? ", pelo valor de venda" : ""}` : "30 %";
      const pp = campo(o, "proposta_partes");
      const linhas = [h("p", { class: "ajuda", id: "valores-pagamento", text: `Proposta ${euros(vp.proposta)} + IVA ${String(vp.iva_pct).replace(".", ",")} % (${euros(vp.iva)}) = ${euros(vp.total)} · sinal ${euros(vp.sinal)} (${sinalTxt} menos ${euros(desconto)} já pagos) · restante ${euros(vp.restante)}.` })];
      if (pp) linhas.push(h("p", { class: "ajuda", id: "valores-partes", text: `Mão de obra ${euros(pp.mao_obra)} · material ${euros(pp.material)} · deslocação ${euros(pp.deslocacao)} (sem IVA).` }));
      if (vp.minima != null) linhas.push(h("p", { class: "msg info", id: "obra-minima", text: `Obra mínima: ${euros(vp.minima)} com IVA. A proposta fica abaixo: cobra-se o mínimo${pp && pp.deslocacao > 0 ? " (mais a deslocação)" : ""} e o que o cliente pagou antes não é descontado.` }));
      if (vp.sinal_material) linhas.push(h("p", { class: "ajuda", id: "sinal-material", text: "O sinal cobre o material: é o maior entre 30 % do total e o custo do material." }));
      // Material (decisão 11): reservar já, se o cliente pediu para começar já; senão passados os 14 dias de livre resolução.
      const mr = campo(o, "material_reserva");
      if (mr) linhas.push(h("p", { class: "ajuda", id: "material-reserva", text: mr.ja ? `Material: reservar já${mr.inicio_imediato ? ` (o cliente pediu para começar já em ${data(mr.inicio_imediato)})` : ""}.` : `Reservar a partir de ${data(mr.a_partir, { hora: false })} (14 dias).` }));
      const st = campo(o, "stock");
      if (st?.artigos?.length) {
        const falta = st.artigos.filter((a) => a.disponivel < 0);
        linhas.push(h("p", { class: "ajuda", id: "stock-pedido", text: `Stock: ${st.saiu ? "o material já saiu do armazém" : st.reservado ? "material reservado" : "por reservar (com o sinal pago)"} — ${st.artigos.map((a) => `${a.qtd} × ${a.sku}`).join(", ")}.${falta.length ? ` Em falta: ${falta.map((a) => a.sku).join(", ")}.` : ""}` }));
      }
      out.unshift(...linhas);
    }
    if (arquivado) { /* sem ações: o pedido não muda */ }
    else if (campo(o, "estado") === "aceite" && !campo(o, "obra_concluida")) {
      acoes.push(h("button", { class: "btn sec pequeno", type: "button", id: "obra-concluida", text: "Marcar obra concluída",
        onclick: (e) => acao(e.currentTarget, "obra-concluida", "Obra concluída: o cliente pode pagar o restante na conta.") }));
    } else if (campo(o, "obra_concluida")) out.push(h("p", { class: "ajuda", text: `Obra concluída em ${data(campo(o, "obra_concluida"))}.` }));
    if (!pags.length && !out.length && !acoes.length) return [];
    const linhas = pags.map((x) => h("li", { dataset: { fase: campo(x, "fase"), estado: campo(x, "estado") } },
      h("strong", { text: `${txt(x, "fase_texto")}: ${euros(campo(x, "valor"))}` }),
      campo(x, "base") != null ? h("span", { class: "ajuda", text: ` (${euros(campo(x, "base"))} + IVA ${euros(campo(x, "iva"))})` }) : null, " ",
      selo(txt(x, "estado_texto"), campo(x, "estado") === "pago" ? "orc-aceite" : campo(x, "estado") === "pendente" ? "info" : "aviso"),
      campo(x, "devolvido") != null && campo(x, "estado") === "pago" ? selo(`${euros(campo(x, "devolvido"))} devolvidos`, "aviso") : null,
      campo(x, "a_devolver") != null ? selo(`Devolução por fazer: ${euros(campo(x, "a_devolver"))}`, "grav-critica") : null,
      campo(x, "nao_realizada") === true ? selo("Visita não realizada — não desconta", "aviso") : null,
      campo(x, "modo") === "simulado" ? selo("Simulado", "aviso") : null,
      h("span", { class: "ajuda", text: ` ${campo(x, "pago") ? `pago ${data(campo(x, "pago"))}` : `criado ${data(campo(x, "criado"))}`} · ${txt(x, "ref")}` })));
    return [h("section", { class: "pagamentos-pedido", id: "pagamentos-pedido" },
      h("h3", { text: "Pagamentos" }),
      pags.length ? h("ul", { class: "linhas-simples" }, ...linhas) : h("p", { class: "ajuda", text: "Sem pagamentos online (pedido antigo, de contacto ou registado no painel)." }),
      ...out, acoes.length ? h("div", { class: "form-botoes" }, ...acoes) : null)];
  }

  /**
   * Fase 3: a visita técnica — paga (ou pedida com a avaria) ou não; "Marcar visita" com o dia e a hora (o cliente vê-a
   * na conta e recebe um email), ao lado da disponibilidade que ele deu no simulador.
   */
  function blocoVisitaPainel(j, o, acao) {
    const cp = campo(o, "compras");
    const estado = campo(o, "estado");
    if (!cp || campo(o, "obra_id") || ["aceite", "perdido"].includes(estado)) return [];
    const sim = simulacaoDe(o);
    const disp = sim ? visitaTxt(sim) : null;
    const urg = sim ? urgenciaDe(sim) : null;
    const v = cp.visita ?? {};
    const quando = campo(o, "data_visita");
    const texto = v.paga ? (cp.avaria ? "Visita pedida com a avaria (paga)." : "Visita técnica paga pelo cliente.")
      : v.fora_area ? "Sem visita: fora da área servida." : `Visita técnica ainda não paga${v.valor != null ? ` (${euros(v.valor)})` : ""}.`;
    const partes = [h("p", { class: "ajuda", id: "visita-estado", text: `${texto}${quando ? ` Marcada para ${data(quando)}.` : ""}` })];
    if (disp || urg) partes.push(h("p", { class: "ajuda", id: "visita-disponibilidade", text: `Disponibilidade do cliente: ${disp ? disp.toLowerCase() : "não indicou"}${urg && urg !== "normal" ? ` · ${URGENCIAS[urg]}` : ""}.` }));
    // Decisão 10: cancelada pelo cliente com mais de 24 h → devolvida (ele fá-lo na conta); com menos, ou se faltar, a
    // visita fica paga: "Cliente faltou" regista a falta (sem devolução) e avisa o cliente.
    const faltou = campo(o, "visita_faltou");
    if (faltou) partes.push(h("p", { class: "msg info", id: "visita-faltou-texto", text: `Cliente faltou (registado ${data(faltou)}): a visita não é devolvida nem descontada no sinal. Para avançar, o cliente marca e paga uma visita nova.` }));
    else if (v.paga && quando && new Date(paraInput(quando)).getTime() <= Date.now()) {
      partes.push(h("div", { class: "form-botoes" }, h("button", { class: "btn sec pequeno", type: "button", id: "visita-faltou", text: "Cliente faltou",
        onclick: (e) => acao(e.currentTarget, "visita-faltou", "Falta registada: a visita fica paga e o cliente foi avisado.") })));
    }
    if (!v.paga && !quando) return partes;
    const entrada = h("input", { name: "data_visita_marcar", type: "datetime-local", "aria-label": "Dia e hora da visita", value: paraInput(quando) });
    const b = h("button", { class: "btn pequeno", type: "button", id: "marcar-visita", text: quando ? "Mudar a visita" : "Marcar visita",
      onclick: (e) => {
        if (!/T\d{2}:\d{2}/.test(entrada.value)) { avisar("Indique o dia e a hora da visita.", "erro"); entrada.focus(); return; }
        acao(e.currentTarget, "marcar-visita", "Visita marcada: o cliente vê-a na conta e recebe um email.", { data_visita: entrada.value });
      } });
    partes.push(h("div", { class: "form-botoes marcar-visita" }, entrada, b));
    return partes;
  }

  /** "Pré-visualizar versão do cliente": o relatório que a conta vai ver (GET orcamentos/:id/relatorio-cliente). */
  async function previaRelatorio(id, b) {
    b.disabled = true;
    let r;
    try { r = await pedir(`orcamentos/${encodeURIComponent(id)}/relatorio-cliente`); }
    catch (erro) { avisar(erro.message, "erro"); return; }
    finally { b.disabled = false; }
    const rel = campo(r, "relatorio");
    const j = janela("Relatório técnico — versão do cliente", { larga: true, aoFechar: () => b.focus() });
    if (!rel) { j.corpo.append(h("p", { class: "vazio", text: "Sem relatório para o cliente." })); return; }
    const tabela = (linhas) => h("div", { class: "tabela-rolar" }, h("table", { class: "tabela" },
      h("thead", {}, h("tr", {}, ...["Material", "Qtd.", "Preço", "Total"].map((t, i) => h("th", { scope: "col", class: i ? "num" : "", text: t })))),
      h("tbody", {}, ...linhas.map((l) => h("tr", {}, h("td", { text: txt(l, "artigo") }), h("td", { class: "num", text: String(campo(l, "quantidade")) }),
        h("td", { class: "num", text: campo(l, "preco_unitario") == null ? "—" : euros(campo(l, "preco_unitario")) }), h("td", { class: "num", text: campo(l, "total") == null ? "—" : euros(campo(l, "total")) }))))));
    const partes = [h("p", { class: "msg info", text: "É isto que o cliente vê na conta depois de \"Libertar relatório ao cliente\" (preços do catálogo, sem dados internos)." })];
    const a = campo(rel, "acoes") ?? {};
    const resumo = [["Reparar", a.reparar], ["Substituir", a.substituir], ["Novo", a.novo], ["Manter (fica como está)", a.manter]].filter(([, n]) => Number(n) > 0);
    if (resumo.length) partes.push(dados(resumo.map(([k, n]) => [k, `${n} ${n === 1 ? "aparelho" : "aparelhos"}`])));
    for (const d of lista(campo(rel, "divisoes") ?? [], "divisoes")) {
      partes.push(h("h3", { text: `${txt(d, "nome")} — ${euros(campo(d, "total"))}` }));
      const t = lista(campo(d, "trabalho") ?? [], "trabalho");
      if (t.length) partes.push(h("ul", { class: "linhas-simples" }, ...t.map((x) => h("li", { text: String(x) }))));
      const m = lista(campo(d, "material") ?? [], "material");
      if (m.length) partes.push(tabela(m));
    }
    const g = campo(rel, "geral");
    if (g && lista(campo(g, "material") ?? [], "material").length) partes.push(h("h3", { text: `${txt(g, "titulo")} — ${euros(campo(g, "total"))}` }), tabela(campo(g, "material")));
    // Fase 2: os pacotes aceites nas Melhorias — o material de cada um e a instalação e configuração deles.
    const mel = campo(rel, "melhorias");
    const pacotes = mel ? lista(campo(mel, "pacotes") ?? [], "pacotes") : [];
    if (pacotes.length) {
      partes.push(h("h3", { text: `${txt(mel, "titulo")} — ${euros(campo(mel, "total"))}` }));
      for (const p of pacotes) {
        partes.push(h("h4", { text: `${txt(p, "nome")} — ${euros(campo(p, "total"))}` }));
        const m = lista(campo(p, "material") ?? [], "material");
        if (m.length) partes.push(tabela(m));
      }
      partes.push(h("p", { text: `Instalação e configuração dos pacotes: ${euros(campo(mel, "instalacao"))}` }));
    }
    const mo = campo(rel, "mao_obra");
    if (mo) partes.push(h("p", { text: `Mão de obra${campo(mo, "horas") ? ` (cerca de ${String(campo(mo, "horas")).replace(".", ",")} h)` : ""}: ${euros(campo(mo, "valor"))}` }));
    if (campo(rel, "deslocacao") != null) partes.push(h("p", { text: `Deslocação: ${euros(campo(rel, "deslocacao"))}` }));
    partes.push(h("p", { class: "valor num", text: `Total estimado: ${euros(campo(rel, "total"))}` }), h("p", { class: "ajuda", text: txt(rel, "nota") }));
    // Só no pormenorizado: a planta técnica (simbologia normalizada), o esquema por luz, a terra e a lista de ensaios.
    const tecnica = h("div", { class: "relatorio-cliente-tecnico" }, ...seccaoTecnica(rel, { titulo: "h3", subtitulo: "h4" }));
    j.corpo.append(...partes, tecnica);
    // "Esquema do quadro elétrico" desenhado pelo eletricista (orcamentos.esquema_quadro): o cliente vê-o desenhado com
    // o vendor/quadro-desenho.js (cópia do simulador); se a cópia ainda não existir no painel, fica só o resumo.
    const eq = campo(rel, "esquema_quadro");
    if (eq && typeof eq === "object") {
      const q = h("div", { class: "rel-quadro" });
      const resumo = [eq.disjuntor_geral?.amperes ? `geral ${eq.disjuntor_geral.amperes} A` : null,
        Array.isArray(eq.diferenciais) ? `${eq.diferenciais.length} diferenciais` : null, Array.isArray(eq.disjuntores) ? `${eq.disjuntores.length} disjuntores` : null,
        Number.isFinite(Number(eq.modulos_livres)) ? `${eq.modulos_livres} módulos livres` : null].filter(Boolean).join(" · ");
      tecnica.append(h("h3", { text: "Esquema do quadro elétrico" }), h("p", { class: "ajuda", text: `Desenhado no painel pelo eletricista${resumo ? `: ${resumo}` : ""}.` }), q);
      import("../vendor/quadro-desenho.js").then((m) => {
        const svg = m.desenharQuadroCliente?.(eq, { resumo: "esquema do quadro elétrico" });
        if (!svg) return;
        svg.removeAttribute("id");
        for (const g of svg.querySelectorAll(".qd-item")) { g.removeAttribute("tabindex"); g.removeAttribute("role"); }
        q.replaceChildren(svg);
      }).catch(() => {});
    }
    // Diagnóstico da avaria (só no pormenorizado): o que foi verificado, o tipo e a conclusão, sem quem o fez.
    const dg = campo(rel, "diagnostico");
    const blocoDg = dg && typeof dg === "object" ? blocoDiagnostico(dg) : null;
    if (blocoDg) tecnica.append(h("h3", { text: "Diagnóstico da avaria" }), h("p", { class: "ajuda", text: "Feito pelo nosso eletricista na visita." }), blocoDg);
  }

  /**
   * Ensaios medidos na visita/obra (POST orcamentos/:id/ensaios): continuidade do PE, isolamento, terra e disparo do
   * diferencial, mais notas. O cliente vê-os na lista de ensaios do relatório completo; vazio = "a medir".
   */
  function formEnsaios(j, o) {
    const id = String(campo(o, "id"));
    const e = campo(o, "ensaios") ?? {};
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const entrada = (nome, rotulo, ajuda) => campoForm(rotulo, h("input", { name: nome, type: "number", min: "0", max: "1000000", step: "0.001", inputmode: "decimal", value: campo(e, nome) ?? "" }), ajuda);
    const f = h("form", { class: "form-grelha", id: "form-ensaios", novalidate: true },
      h("h3", { text: "Ensaios medidos" }),
      h("p", { class: "ajuda", text: "Valores medidos na visita ou no fim da obra (ordem RTIEBT 612.1). Aparecem na lista de ensaios do relatório completo do cliente; em branco = a medir." }),
      h("div", { class: "duas" },
        entrada("continuidade_pe", "Continuidade do PE (Ω)", "612.2: valor medido"),
        entrada("isolamento", "Isolamento (MΩ)", "612.3: ≥ referência, a 500 V DC")),
      h("div", { class: "duas" },
        entrada("terra", "Resistência de terra (Ω)", "801.5.6.1: ≤ referência"),
        entrada("diferencial", "Disparo do diferencial (ms)", "a IΔn; referência EN 61008/61009")),
      campoForm("Notas", h("textarea", { name: "notas", maxlength: "1000", rows: "2" }, campo(e, "notas") ?? "")),
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec", type: "submit", text: "Guardar ensaios" }),
        campo(e, "data") ? h("span", { class: "ajuda", text: `Registados ${data(campo(e, "data"))}.` }) : null),
      msg);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const el = f.elements;
      const corpo = { notas: el.notas.value.trim() || null };
      for (const k of ["continuidade_pe", "isolamento", "terra", "diferencial"]) {
        const v = el[k].value.trim();
        if (v === "") { corpo[k] = null; continue; }
        const n = numero(v);
        if (n === null || n < 0) { mensagem(msg, "Cada valor medido tem de ser um número igual ou maior que 0 (ou ficar em branco)."); el[k].focus(); return; }
        corpo[k] = n;
      }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/ensaios`, { corpo });
        const novo = campo(r, "orcamento") ?? r;
        substituir(novo);
        avisar("Ensaios guardados: o cliente vê-os no relatório completo.");
        if (ficha?.j === j) desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    return f;
  }

  /**
   * Ronda B (decisão do dono): "Esquema do quadro" — a foto do quadro do cliente ao lado do editor de calha DIN
   * (vendor/quadro-desenho.js): o geral, os diferenciais, os disjuntores e os módulos livres pela ordem da calha
   * (`ordem`); tocar num componente dá os amperes/mA e "Apagar"; tocar num módulo livre deixa pôr aí um disjuntor ou
   * diferencial; "+ Geral/Diferencial/Disjuntor" juntam no fim; "Módulos livres" − n +; estado e fusíveis. "Guardar
   * esquema" → POST orcamentos/:id/esquema-quadro (CEO e comercial). O cliente vê-o só no relatório completo.
   */
  function seccaoEsquemaQuadro(j, o, fotos, arquivado) {
    const id = String(campo(o, "id"));
    const guardado = campo(o, "esquema_quadro");
    const fotoQuadro = fotos.find((f) => campo(f, "chave") === "quadro") ?? null;
    const sec = h("section", { class: "esquema-quadro", id: "esquema-quadro" });
    sec.append(h("h3", { text: "Esquema do quadro" }),
      h("p", { class: "ajuda", text: "Desenhe o quadro do cliente a partir da foto: toque em + para juntar, num componente para mudar ou apagar, num módulo livre para pôr aí um disjuntor. O cliente vê o esquema no relatório completo." }));
    const foto = fotoQuadro
      ? h("figure", { class: "foto-cliente esquema-foto" }, h("a", { href: urlFoto(id, campo(fotoQuadro, "id")), target: "_blank", rel: "noopener", title: "Abrir a foto inteira" },
        h("img", { src: urlFoto(id, campo(fotoQuadro, "id")), alt: "Foto do quadro elétrico do cliente", loading: "lazy", decoding: "async" })), h("figcaption", { text: "Foto do quadro (cliente)" }))
      : h("p", { class: "ajuda esquema-foto", text: "O cliente ainda não enviou a foto do quadro." });
    if (arquivado) {
      const svg = guardado ? desenharQuadroCliente(normalizarEsquema(guardado), { soLeitura: true, resumo: resumoEsquema(guardado) }) : null;
      sec.append(h("div", { class: "esquema-quadro-grelha" }, foto, h("div", {}, svg ?? h("p", { class: "ajuda", text: "Sem esquema." }))));
      return sec;
    }
    // Estado do editor: o esquema em edição (normalizado a cada mudança), o componente tocado e se há mudanças por guardar.
    let l = normalizarEsquema(guardado) ?? esquemaVazio();
    let sel = null;
    let mudado = false;
    const desenhoCx = h("div", { class: "esquema-quadro-desenho" });
    const editarCx = h("div", { class: "esquema-quadro-editar" });
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const guardar = h("button", { class: "btn pequeno", type: "button", id: "esquema-guardar", text: "Guardar esquema" });
    const estadoTxt = h("span", { class: "ajuda", id: "esquema-estado", role: "status" });
    const focar = (idEl) => document.getElementById(idEl)?.focus({ preventScroll: true });
    const mudar = (fn) => { fn(l); l = normalizarEsquema(l); mudado = true; desenhar(); };
    const posDoLivre = (k) => { let n = 0; return l.ordem.findIndex((t) => t === "livre" && n++ === k); };
    const tirarDaOrdem = (tipo, i) => {
      l.ordem = l.ordem.filter((t) => t !== (tipo === "geral" ? "geral" : `${tipo}:${i}`)).map((t) => {
        const [tt, n] = t.split(":");
        return tt === tipo && Number(n) > i ? `${tipo}:${Number(n) - 1}` : t;
      });
    };
    /** Junta um componente (no fim da calha, ou no lugar `pos` de `ordem`) e devolve a seleção dele. */
    const juntar = (tipo, pos = null) => {
      let token = "geral";
      if (tipo === "diferencial") { l.diferenciais.push({ sensibilidade_ma: 30, amperes: 40 }); token = `diferencial:${l.diferenciais.length - 1}`; }
      else if (tipo === "disjuntor") { l.disjuntores.push({ amperes: 16 }); token = `disjuntor:${l.disjuntores.length - 1}`; }
      else l.disjuntor_geral = { amperes: null };
      if (pos === null || pos < 0) l.ordem.push(token); else l.ordem[pos] = token;
      return token === "geral" ? { tipo: "geral", i: 0 } : { tipo, i: Number(token.split(":")[1]) };
    };
    const botao = (texto, attrs, aoClicar) => h("button", { class: "btn sec pequeno", type: "button", ...attrs, onclick: aoClicar }, texto);
    const chips = (rotulo, nome, valores, atual, aoEscolher) => {
      const g = h("div", { class: "qd-chips", role: "group", "aria-label": rotulo });
      g.append(h("span", { class: "qd-chips-rotulo", text: rotulo }));
      for (const v of [...new Set([...valores, ...(atual ? [atual] : [])])].sort((a, b) => a - b)) {
        g.append(h("button", { class: "segmento qd-chip", type: "button", "aria-pressed": String(v === atual), dataset: { chip: `${nome}-${v}` }, text: String(v),
          onclick: () => { aoEscolher(v); document.querySelector(`[data-chip="${nome}-${v}"]`)?.focus({ preventScroll: true }); } }));
      }
      return g;
    };
    function desenhar() {
      const lista = (tipo) => (tipo === "diferencial" ? l.diferenciais : tipo === "disjuntor" ? l.disjuntores : null);
      if (sel && !(sel.tipo === "geral" ? l.disjuntor_geral : sel.tipo === "livre" ? posDoLivre(sel.i) >= 0 : lista(sel.tipo)?.[sel.i])) sel = null;
      desenhoCx.replaceChildren(desenharQuadroCliente(l, {
        selecionado: sel, resumo: resumoEsquema(l), vazio: "Toque em + para juntar.",
        aoTocar: (tipo, i) => { sel = sel?.tipo === tipo && sel.i === i ? null : { tipo, i }; desenhar(); focar("esquema-sel-titulo"); },
      }));
      editarCx.replaceChildren();
      if (sel?.tipo === "livre") {
        const k = sel.i;
        const caixa = h("div", { class: "qd-sel" }, h("p", { class: "qd-sel-titulo", id: "esquema-sel-titulo", tabindex: "-1", text: nomeComponente(l, "livre", k) }));
        const porAqui = (idB, texto, tipo, pode) => botao(texto, { id: idB, disabled: !pode, "aria-label": `${texto} (no lugar do módulo livre ${k + 1})` }, () => {
          let novo = null;
          mudar((x) => { novo = juntar(tipo, posDoLivre(k)); x.modulos_livres = Math.max(0, (x.modulos_livres ?? 1) - 1); });
          sel = novo; desenhar(); focar("esquema-sel-titulo");
        });
        caixa.append(h("div", { class: "form-botoes" },
          porAqui("esquema-aqui-disjuntor", "Pôr disjuntor aqui", "disjuntor", l.disjuntores.length < MAX_ESQUEMA.disjuntores),
          porAqui("esquema-aqui-diferencial", "Pôr diferencial aqui", "diferencial", l.diferenciais.length < MAX_ESQUEMA.diferenciais),
          botao("Apagar módulo livre", { class: "btn sec pequeno perigo", "aria-label": `Apagar: ${nomeComponente(l, "livre", k)}` }, () => {
            sel = null;
            mudar((x) => { x.ordem.splice(posDoLivre(k), 1); x.modulos_livres = Math.max(0, (x.modulos_livres ?? 1) - 1); });
            focar("esquema-livres-mais");
          }),
          botao("Feito", {}, () => { sel = null; desenhar(); desenhoCx.querySelector("svg")?.focus({ preventScroll: true }); })));
        editarCx.append(caixa);
      } else if (sel) {
        const { tipo, i } = sel;
        const alvo = () => (tipo === "geral" ? l.disjuntor_geral : lista(tipo)[i]);
        const caixa = h("div", { class: "qd-sel" }, h("p", { class: "qd-sel-titulo", id: "esquema-sel-titulo", tabindex: "-1", text: nomeComponente(l, tipo, i) }));
        if (tipo === "diferencial") caixa.append(chips("Sensibilidade (mA)", "ma", MA_DIFERENCIAL, alvo().sensibilidade_ma, (v) => mudar((x) => { x.diferenciais[i].sensibilidade_ma = v; })));
        const amperes = tipo === "geral" ? AMPERES_GERAL : tipo === "diferencial" ? AMPERES_DIFERENCIAL : AMPERES_DISJUNTOR;
        caixa.append(chips("Amperes (A)", "amperes", amperes, alvo().amperes, (v) => mudar((x) => { (tipo === "geral" ? x.disjuntor_geral : (tipo === "diferencial" ? x.diferenciais : x.disjuntores)[i]).amperes = v; })));
        caixa.append(h("div", { class: "form-botoes" },
          botao("Apagar", { class: "btn sec pequeno perigo", "aria-label": `Apagar: ${nomeComponente(l, tipo, i)}` }, () => {
            sel = null;
            mudar((x) => { if (tipo === "geral") x.disjuntor_geral = null; else (tipo === "diferencial" ? x.diferenciais : x.disjuntores).splice(i, 1); tirarDaOrdem(tipo, i); });
            focar("esquema-mais-disjuntor");
          }),
          botao("Feito", {}, () => { sel = null; desenhar(); desenhoCx.querySelector("svg")?.focus({ preventScroll: true }); })));
        editarCx.append(caixa);
      }
      // Juntar no fim da calha (depois dos módulos livres): o novo fica logo tocado.
      const mais = (idB, texto, tipo, pode) => botao(texto, { id: idB, disabled: !pode }, () => { let novo = null; mudar(() => { novo = juntar(tipo); }); sel = novo; desenhar(); focar("esquema-sel-titulo"); });
      editarCx.append(h("div", { class: "form-botoes qd-mais" },
        l.disjuntor_geral ? null : mais("esquema-mais-geral", "+ Geral", "geral", true),
        mais("esquema-mais-diferencial", "+ Diferencial", "diferencial", l.diferenciais.length < MAX_ESQUEMA.diferenciais),
        mais("esquema-mais-disjuntor", "+ Disjuntor", "disjuntor", l.disjuntores.length < MAX_ESQUEMA.disjuntores)));
      // Módulos livres: "+" junta um no fim da calha, "−" tira o último.
      const n = l.modulos_livres;
      const botaoN = (sinal, rot, dd) => h("button", { class: "segmento", type: "button", id: `esquema-livres-${dd > 0 ? "mais" : "menos"}`, "aria-label": rot, text: sinal,
        disabled: dd < 0 ? !n : (n ?? 0) >= MAX_ESQUEMA.modulos_livres,
        onclick: () => {
          mudar((x) => {
            x.modulos_livres = Math.max(0, Math.min(MAX_ESQUEMA.modulos_livres, (x.modulos_livres ?? 0) + dd));
            if (dd > 0) x.ordem.push("livre"); else if (x.ordem.lastIndexOf("livre") >= 0) x.ordem.splice(x.ordem.lastIndexOf("livre"), 1);
          });
          const mesmo = document.getElementById(`esquema-livres-${dd > 0 ? "mais" : "menos"}`);
          (mesmo && !mesmo.disabled ? mesmo : document.getElementById(`esquema-livres-${dd > 0 ? "menos" : "mais"}`))?.focus();
        } });
      editarCx.append(h("div", { class: "qd-livres-linha" }, h("span", { text: "Módulos livres" }),
        h("div", { class: "segmentos", role: "group", "aria-label": "Módulos livres" }, botaoN("−", "Menos um módulo livre", -1), h("output", { class: "qd-livres-valor num", "aria-live": "polite", text: n === null ? "?" : String(n) }), botaoN("+", "Mais um módulo livre", 1))));
      const estados = h("div", { class: "qd-chips", role: "group", "aria-label": "Estado do quadro" }, h("span", { class: "qd-chips-rotulo", text: "Estado do quadro" }));
      for (const [k, t] of Object.entries(ESTADOS_QUADRO).filter(([k]) => k !== "nao_se_ve")) {
        estados.append(h("button", { class: "segmento qd-chip", type: "button", "aria-pressed": String(l.estado === k), dataset: { chip: `estado-${k}` }, text: t,
          onclick: () => { mudar((x) => { x.estado = x.estado === k ? null : k; }); document.querySelector(`[data-chip="estado-${k}"]`)?.focus({ preventScroll: true }); } }));
      }
      editarCx.append(estados);
      editarCx.append(h("label", { class: "qd-fusiveis" }, h("input", { type: "checkbox", name: "esquema_fusiveis", checked: l.fusiveis === true, onchange: (ev) => { const sim = ev.currentTarget.checked; mudar((x) => { x.fusiveis = sim; }); document.querySelector("input[name=esquema_fusiveis]")?.focus({ preventScroll: true }); } }), " Tem fusíveis (em vez de disjuntores)"));
      const notas = h("textarea", { name: "esquema_notas", maxlength: String(MAX_ESQUEMA.notas), rows: "2", "aria-label": "Notas do esquema", placeholder: "Notas (marca, o que confirmar na visita…)" }, l.notas ?? "");
      notas.addEventListener("input", () => { l.notas = notas.value; mudado = true; estadoTxt.textContent = "Mudanças por guardar."; });
      editarCx.append(notas);
      estadoTxt.textContent = mudado ? "Mudanças por guardar." : guardado?.data ? `Guardado ${data(guardado.data)}${guardado.por ? ` por ${guardado.por}` : ""}.` : "";
    }
    guardar.addEventListener("click", async () => {
      guardar.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/esquema-quadro`, { corpo: { esquema: normalizarEsquema(l) } });
        const novo = campo(r, "orcamento") ?? r;
        substituir(novo, false);
        avisar("Esquema do quadro guardado: o cliente vê-o no relatório completo.");
        if (ficha?.j === j) { desenharFicha(j, novo); document.getElementById("esquema-guardar")?.focus({ preventScroll: true }); }
      } catch (erro) { guardar.disabled = false; mensagem(msg, erro.message); }
    });
    desenhar();
    // "Preencher a partir da foto" (decisão do dono, 2026-10-04): o rascunho do esquema pela leitura automática da foto
    // do quadro (`leitura_quadro`; se ainda não há leitura, pede-a agora: POST orcamentos/:id/ler-quadro). Nada fica
    // guardado até "Guardar esquema"; a leitura conta os componentes mas não sabe a ordem na calha.
    let lq = campo(o, "leitura_quadro") ?? null;
    let preencher = null;
    if (fotoQuadro && lq && campo(lq, "estado") !== "desligada") {
      const CONF = { alta: "alta", media: "média", baixa: "baixa" };
      const rotulo = () => (esquemaTemAlgo(l) ? "Substituir pelo que a IA lê na foto" : "Preencher a partir da foto");
      const b = botao(rotulo(), { id: "esquema-da-foto" }, async () => {
        mensagem(msg, null);
        if (campo(lq, "estado") !== "feita") {
          b.disabled = true; b.textContent = "A ler a foto… (alguns segundos)";
          try {
            const r = await pedir(`orcamentos/${encodeURIComponent(id)}/ler-quadro`, { corpo: {} });
            const novo = campo(r, "orcamento") ?? r;
            substituir(novo, false);
            lq = campo(novo, "leitura_quadro") ?? null;
          } catch (erro) { mensagem(msg, erro.message); }
          b.disabled = false; b.textContent = rotulo();
          if (campo(lq, "estado") !== "feita") { if (msg.hidden) mensagem(msg, `A leitura automática da foto falhou${campo(lq, "erro") ? ` (${campo(lq, "erro")})` : ""}. Desenhe o quadro à mão ou tente outra vez.`); return; }
        }
        const daFoto = esquemaDaLeitura(campo(lq, "leitura"));
        if (!daFoto) { mensagem(msg, "A leitura automática não reconheceu um quadro elétrico nesta foto. Desenhe-o à mão."); return; }
        l = daFoto; sel = null; mudado = true; desenhar();
        b.textContent = rotulo();
        const c = campo(campo(lq, "leitura"), "confianca");
        avisar(`Rascunho feito pela leitura automática da foto (confiança ${CONF[c] ?? c}). Confira com a foto, corrija e guarde.`);
      });
      preencher = h("div", { class: "form-botoes" }, b, h("span", { class: "ajuda", text: "Rascunho feito por inteligência artificial: conta os componentes, não a ordem na calha. Confira sempre com a foto." }));
    }
    if (preencher) sec.append(preencher);
    sec.append(h("div", { class: "esquema-quadro-grelha" }, foto, h("div", { class: "esquema-quadro-editor" }, desenhoCx, editarCx)),
      h("div", { class: "form-botoes" }, guardar, estadoTxt), msg);
    return sec;
  }

  /**
   * Diagnóstico de avarias (decisão do dono; docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): o que o cliente escolheu no
   * passo Avaria → tipos de avaria prováveis e primeiras verificações (diagnostico-conteudo.js PROBLEMAS); a lista de
   * verificação que o eletricista assinala (com a medição opcional), o tipo de avaria encontrado e "Conclusão / causa
   * encontrada". "Guardar diagnóstico" → POST orcamentos/:id/diagnostico (CEO e comercial); tudo em branco apaga.
   */
  function seccaoDiagnostico(j, o, sim, arquivado) {
    const id = String(campo(o, "id"));
    const d = campo(o, "diagnostico") ?? null;
    const sec = h("section", { class: "diagnostico-pedido", id: "diagnostico-pedido" });
    sec.append(h("h3", { text: "Diagnóstico" }),
      h("p", { class: "ajuda" }, "Lista de verificação da avaria, com as medições e a causa encontrada. O guia completo está em ",
        h("a", { href: "#/ajuda/diagnostico", text: "Ajuda técnica → Diagnóstico de avarias" }), ". O cliente vê o resultado só no relatório completo."));
    const problemas = sim && sim.avaria && typeof sim.avaria === "object" ? sim.avaria.problema : null;
    const sug = sugestoesPara(Array.isArray(problemas) ? problemas : problemas ? [problemas] : []);
    const quadroAvaria = sim && sim.quadro && typeof sim.quadro.avaria === "string" ? sim.quadro.avaria.trim() : null;
    sec.append(h("h4", { text: "O que o cliente descreveu" }),
      sug.length || quadroAvaria !== null
        ? h("ul", { class: "diag-sugestoes", id: "diag-sugestoes" }, ...sug.map((s) => h("li", {}, h("strong", { text: `${s.nome} → ${s.tiposNome.join(" ou ") || "a apurar"}: ` }), s.verificar)),
          quadroAvaria !== null ? h("li", {}, h("strong", { text: `Quadro com problemas${quadroAvaria ? ` («${quadroAvaria}»)` : ""} → sobrecarga, curto-circuito ou ligação solta: ` }), PROBLEMAS.disjuntor.verificar) : null)
        : h("p", { class: "ajuda", id: "diag-sugestoes", text: `Reparações sem problema tipificado. ${PROBLEMAS.outro.verificar}` }));
    if (o && typeof o === "object" && "ia" in o) sec.append(seccaoIa(j, o, "diagnostico", arquivado));
    if (arquivado) { sec.append(blocoDiagnostico(d) ?? h("p", { class: "ajuda", text: "Sem diagnóstico registado." })); return sec; }
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const valores = d && d.valores && typeof d.valores === "object" ? d.valores : {};
    const feitas = Array.isArray(d?.verificacoes) ? d.verificacoes : [];
    const linhas = CHECKLIST.map((c) => h("li", { class: c.valor ? "com-valor" : "" },
      h("label", { class: "caixa" }, h("input", { type: "checkbox", name: `diag_${c.chave}`, checked: feitas.includes(c.chave) }), h("span", {}, c.nome, c.referencia ? h("span", { class: "ajuda bloco-ajuda", text: c.referencia }) : null)),
      c.valor ? h("label", { class: "diag-valor" }, h("span", { class: "ajuda", text: `Medido (${c.valor.unidade})` }),
        h("input", { name: `diag_valor_${c.chave}`, type: "number", min: "0", max: String(c.valor.max), step: c.valor.casas ? String(1 / 10 ** c.valor.casas) : "1", inputmode: "decimal", value: valores[c.chave] ?? "", "aria-label": `${c.nome}: valor medido (${c.valor.unidade})` })) : null));
    const sTipo = escolha("diag_tipo", { "": "Ainda não apurado", ...NOME_TIPO }, d?.tipo ?? "");
    const f = h("form", { class: "form-grelha", id: "form-diagnostico", novalidate: true },
      h("h4", { text: "Lista de verificação" }),
      h("ul", { class: "diag-lista" }, ...linhas),
      h("div", { class: "duas" },
        campoForm("Tipo de avaria encontrado", sTipo),
        campoForm("Conclusão / causa encontrada", h("textarea", { name: "diag_conclusao", maxlength: String(MAX_CONCLUSAO), rows: "3", placeholder: "O que se encontrou, o que se fez, o que falta." }, d?.conclusao ?? ""))),
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec", type: "submit", id: "diagnostico-guardar", text: "Guardar diagnóstico" }),
        h("span", { class: "ajuda", id: "diagnostico-estado", role: "status", text: d?.data ? `Registado ${data(d.data)}${d.por ? ` por ${d.por}` : ""}.` : "" })),
      msg);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const el = f.elements;
      const corpo = { verificacoes: [], valores: {}, tipo: el.diag_tipo.value || null, conclusao: el.diag_conclusao.value.trim() || null };
      for (const c of CHECKLIST) {
        if (el[`diag_${c.chave}`].checked) corpo.verificacoes.push(c.chave);
        if (!c.valor) continue;
        const v = el[`diag_valor_${c.chave}`].value.trim();
        if (v === "") continue;
        const n = numero(v);
        if (n === null || n < 0 || n > c.valor.max) { mensagem(msg, `${c.nome}: o valor medido tem de ser um número entre 0 e ${c.valor.max} ${c.valor.unidade} (ou ficar em branco).`); el[`diag_valor_${c.chave}`].focus(); return; }
        corpo.valores[c.chave] = n;
      }
      const vazio = !corpo.verificacoes.length && !Object.keys(corpo.valores).length && !corpo.tipo && !corpo.conclusao;
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/diagnostico`, { corpo: { diagnostico: vazio ? null : corpo } });
        const novo = campo(r, "orcamento") ?? r;
        substituir(novo, false);
        avisar(vazio ? "Diagnóstico apagado." : "Diagnóstico guardado: aparece no relatório técnico e no relatório completo do cliente.");
        if (ficha?.j === j) { desenharFicha(j, novo); document.getElementById("diagnostico-guardar")?.focus({ preventScroll: true }); }
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    sec.append(f);
    return sec;
  }

  /**
   * Assistente (IA; decisão do dono, docs/ASSISTENTE-IA.md): "Resumir pedido" no topo da ficha e "Sugerir diagnóstico" na
   * secção Diagnóstico → POST orcamentos/:id/ia/resumo|diagnostico. Só corre ao carregar no botão; o resultado é só para
   * a equipa (o cliente nunca o vê) e a sugestão não preenche o diagnóstico do pedido.
   */
  function seccaoIa(j, o, tipo, arquivado) {
    const id = String(campo(o, "id"));
    const ia = campo(o, "ia") ?? {};
    const r = ia[tipo] ?? null;
    const T = IA_TEXTOS[tipo];
    const sec = h("section", { class: "ia-pedido", id: `ia-${tipo}` }, h(tipo === "resumo" ? "h3" : "h4", { text: T.titulo }));
    const itens = (titulo, l) => (Array.isArray(l) && l.length ? [h("p", {}, h("strong", { text: titulo })), h("ul", { class: "diag-sugestoes" }, ...l.map((t) => h("li", { text: String(t) })))] : []);
    if (r && tipo === "resumo") {
      sec.append(h("p", { class: "mensagem-cliente", text: String(r.resumo ?? "") }),
        ...itens("O que o cliente quer", r.quer), ...itens("Atenção", r.atencao), ...itens("A perguntar ou confirmar", r.perguntas));
    } else if (r) {
      sec.append(h("ul", { class: "diag-sugestoes" }, ...(Array.isArray(r.causas) ? r.causas : []).map((c) => h("li", {},
          h("strong", { text: `${c.causa} (probabilidade ${IA_NIVEL[c.probabilidade] ?? c.probabilidade}): ` }), `${c.porque} `, h("em", { text: `Verificar: ${c.verificar}` })))),
        ...itens("A medir", r.medicoes), ...itens("Material a levar", r.material), ...itens("Segurança", r.seguranca),
        h("p", { class: "ajuda", text: `Confiança da sugestão: ${IA_NIVEL[r.confianca] ?? r.confianca}.${r.nota ? ` ${r.nota}` : ""}` }));
    }
    if (r) sec.append(h("p", { class: "ajuda", text: `${T.aviso} Pedido em ${data(r.data)}${r.por ? ` por ${r.por}` : ""}.` }));
    if (arquivado) return sec;
    if (ia.ligado !== true) {
      if (ctx.pode("ceo")) sec.append(h("p", { class: "ajuda", text: "Assistente desligado: o servidor não tem a chave ANTHROPIC_API_KEY." }));
      else if (!r) sec.hidden = true;
      return sec;
    }
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const b = h("button", { class: "btn sec pequeno", type: "button", id: `ia-${tipo}-pedir`, text: r ? T.outraVez : T.botao });
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "A pensar… (pode demorar um minuto)"; mensagem(msg, null);
      try {
        const novo = await pedir(`orcamentos/${encodeURIComponent(id)}/ia/${tipo}`, { corpo: {} });
        const completo = campo(novo, "orcamento") ?? novo;
        substituir(completo, false);
        if (ficha?.j === j) { desenharFicha(j, completo); document.getElementById(`ia-${tipo}`)?.scrollIntoView({ block: "nearest" }); }
      } catch (erro) { b.disabled = false; b.textContent = r ? T.outraVez : T.botao; mensagem(msg, erro.message); }
    });
    if (!r) sec.append(h("p", { class: "ajuda", text: T.ajuda }));
    sec.append(h("div", { class: "form-botoes" }, b), msg);
    return sec;
  }

  /** "Cancelar obra e devolver sinal" (CEO): o valor a devolver (por omissão o sinal todo) e o motivo; pede confirmação. */
  function formDevolverSinal(j, o, sinal) {
    const id = String(campo(o, "id"));
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const f = h("form", { class: "form-grelha", id: "form-devolver-sinal", novalidate: true },
      h("h3", { text: "Cancelar obra e devolver sinal" }),
      h("p", { class: "ajuda", text: "Antes de a obra ser feita. O pedido fica perdido, a obra cancelada e o material reservado é libertado. Cartão e MB Way: devolução automática; Multibanco: por transferência (o cliente indica o IBAN na conta)." }),
      h("div", { class: "duas" },
        campoForm("Valor a devolver (€)", h("input", { name: "valor", type: "number", min: "0.01", max: String(campo(sinal, "valor")), step: "0.01", inputmode: "decimal", required: true, value: String(campo(sinal, "valor")) }), "O sinal menos o material já encomendado e os serviços prestados."),
        campoForm("Motivo", h("input", { name: "motivo", maxlength: "300", placeholder: "Ex.: o cliente desistiu" }))),
      h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "confirmo" }), "Confirmo: cancelar a obra e devolver este valor"),
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec", type: "submit", text: "Cancelar obra e devolver sinal" })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const valor = numero(el.valor.value);
      if (valor === null || valor <= 0 || valor > Number(campo(sinal, "valor"))) { mensagem(msg, `O valor tem de estar entre 0,01 € e ${euros(campo(sinal, "valor"))}.`); el.valor.focus(); return; }
      if (!el.confirmo.checked) { mensagem(msg, "Marque a caixa para confirmar."); el.confirmo.focus(); return; }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/devolver-sinal`, { corpo: { valor, ...(el.motivo.value.trim() ? { motivo: el.motivo.value.trim() } : {}) } });
        const novo = campo(r, "orcamento") ?? r;
        substituir(novo);
        avisar("Obra cancelada e sinal devolvido.");
        desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    return f;
  }

  function formConverter(j, o) {
    const id = String(campo(o, "id"));
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    // A obra já existe desde o sinal: "Ligar casa" só pede o código do cliente e os aparelhos (a data, o kit e os
    // técnicos tratam-se na obra). Sem obra (pedidos aceites antes disto) é o formulário completo, como antes.
    const temObra = campo(o, "obra") && typeof campo(o, "obra") === "object";
    const acao = temObra ? "Ligar casa" : "Converter em cliente e obra";
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 7);
    // Com visita marcada, a obra começa por omissão no dia da visita (pode ser mudada).
    const diaVisita = paraInput(campo(o, "data_visita")).slice(0, 10);
    const sim = simulacaoDe(o);
    const sugeridos = sim ? aparelhosDaSimulacao(sim, catalogoDe(o)) : [];
    const listaAparelhos = sugeridos.length ? checklistAparelhos(sugeridos) : null;
    // Horas da simulação do cliente (se houver) em vez das do kit; podem ser alteradas.
    const horasSim = sim ? numero(campo(sim.mao_obra ?? {}, "horas")) : null;
    const campoHoras = horasSim !== null && horasSim > 0
      ? campoForm("Horas estimadas", h("input", { name: "horas_estimadas", type: "number", min: "0", max: "500", step: "0.05", inputmode: "decimal", required: true, value: String(horasSim) }), "Da simulação do cliente (em vez das horas do kit)")
      : null;
    const f = h("form", { class: "form-grelha converter", id: "form-converter", novalidate: true },
      h("h3", { text: acao }),
      h("p", { class: "ajuda", text: temObra ? "Pede ao servidor a conta do cliente (app e mensalidade) e os aparelhos. A obra já existe: fica ligada a este cliente." : "Pede ao servidor a conta do cliente e agenda a obra de instalação." }),
      temObra ? campoForm("Código do cliente", h("input", { name: "codigo", required: true, maxlength: "32", autocapitalize: "none", spellcheck: "false", value: sugerirCodigo(campo(o, "nome") ?? "") }))
        : h("div", { class: "duas" },
          campoForm("Código do cliente", h("input", { name: "codigo", required: true, maxlength: "32", autocapitalize: "none", spellcheck: "false", value: sugerirCodigo(campo(o, "nome") ?? "") })),
          campoForm("Kit", escolha("kit", Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, `${v.nome} (${v.horas} h)`])), "conforto"))),
      temObra ? null : campoForm("Data da obra", h("input", { name: "data", type: "date", required: true, value: diaVisita || isoDia(amanha) }), diaVisita ? "Dia da visita (pode mudar)." : null),
      temObra ? null : campoHoras,
      listaAparelhos,
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: acao })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const corpo = temObra ? { codigo: el.codigo.value.trim() } : { codigo: el.codigo.value.trim(), kit: el.kit.value, data: el.data.value };
      if (!RE_CODIGO.test(corpo.codigo)) { mensagem(msg, "Código inválido: 1 a 32 letras minúsculas, números e '-' (sem '-' no início ou no fim)."); el.codigo.focus(); return; }
      if (!temObra && !corpo.data) { mensagem(msg, "Escolha a data da obra."); el.data.focus(); return; }
      if (campoHoras && !temObra) {
        const horas = numero(el.horas_estimadas.value);
        if (horas === null || horas < 0 || horas > 500) { mensagem(msg, "As horas estimadas têm de ser um número entre 0 e 500."); el.horas_estimadas.focus(); return; }
        corpo.horas_estimadas = horas;
      }
      if (listaAparelhos) {
        const r = lerAparelhos(listaAparelhos);
        if (r.erro) { mensagem(msg, r.erro); r.campo?.focus(); return; }
        if (r.aparelhos.length) corpo.aparelhos = r.aparelhos;
      }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/converter`, { corpo });
        const senha = palavraPasse(r);
        if (senha) mostrarPalavraPasse(`Cliente ${corpo.codigo}: feito`, senha, { utilizador: corpo.codigo });
        else if (idPedido(r)) ctx.acompanharPedido(idPedido(r), { descricao: `Cliente ${corpo.codigo}`, utilizador: corpo.codigo });
        // Aparelhos pedidos na conversão: cada um tem a sua palavra-passe (mostrada uma vez, quando o servidor os criar).
        lista(campo(r, "aparelhos") ?? [], "aparelhos").forEach((p, i) => {
          const a = corpo.aparelhos?.[i];
          const idP = idPedido({ pedido: p });
          if (idP && a) ctx.acompanharPedido(idP, { descricao: `Aparelho ${a.id} de ${corpo.codigo}`, utilizador: `${corpo.codigo}-${a.id}` });
        });
        const obraR = campo(r, "obra", "obra_id");
        const novo = { ...o, ...(campo(r, "orcamento") ?? {}), estado: "aceite", cliente: campo(r, "cliente") ?? corpo.codigo, obra_id: (obraR && typeof obraR === "object" ? campo(obraR, "id") : obraR) ?? campo(o, "obra_id") };
        substituir(novo);
        const nAp = corpo.aparelhos?.length ?? 0;
        avisar((temObra ? `Casa ligada: ${campo(r, "cliente_existia") === true ? `cliente ${corpo.codigo} (já existia).` : `pedido de cliente ${corpo.codigo} enviado.`}`
          : campo(r, "cliente_existia") === true ? `Obra agendada para o cliente ${corpo.codigo} (já existia).` : `Pedido de cliente ${corpo.codigo} enviado e obra agendada.`)
          + (nAp ? ` ${nAp} ${nAp === 1 ? "aparelho pedido" : "aparelhos pedidos"} ao servidor.` : ""));
        desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    return f;
  }

  function substituir(novo, redesenhar = true) {
    // Um arquivado (RGPD) nunca entra na lista normal (nem no quadro): só na dos arquivados, se já foi carregada.
    if (campo(novo, "estado") === "arquivado") {
      const k = arquivados?.findIndex((x) => String(campo(x, "id")) === String(campo(novo, "id"))) ?? -1;
      if (k >= 0) arquivados[k] = { ...arquivados[k], ...novo };
      if (redesenhar) desenhar();
      return;
    }
    const i = todos.findIndex((x) => String(campo(x, "id")) === String(campo(novo, "id")));
    if (i >= 0) todos[i] = { ...todos[i], ...novo }; else todos.push(novo);
    if (redesenhar) desenhar();
  }

  // ---------- Relatório técnico (para o eletricista; imprimir / guardar PDF) ----------
  let relatorio = null;
  const tituloAntes = document.title;
  function abrirRelatorio(id) {
    if (relatorio?.id === id) return;
    fecharRelatorio();
    const volta = h("a", { class: "btn sec pequeno", href: `#/orcamentos/${encodeURIComponent(id)}`, text: "Voltar ao pedido" });
    const imprimir = h("button", { class: "btn pequeno", type: "button", id: "imprimir-relatorio", text: "Imprimir / guardar PDF", disabled: true, onclick: () => window.print() });
    const corpo = h("div", {}, carregando());
    const caixa = h("div", { class: "relatorio-zona" }, h("div", { class: "ecra-topo nao-imprimir" }, h("h1", { text: "Relatório técnico" }), h("div", { class: "form-botoes" }, volta, imprimir)), corpo);
    relatorio = { id, caixa };
    el.classList.add("com-relatorio");
    el.append(caixa);
    pedir(`orcamentos/${encodeURIComponent(id)}`, { sinal: ctrl.signal }).then((r) => {
      if (relatorio?.caixa !== caixa) return;
      const o = campo(r, "orcamento") ?? r;
      const sim = simulacaoDe(o);
      if (!sim) { corpo.replaceChildren(h("p", { class: "vazio", text: "Este pedido não tem simulação: não há relatório técnico." })); return; }
      corpo.replaceChildren(relatorioTecnico({
        id: campo(o, "id"), nome: campo(o, "nome"), telefone: campo(o, "telefone"), email: campo(o, "email"),
        localidade: campo(o, "localidade"), criado: campo(o, "criado", "criado_em"), data_visita: campo(o, "data_visita"),
      }, sim, catalogoDe(o), { fotos: lista(campo(o, "fotos") ?? [], "fotos"), leitura: campo(o, "leitura_quadro"), esquema: campo(o, "esquema_quadro"), diagnostico: campo(o, "diagnostico") }));
      // O título dá o nome ao PDF guardado pelo browser.
      document.title = `Relatório técnico — ${txt(o, "nome")} (pedido ${campo(o, "id")})`;
      imprimir.disabled = false;
    }).catch((e) => {
      if (e.name === "AbortError" || relatorio?.caixa !== caixa) return;
      corpo.replaceChildren(e.estado === 404 ? h("p", { class: "vazio", text: "Pedido não encontrado." }) : erroEcra(e, () => { fecharRelatorio(); abrirRelatorio(id); }));
    });
    caixa.querySelector("h1").setAttribute("tabindex", "-1");
    caixa.querySelector("h1").focus();
  }
  function fecharRelatorio() {
    if (!relatorio) return;
    relatorio.caixa.remove();
    relatorio = null;
    el.classList.remove("com-relatorio");
    document.title = tituloAntes;
  }

  const esperarLista = carregar();
  const api = {
    rota(resto) {
      if (resto[0] && resto[1] === "relatorio") { ficha?.j.fechar(); ficha = null; abrirRelatorio(resto[0]); return; }
      fecharRelatorio();
      if (resto[0]) abrirFicha(resto[0]); else { ficha?.j.fechar(); ficha = null; }
    },
    desmontar: () => { ctrl.abort(); fecharRelatorio(); },
  };
  api.rota(ctx.resto);
  return api;
}

const PLANOS_NOME = { base: "Base", conforto: "Conforto", premium: "Premium" };
const ACOES = {
  orcamento_recebido: "Pedido recebido", orcamento_criado: "Pedido registado", orcamento_atualizado: "Atualizado",
  orcamento_convertido: "Convertido em cliente e obra", obra_criada: "Obra criada", foto_apagada: "Foto apagada",
  proposta_aceite_cliente: "Proposta aceite pelo cliente (online)", foto_cliente: "Foto enviada pelo cliente (conta)",
  proposta_aceite_aguarda_sinal: "Aceite pelo cliente — a aguardar o sinal", pagamento_criado: "Pagamento criado",
  orcamento_anonimizado_rgpd: "Anonimizado (RGPD): a conta foi apagada; os pagamentos ficam",
  pagamento_confirmado: "Pagamento recebido", pagamento_falhado: "Pagamento falhado", pagamento_cancelado: "Pagamento cancelado",
  pagamento_expirado: "Pagamento expirado", pagamento_simulado: "Pagamento simulado (página de teste)",
  relatorio_libertado: "Relatório libertado ao cliente", obra_concluida: "Obra concluída", visita_marcada: "Visita marcada",
  visita_cancelada_cliente: "Visita cancelada pelo cliente (devolvida)", visita_faltou: "Cliente faltou à visita (sem devolução)",
  sinal_devolvido: "Obra cancelada: sinal devolvido", devolucao_iban: "O cliente indicou o IBAN da devolução", devolucao_feita: "Devolução por transferência feita",
  inicio_imediato: "Cliente: \"Quero que comecem já\"",
  ensaios_registados: "Ensaios medidos registados", esquema_quadro_atualizado: "Esquema do quadro atualizado", diagnostico_atualizado: "Diagnóstico atualizado", ia_resumo: "Resumo pedido ao assistente (IA)", ia_diagnostico: "Sugestão de diagnóstico pedida ao assistente (IA)",
};
const IA_NIVEL = { alta: "alta", media: "média", baixa: "baixa" };
const IA_TEXTOS = {
  resumo: { titulo: "Resumo do pedido (IA)", botao: "Resumir pedido", outraVez: "Atualizar resumo",
    ajuda: "Um resumo do pedido feito por inteligência artificial. Ao modelo vão só os dados técnicos: sem nome, contactos nem morada.",
    aviso: "Feito por inteligência artificial: confirme no pedido antes de decidir. O cliente não vê isto." },
  diagnostico: { titulo: "Sugestão da IA — por confirmar no local", botao: "Sugerir diagnóstico", outraVez: "Pedir outra sugestão",
    ajuda: "Causas prováveis, o que medir e o material a levar, a partir do que o cliente descreveu. Não preenche o diagnóstico abaixo.",
    aviso: "Hipótese de trabalho feita por inteligência artificial: confirme com medições antes de mexer. Não entra no diagnóstico nem no relatório do cliente." },
};

/** O pedido precisa da secção "Diagnóstico": avaria rápida, serviço de reparações, aparelhos a reparar ou quadro com problemas. */
export const precisaDiagnostico = (sim) => !!sim && (ehAvaria(sim) || servicosDe(sim).includes("reparar")
  || Number(sim.totais_acao?.reparar?.aparelhos) > 0 || (sim.quadro && typeof sim.quadro === "object" && typeof sim.quadro.avaria === "string"));
/** Conta de cliente do pedido ({email, confirmado, ativo} ou null) em texto. */
function textoConta(c) {
  if (!c || typeof c !== "object") return "Sem conta (pedido de contacto ou antigo)";
  return `${c.email} · email ${c.confirmado ? "confirmado" : "por confirmar"}${c.ativo === false ? " · conta desativada" : ""}`;
}
/** Nome legível de uma foto pela chave ("quadro" ou "divisao:tipo"), com os dados da simulação se os houver. */
function nomeFotoChave(chave, sim) {
  if (chave === "quadro") return "Quadro elétrico";
  const m = (Array.isArray(sim?.fotos) ? sim.fotos : []).find((f) => f && f.chave === chave) ?? {};
  if (/^conta[a-z0-9]*:/.test(chave)) return ["Foto acrescentada na conta", m.legenda].filter(Boolean).join(" · ");
  const [divisao, tipo] = chave.split(":");
  const s = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return [nomeTipoFoto(s(m.tipo) ?? tipo), s(m.divisao_nome) ?? divisao, s(m.legenda)].filter(Boolean).join(" · ");
}
/** Uma linha do histórico: {texto} ou {acao, detalhes} (registo de auditoria). `sim`: simulação do pedido (nomes das fotos). */
function textoHistorico(x, sim) {
  const t = campo(x, "texto", "descricao");
  if (t) return String(t);
  const acao = String(campo(x, "acao") ?? "");
  const d = campo(x, "detalhes");
  const partes = [ACOES[acao] ?? (acao.replace(/_/g, " ") || "—")];
  if (d && typeof d === "object") {
    if (acao === "foto_apagada" && typeof d.chave === "string" && d.chave) partes[0] = `Foto apagada: ${nomeFotoChave(d.chave, sim)}`;
    if (d.estado) partes.push(`estado: ${NOMES_ESTADO_ORC[d.estado] ?? d.estado}`);
    if (d.data_visita) partes.push(`visita: ${data(d.data_visita)}`);
    if (d.valor_proposta != null) partes.push(`proposta: ${euros(d.valor_proposta)}`);
    if (d.cliente) partes.push(`cliente: ${d.cliente}`);
    if (d.fase) partes.push({ relatorio: "19 € (relatório e visita)", sinal: "sinal", restante: "restante", relatorio_pormenorizado: "relatório completo", visita: "visita técnica", pormenorizado_visita: "relatório e visita", avaria: "diagnóstico da avaria" }[d.fase] ?? d.fase);
    if (d.valor != null) partes.push(euros(d.valor));
    if (d.sinal != null) partes.push(`sinal: ${euros(d.sinal)}`);
    if (typeof d.devolvido === "number") partes.push(`devolvido: ${euros(d.devolvido)}`);
    if (acao === "inicio_imediato" && d.quer === false) partes[0] = "Cliente: já não quer começar já";
    if (d.modo === "simulado" || d.resultado) partes.push(d.resultado ? `simulado: ${d.resultado}` : "simulado");
  }
  return partes.join(" · ");
}

/** Simulação do cliente (objeto; o servidor pode guardá-la como texto JSON). */
/** Lote 8: a urgência do pedido — da lista (`urgencia`, calculada no servidor) ou da simulação completa. */
export const urgenciaPedido = (o) => campo(o, "urgencia") ?? urgenciaDe(simulacaoDe(o));

export function simulacaoDe(o) {
  let s = campo(o, "simulacao");
  if (typeof s === "string") { try { s = JSON.parse(s); } catch { return null; } }
  return s && typeof s === "object" ? s : null;
}

/** Artigos do catálogo referidos na simulação ({SKU: {nome, categoria, ativo, …}}; GET orcamentos/:id → catalogo). */
export function catalogoDe(o) {
  const c = campo(o, "catalogo", "artigos");
  return c && typeof c === "object" && !Array.isArray(c) ? c : {};
}

// ---------- Aparelhos sugeridos (converter) ----------
const TIPOS_APARELHO = { openbeken: "OpenBeken", shelly: "Shelly" };
/** Lista editável dos aparelhos sugeridos: cada linha pode ser desmarcada e alterada antes de converter. */
function checklistAparelhos(sugeridos) {
  const linhas = sugeridos.map((a, i) => {
    const incluir = h("input", { type: "checkbox", name: "incluir", checked: true });
    const campos = h("div", { class: "aparelho-campos" },
      campoForm("Id", h("input", { name: "id", value: a.id, maxlength: "32", autocapitalize: "none", spellcheck: "false" })),
      campoForm("Nome", h("input", { name: "nome", value: a.nome, maxlength: "60" })),
      campoForm("Tipo", escolha("tipo", TIPOS_APARELHO, a.tipo)),
      campoForm("Divisão", h("input", { name: "divisao", value: a.divisao, maxlength: "40" })),
      h("div", { class: "aparelho-canais" }, campoForm("Canais", h("input", { name: "canais", value: a.canais, maxlength: "1000", autocapitalize: "none", spellcheck: "false" }))),
      h("div", { class: "caixas" },
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "medidor", checked: a.medidor }), "Medidor"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "geral", checked: !!a.geral }), "Medidor geral da casa"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "bateria", checked: a.bateria }), "A pilhas")));
    const li = h("li", { class: "aparelho-sug", dataset: { i: String(i) } },
      h("label", { class: "caixa aparelho-incluir" }, incluir, h("span", {}, h("strong", { class: "aparelho-nome", text: a.nome }), h("span", { class: "ajuda bloco-ajuda", text: a.origem || "" }))),
      campos);
    const nomeTxt = li.querySelector(".aparelho-nome");
    campos.querySelector("input[name=nome]").addEventListener("input", (e) => { nomeTxt.textContent = e.target.value || "(sem nome)"; });
    incluir.addEventListener("change", () => { campos.hidden = !incluir.checked; li.classList.toggle("excluido", !incluir.checked); contar(); });
    return li;
  });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const caixa = h("fieldset", { class: "grupo aparelhos-sugeridos", id: "aparelhos-sugeridos" },
    h("legend", { text: "Aparelhos a pedir ao servidor" }),
    h("p", { class: "ajuda", text: "Sugeridos a partir da simulação do cliente (domus.sh aparelho). Desmarque os que não vai instalar e corrija o que for preciso: os pedidos são feitos por esta ordem, depois do cliente." }),
    contagem, h("ol", { class: "lista-aparelhos" }, ...linhas));
  function contar() {
    const n = linhas.filter((l) => l.querySelector("input[name=incluir]").checked).length;
    contagem.textContent = `${n} de ${linhas.length} ${linhas.length === 1 ? "aparelho" : "aparelhos"} a pedir.`;
  }
  contar();
  return caixa;
}
const RE_NOME_AP = /^[^"\\-][^"\\]*$/;
const RE_CANAIS = /^[1-9]\d?:[a-z]+(:[^,:"\\]*)*(,[1-9]\d?:[a-z]+(:[^,:"\\]*)*)*$/;
const RE_DIVISAO = /^[^"\\:,-][^"\\:,]*$/;
/** Aparelhos marcados → corpo de "aparelhos" (as mesmas regras do servidor), ou {erro, campo}. */
function lerAparelhos(caixa) {
  const out = [];
  const ids = new Set();
  for (const li of caixa.querySelectorAll(".aparelho-sug")) {
    if (!li.querySelector("input[name=incluir]").checked) continue;
    const c = (n) => li.querySelector(`[name=${n}]`);
    const id = c("id").value.trim(), nome = c("nome").value.trim(), canais = c("canais").value.trim(), divisao = c("divisao").value.trim();
    const quem = nome || id || "aparelho";
    if (!RE_CODIGO.test(id)) return { erro: `${quem}: id inválido (1 a 32 letras minúsculas, números e '-').`, campo: c("id") };
    if (ids.has(id)) return { erro: `O id "${id}" está repetido.`, campo: c("id") };
    ids.add(id);
    if (!nome || nome.length > 60 || !RE_NOME_AP.test(nome)) return { erro: `${quem}: nome em falta ou inválido (sem aspas nem "\\", sem "-" no início).`, campo: c("nome") };
    if (canais && !RE_CANAIS.test(canais)) return { erro: `${quem}: canais no formato "n:funcao[:nome][:opção]", separados por vírgulas.`, campo: c("canais") };
    if (divisao && (!RE_DIVISAO.test(divisao) || new TextEncoder().encode(divisao).length > 40)) return { erro: `${quem}: divisão sem aspas, ":" ou "," (máx. 40 bytes).`, campo: c("divisao") };
    const a = { id, tipo: c("tipo").value, nome };
    if (canais) a.canais = canais;
    if (divisao) a.divisao = divisao;
    a.medidor = c("medidor").checked;
    if (c("geral").checked) {
      // O servidor só aceita "geral" com medidor e sem pilhas (domus.sh --medidor --geral).
      if (!a.medidor) return { erro: `${quem}: "Medidor geral da casa" só com "Medidor".`, campo: c("geral") };
      a.geral = true;
    }
    a.bateria = c("bateria").checked;
    out.push(a);
  }
  return { aparelhos: out };
}
