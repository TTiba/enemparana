/* Painel ENEM 2021–2025 — Wayground · variante Paraná (pr2) -----------------
 * Diferenças vs. web/app.js:
 *   - LOCK_UF = "PR" (fixo, sem dropdown de UF)
 *   - state.rede default = "PUB"
 *   - nivelChave() começa em UF/PR (não BR)
 *   - state.nre entra na Fase B (dropdown NRE + cascata)
 */

const AREA_INFO = {
  LC:  { nome: "Linguagens",  cor: "var(--lilac)" },
  CH:  { nome: "Humanas",     cor: "var(--peach)" },
  CN:  { nome: "Natureza",    cor: "var(--mint)"  },
  MT:  { nome: "Matemática",  cor: "var(--lime)"  },
};
const NIVEL_NOME = { BR: "Brasil", UF: "Estado", NRE: "NRE", MUN: "Município", ESC: "Escola" };
const ANOS = [2021, 2022, 2023, 2024, 2025];
const ANO_LATEST = 2025;
const LOCK_UF = window.LOCK_UF || "PR";
const LOCK_UF_NOME = window.LOCK_UF_NOME || "Paraná";

const $ = (s) => document.querySelector(s);
const fmt = (v, d = 1) =>
  v == null ? "–" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (v) => (v == null ? "–" : Number(v).toLocaleString("pt-BR"));

const state = {
  uf: LOCK_UF, nre: "", mun: "", esc: "", area: "MT", rede: "PUB", ano: ANO_LATEST,
  comp_modo: "atual",   // "atual" | "evolucao"
  comp_filtro: null,    // número da competência ativa como filtro da tabela (1..9)
};
const REDE_NOME = { PUB: "rede pública" };  // só existe essa opção agora

/* -------- Sincronização state ↔ URL ↔ localStorage -------------------------
 * Filtros globais (uf/mun/esc/rede) usam Filtros.carregar/salvar pra persistir
 * entre páginas via localStorage. Preferências locais (area/ano) ficam só na URL. */
function readStateFromURL() {
  const globais = window.Filtros ? window.Filtros.carregar() : {};
  state.uf   = LOCK_UF;
  state.nre  = globais.nre  || state.nre;
  state.mun  = globais.mun  || state.mun;
  state.esc  = globais.esc  || state.esc;
  state.rede = globais.rede || state.rede;
  const p = new URLSearchParams(location.search);
  if (p.get("area") && ["LC","CH","CN","MT"].includes(p.get("area"))) state.area = p.get("area");
  if (p.get("ano")) {
    const a = parseInt(p.get("ano"), 10);
    if (ANOS.includes(a)) state.ano = a;
  }
}
function writeStateToURL() {
  const p = new URLSearchParams();
  if (state.nre)  p.set("nre", state.nre);
  if (state.mun)  p.set("mun", state.mun);
  if (state.esc)  p.set("esc", state.esc);
  if (state.rede !== "PUB") p.set("rede", state.rede);
  if (state.area !== "MT")  p.set("area", state.area);
  if (state.ano !== ANO_LATEST) p.set("ano", state.ano);
  const qs = p.toString();
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  if (window.Filtros) window.Filtros.salvar({
    nre: state.nre, mun: state.mun, esc: state.esc, rede: state.rede,
  });
}

function nivelChave() {
  if (state.esc) return { nivel: "ESC", chave: state.esc };
  if (state.mun) return { nivel: "MUN", chave: state.mun };
  if (state.nre) return { nivel: "NRE", chave: state.nre };
  return { nivel: "UF",  chave: LOCK_UF };
}

/* Estático: JSONs pré-gerados por pipeline/exporta_netlify.py. */
const cacheEntidade = {};
const cacheHistorico = {};
const cacheRefs = {};
let historicoBrCache = null;

/* Mapas NRE ↔ municípios (carregados no boot de data/nre_*.json) */
let NRE_TO_MUNS = {};   // { "APUCARANA": ["4100103", ...], ... }
let MUN_TO_NRE = {};    // { "4100103": "APUCARANA", ... }
let NRE_AGG = null;     // { por_rede:{T,PUB,PRIV}, refs:{...} }
let NRE_HIST = null;    // { por_rede: { T|PUB|PRIV: { nre: [{ano, media_geral,...}] } } }
let MUNS_ALL = [];      // lista canônica dos 399 municípios do PR

async function api(rota, params = {}) {
  const rede = state.rede || "PUB";
  if (!window.API_STATIC) {
    const qs = new URLSearchParams({ rede, ...params }).toString();
    const r = await fetch(`/api/${rota}?${qs}`);
    return r.json();
  }
  const j = (u) => fetch(u).then((r) => (r.ok ? r.json() : null));

  /* NRE: agregado local do nre_agg.json (sem itens item-a-item) --------- */
  if (rota === "resumo" && params.nivel === "NRE") {
    const cel = NRE_AGG?.por_rede?.[rede]?.celulas?.[params.chave];
    if (!cel) return { erro: "sem dados nesta rede" };
    const alvo = {
      nivel: "NRE", chave: params.chave,
      nome: `NRE ${params.chave}`,
      uf: LOCK_UF, ...cel,
    };
    const uf = NRE_AGG.refs?.[rede]?.[LOCK_UF];
    const br = NRE_AGG.refs?.[rede]?.["BR"];
    const contexto = [uf, br].filter(Boolean).map((r) => ({
      nivel: r.nivel, chave: r.chave, nome: r.nome, uf: r.uf, ...r,
    }));
    const hist_resumo = NRE_HIST?.por_rede?.[rede]?.[params.chave] || [];
    return { alvo, contexto, hist_resumo };
  }
  if (rota === "itens" && params.nivel === "NRE") {
    return await agregarItensNRE(params.chave, params.area, params.ano || ANO_LATEST, rede);
  }

  if (rota === "ufs")        return (await j("api/ufs.json"))[rede] || [];
  if (rota === "municipios")
    return (await j(`api/municipios/${params.uf}.json`))?.[rede] || [];
  if (rota === "escolas") {
    const lst = (await j(`api/escolas/${params.municipio}.json`)) || [];
    if (rede === "T") return lst;
    return lst.filter((e) =>
      rede === "PRIV" ? e.dependencia === 4 : e.dependencia !== 4);
  }
  if (rota === "historico_br") {
    // usado pelo lineChart de evolução — carregado uma vez.
    if (!historicoBrCache) {
      historicoBrCache = j("api/entidade/BR/BR.json").then((d) =>
        d?.[rede]?.hist_resumo || []);
    }
    return historicoBrCache;
  }
  const k = `${params.nivel}/${params.chave}`;
  if (!cacheEntidade[k]) cacheEntidade[k] = j(`api/entidade/${k}.json`);
  const ent = await cacheEntidade[k];
  if (!ent) return { erro: "não encontrado" };
  const ehEscola = params.nivel === "ESC";
  const ramo = ehEscola ? ent : ent[rede];
  if (!ramo) return rota === "resumo" ? { erro: "sem dados nesta rede" } : [];

  if (rota === "resumo") {
    if (ehEscola) {
      return {
        alvo: ent.resumo.alvo,
        contexto: ent.resumo.contexto_por_rede?.[rede] || [],
        hist_resumo: ent.hist_resumo || [],
        hist_scope: ent.hist_scope || null,
      };
    }
    return {
      ...ramo.resumo,
      hist_resumo: ramo.hist_resumo || [],
    };
  }
  if (rota === "itens") {
    const ano = params.ano || ANO_LATEST;
    const alvo = ehEscola ? ent.resumo.alvo : ramo.resumo.alvo;
    const uf = alvo.uf || alvo.escola?.uf || null;

    if (ano === ANO_LATEST) {
      // caminho rápido — ano corrente já vem em ent
      const refsDe = async (chave) => {
        if (!cacheRefs[chave]) cacheRefs[chave] = j(`api/refs/${chave}.json`);
        return (await cacheRefs[chave])?.[rede] || {};
      };
      const [ru, rb] = await Promise.all(
        [uf ? refsDe(uf) : {}, refsDe("BR")]);
      const brutos = ehEscola ? ent.itens : ramo.itens;
      return (brutos[params.area] || []).map(
        ([item, n, p, p_esp, hab, b, lingua]) => ({
          item, n, p, p_esp, habilidade_inep: hab, param_b: b,
          tp_lingua: lingua,
          p_uf: ru[item] ?? null, p_br: rb[item] ?? null,
        }));
    }

    // outro ano → historico/{nivel}/{chave}.json + refs_hist/{ano}/…
    if (ehEscola) return [];    // escola: histórico item-a-item não emitido
    if (!cacheHistorico[k]) {
      cacheHistorico[k] = j(`api/historico/${k}.json`);
    }
    const hist = await cacheHistorico[k];
    if (!hist || !hist[rede]) return [];
    const bloco = hist[rede];
    const rows = (bloco.por_ano?.[ano]?.[params.area]) || [];
    // refs históricos vêm de api/refs_hist/{ano}/{BR|UF/uf}.json (por rede)
    const refKey = (ch) => `${ano}/${ch}`;
    const refsDeAno = async (isBr) => {
      const path = isBr
        ? `api/refs_hist/${ano}/BR.json`
        : `api/refs_hist/${ano}/UF/${uf}.json`;
      const chave = isBr ? refKey("BR") : refKey("UF-" + uf);
      if (!cacheRefs[chave]) cacheRefs[chave] = j(path);
      return (await cacheRefs[chave])?.[rede] || {};
    };
    const [ru, rb] = await Promise.all([
      params.nivel === "MUN" && uf ? refsDeAno(false) : {},
      refsDeAno(true),
    ]);
    return rows.map(([item, n, p, p_esp, hab, b, lingua]) => ({
      item, n, p, p_esp, habilidade_inep: hab, param_b: b,
      tp_lingua: lingua,
      p_uf: ru[item] ?? null, p_br: rb[item] ?? null,
    }));
  }
}

/* ---------- agregação de itens no nível NRE (client-side) ---------------- */
/* Agrega 7-tuplas [item, n, p, p_esp, hab, b, lingua] dos municípios do NRE.
 * Fonte: entidade/MUN/{cd}.json (ano corrente) ou historico/MUN/{cd}.json.
 * Pondera p e p_esp por n; item metadata (hab, b, lingua) reaproveita a
 * primeira ocorrência. */
const cacheItensNRE = {};  // "{nre}/{area}/{ano}/{rede}" → Promise
async function agregarItensNRE(nre, area, ano, rede) {
  const k = `${nre}/${area}/${ano}/${rede}`;
  if (cacheItensNRE[k]) return cacheItensNRE[k];
  cacheItensNRE[k] = (async () => {
    const cds = NRE_TO_MUNS[nre] || [];
    if (!cds.length) return [];
    const j = (u) => fetch(u).then((r) => (r.ok ? r.json() : null));
    // itens por município
    const listas = await Promise.all(cds.map(async (cd) => {
      if (ano === ANO_LATEST) {
        const ent = await j(`api/entidade/MUN/${cd}.json`);
        return ent?.[rede]?.itens?.[area] || [];
      }
      const hist = await j(`api/historico/MUN/${cd}.json`);
      return hist?.[rede]?.por_ano?.[ano]?.[area] || [];
    }));
    // agrega por CO_ITEM
    const agg = new Map();
    for (const rows of listas) {
      for (const [item, n, p, pEsp, hab, b, lingua] of rows) {
        if (!n) continue;
        const cur = agg.get(item) || { n: 0, sp: 0, nP: 0, sEsp: 0, nEsp: 0,
                                         hab, b, lingua };
        cur.n += n;
        // p e p_esp têm denominadores próprios: um município pode trazer n>0
        // com p null (ou vice-versa), e dividir pelo n total subestimaria.
        if (p != null) { cur.sp += p * n; cur.nP += n; }
        if (pEsp != null) { cur.sEsp += pEsp * n; cur.nEsp += n; }
        agg.set(item, cur);
      }
    }
    // refs UF/BR (pra colunas Δ Brasil, acerto BR/UF)
    const [refUf, refBr] = await Promise.all([
      ano === ANO_LATEST
        ? j(`api/refs/${LOCK_UF}.json`)
        : j(`api/refs_hist/${ano}/UF/${LOCK_UF}.json`),
      ano === ANO_LATEST
        ? j(`api/refs/BR.json`)
        : j(`api/refs_hist/${ano}/BR.json`),
    ]);
    const ru = refUf?.[rede] || {};
    const rb = refBr?.[rede] || {};
    return [...agg.entries()].map(([item, r]) => ({
      item, n: r.n,
      p: r.nP ? r.sp / r.nP : null,
      p_esp: r.nEsp ? r.sEsp / r.nEsp : null,
      habilidade_inep: r.hab, param_b: r.b, tp_lingua: r.lingua,
      p_uf: ru[item] ?? null, p_br: rb[item] ?? null,
    }));
  })();
  return cacheItensNRE[k];
}

/* ---------- seletores ---------------------------------------------------- */
function fillSelect(sel, itens, placeholder, valor, rotulo) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    itens.map((i) => `<option value="${i[valor]}">${i[rotulo]}</option>`).join("");
  sel.disabled = itens.length === 0;
}

async function initNREsMunicipios() {
  const j = (u) => fetch(u).then((r) => (r.ok ? r.json() : null));
  [NRE_AGG, NRE_TO_MUNS, NRE_HIST] = await Promise.all([
    j("data/nre_agg.json"),
    j("data/nre_to_muns.json"),
    j("data/nre_hist_resumo.json"),
  ]);
  for (const [nre, cds] of Object.entries(NRE_TO_MUNS)) {
    cds.forEach((cd) => (MUN_TO_NRE[String(cd)] = nre));
  }
  MUNS_ALL = await api("municipios", { uf: LOCK_UF });

  const nres = Object.keys(NRE_TO_MUNS).sort();
  $("#sel-nre").innerHTML =
    `<option value="">Todos (PR inteiro)</option>` +
    nres.map((n) => `<option value="${n}">${n}</option>`).join("");

  const munsIniciais = state.nre ? municipiosDoNRE(state.nre) : MUNS_ALL;
  fillSelect($("#sel-mun"), munsIniciais, "Todos os municípios", "chave", "nome");
  if (state.nre) $("#sel-nre").value = state.nre;
}

function municipiosDoNRE(nre) {
  const cds = new Set((NRE_TO_MUNS[nre] || []).map(String));
  return MUNS_ALL.filter((m) => cds.has(String(m.chave)));
}

$("#sel-nre").addEventListener("change", (e) => {
  state.nre = e.target.value;
  state.mun = ""; state.esc = "";
  const muns = state.nre ? municipiosDoNRE(state.nre) : MUNS_ALL;
  fillSelect($("#sel-mun"), muns, "Todos os municípios", "chave", "nome");
  setEscolas([]);
  refresh();
});

$("#sel-mun").addEventListener("change", async (e) => {
  state.mun = e.target.value; state.esc = "";
  if (state.mun) {
    const escs = await api("escolas", { municipio: state.mun });
    setEscolas(escs.map((x) => ({
      chave: x.chave,
      rotulo: `${x.rotulo}`,
      n: x.n_participantes,
      busca: `${x.rotulo} ${x.chave}`.toLowerCase(),
    })));
  } else {
    setEscolas([]);
  }
  refresh();
});

/* ---------- combobox de escolas ------------------------------------------ */
let escolasMun = [];
const inpEsc = $("#inp-esc");
const comboList = $("#combo-list");

function setEscolas(lista) {
  escolasMun = lista;
  inpEsc.value = "";
  inpEsc.disabled = lista.length === 0;
  inpEsc.placeholder = lista.length
    ? `Digite para buscar entre ${lista.length} escolas…` : "Digite para buscar…";
  comboList.hidden = true;
}

function renderCombo(filtro) {
  const q = filtro.trim().toLowerCase();
  const achadas = escolasMun.filter((e) => e.busca.includes(q)).slice(0, 50);
  comboList.innerHTML = achadas.length
    ? achadas.map((e) =>
        `<button type="button" data-chave="${e.chave}">
           <span>${e.rotulo}</span><small>${fmtInt(e.n)} alunos</small>
         </button>`).join("")
    : `<div class="combo-vazio">Nenhuma escola encontrada</div>`;
  comboList.hidden = false;
}

inpEsc.addEventListener("input", () => {
  if (inpEsc.value === "" && state.esc) { state.esc = ""; refresh(); }
  renderCombo(inpEsc.value);
});
inpEsc.addEventListener("focus", () => { if (escolasMun.length) renderCombo(inpEsc.value); });
document.addEventListener("click", (e) => {
  if (!e.target.closest(".combo")) comboList.hidden = true;
});
comboList.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.esc = b.dataset.chave;
  inpEsc.value = escolasMun.find((x) => x.chave == state.esc)?.rotulo || "";
  comboList.hidden = true;
  refresh();
});

// Sem handler de troca de rede: só "Pública" existe (decisão de retirar as
// escolas particulares do painel — ver ESTADO.md). O botão que sobrou em
// #tabs-rede não tem listener porque não há nada pra alternar.

$("#btn-limpar").addEventListener("click", () => {
  state.nre = state.mun = state.esc = "";
  $("#sel-mun").value = "";
  setEscolas([]);
  refresh();
});

/* ---------- render: cabeçalho + KPIs ------------------------------------- */
function serieHist(hist, campo) {
  return ANOS.map((a) => {
    const r = hist.find((x) => x.ano === a);
    return r ? r[campo] : null;
  });
}

function kpiCard(sigla, alvo, ctx, hist) {
  const campo = sigla === "GERAL" ? "media_geral"
                                  : `media_${sigla.toLowerCase()}`;
  const info = sigla === "GERAL"
    ? { nome: "Média geral", cor: "var(--pink)" } : AREA_INFO[sigla];
  const val = alvo[campo];
  const ref = ctx.length ? ctx[ctx.length - 1][campo] : null;
  let cmp = "";
  if (ref != null && val != null) {
    const d = val - ref;
    const cls = d >= 0 ? "up" : "down";
    cmp = `<span class="${cls}">${d >= 0 ? "+" : ""}${fmt(d)}</span> vs Brasil`;
  }
  const serie = hist && hist.length ? serieHist(hist, campo) : null;
  const sparkHtml = serie && serie.filter((v) => v != null).length >= 2
    ? window.Charts.sparkline(serie, { cor: info.cor, anos: ANOS })
    : "";
  return `<div class="kpi">
    <div class="kpi-top" style="background:${info.cor}">${info.nome}</div>
    <div class="kpi-body">
      <div class="kpi-num">${fmt(val)}</div>
      <div class="kpi-cmp">${cmp}</div>
      ${sparkHtml ? `<div class="kpi-spark" title="2021–2025">${sparkHtml}</div>` : ""}
    </div></div>`;
}

async function renderEvolucao(hist, alvoNome, nivel) {
  const bloco = $("#evolucao");
  const body = $("#evolucao-body");
  const nota = $("#evolucao-nota");
  bloco.hidden = false;
  nota.hidden = true;

  if (!hist || hist.length < 2) {
    body.innerHTML = "";
    bloco.hidden = true;
    return;
  }

  // séries: geral do alvo (linha destaque) e — se não for BR — geral do BR.
  const series = [
    { nome: alvoNome, cor: "var(--pink)",
      valores: serieHist(hist, "media_geral") },
  ];
  if (nivel !== "BR") {
    const histBr = await api("historico_br");
    if (histBr && histBr.length) {
      series.push({
        nome: "Média geral", cor: "var(--pink)", estilo: "brasil",
        valores: serieHist(histBr, "media_geral"),
      });
    }
  }
  // adiciona linhas por área — só do alvo, pra não poluir demais
  const areasSeries = ["LC", "CH", "CN", "MT"].map((sigla) => ({
    nome: AREA_INFO[sigla].nome, cor: AREA_INFO[sigla].cor,
    valores: serieHist(hist, `media_${sigla.toLowerCase()}`),
  }));

  body.innerHTML = window.Charts.lineChart(
    [...series, ...areasSeries],
    { xLabels: ANOS });

  // aviso se histórico da entidade é parcial (ex.: escola só 2024-2025)
  const anosPresentes = hist.map((x) => x.ano);
  if (anosPresentes.length < ANOS.length) {
    const min = Math.min(...anosPresentes);
    if (min > ANOS[0]) {
      nota.textContent = "Antes de " + min +
        " o INEP não expunha o código INEP nesta granularidade, portanto o histórico começa em " + min + ".";
      nota.hidden = false;
    }
  }
}

function renderResumo(data) {
  const { alvo, contexto, hist_resumo } = data;
  $("#ent-nome").textContent = alvo.nome;
  $("#ent-chip").textContent = NIVEL_NOME[alvo.nivel];

  // "Presentes" = quem fez a prova. n_lc = 1º dia; n_mt = 2º dia. Se n_participantes
  // (inscritos) > n_lc, mostra os dois pra ficar claro que houve ausentes.
  const nLC = alvo.n_lc, nMT = alvo.n_mt, nInscritos = alvo.n_participantes;
  const temPresenca = nLC != null && nMT != null;
  let meta;
  if (temPresenca) {
    meta = `${fmtInt(nLC)} fizeram o 1º dia · ${fmtInt(nMT)} fizeram o 2º dia`;
    if (nInscritos && nInscritos > nLC) {
      meta += ` (de ${fmtInt(nInscritos)} inscritos)`;
    }
  } else {
    meta = `${fmtInt(nInscritos)} concluintes participantes em 2025`;
  }
  if (state.rede !== "T" && !alvo.escola) meta += ` · ${REDE_NOME[state.rede]}`;
  if (alvo.escola) {
    const e = alvo.escola;
    meta += ` · ${e.dependencia_nome || ""} · ${e.municipio}/${e.uf} · código INEP ${e.chave}`;
  } else if (alvo.nivel === "MUN") {
    meta += ` · ${alvo.uf}`;
  }
  $("#ent-meta").textContent = meta;

  $("#kpis").innerHTML =
    ["GERAL", "LC", "CH", "CN", "MT"]
      .map((s) => kpiCard(s, alvo, contexto, hist_resumo)).join("");

  const linhas = [alvo, ...contexto];
  $("#areas-comp").innerHTML = ["LC", "CH", "CN", "MT"].map((s) => {
    const campo = `media_${s.toLowerCase()}`;
    const info = AREA_INFO[s];
    const rows = linhas.map((l, ix) => barRow(
      nomeCurto(l), l[campo], 1000,
      ix === 0 ? info.cor : "var(--ink-12)",
      fmt(l[campo], 0)
    )).join("");
    return `<div class="grp"><span class="dot" style="background:${info.cor}"></span>
            ${info.nome}</div>${rows}`;
  }).join("");

  renderEvolucao(hist_resumo, alvo.nome, alvo.nivel);

  // seletor de ano da tabela de itens: só tem sentido em BR/UF/MUN
  // (a UI de escola ainda mostra a prova de 2025 pra a escola específica).
  const ehEscola = alvo.nivel === "ESC";
  document.querySelectorAll("#tabs-ano button").forEach((b) => {
    const ano = parseInt(b.dataset.ano, 10);
    b.disabled = ehEscola && ano !== ANO_LATEST;
  });
  if (ehEscola && state.ano !== ANO_LATEST) {
    state.ano = ANO_LATEST;
    document.querySelectorAll("#tabs-ano button").forEach((x) => x.classList.remove("on"));
    document.querySelector('#tabs-ano button[data-ano="2025"]').classList.add("on");
  }
}

function nomeCurto(l) {
  if (l.nivel === "ESC") return `<span title="${l.nome}">Escola</span>`;
  if (l.nivel === "MUN") return l.nome.length > 16 ? l.nome.slice(0, 15) + "…" : l.nome;
  return l.nome;
}

function barRow(lbl, val, max, cor, valTxt) {
  const w = val == null ? 0 : Math.min(100, (val / max) * 100);
  return `<div class="bar-row">
    <div class="lbl">${lbl}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${cor}"></div></div>
    <div class="bar-val">${valTxt}</div></div>`;
}

/* ---------- render: itens ------------------------------------------------- */
function classifB(b) {
  if (b == null) return ["", "–"];
  if (b < 0)   return ["b-facil", fmt(b)];
  if (b < 1.2) return ["b-media", fmt(b)];
  return ["b-dificil", fmt(b)];
}

/* Em LC, H5-H8 aparecem como 2 itens por versão (inglês + espanhol). Do
 * ponto de vista da matriz é 1 item da mesma habilidade em 2 idiomas —
 * fundimos as duas versões pra não duplicar visualmente, agregando por
 * média ponderada em n. */
function fundirLEM(rows) {
  const lem = new Map();  // habilidade → array of rows (versões)
  const outros = [];
  for (const r of rows) {
    if (r.tp_lingua === 0 || r.tp_lingua === 1) {
      const arr = lem.get(r.habilidade_inep) || [];
      arr.push(r);
      lem.set(r.habilidade_inep, arr);
    } else {
      outros.push(r);
    }
  }
  const fundidos = [];
  for (const [hab, vers] of lem.entries()) {
    if (vers.length === 1) { fundidos.push(vers[0]); continue; }
    const nTot = vers.reduce((s, x) => s + (x.n || 0), 0) || 1;
    // Atenção: p_uf e p_br também são ponderados pelo n DA SELEÇÃO, não pelo
    // n da UF/Brasil. Ou seja, a referência é padronizada pelo mix
    // inglês/espanhol da seleção — é o que se quer (compara a seleção com uma
    // UF/BR hipotética que tivesse a mesma proporção de idiomas, isolando o
    // efeito de composição), mas não é a média bruta da UF/BR.
    const wavg = (campo) => {
      const num = vers.reduce((s, x) => s + (x[campo] != null ? x[campo] * (x.n || 0) : 0), 0);
      const den = vers.reduce((s, x) => s + (x[campo] != null ? (x.n || 0) : 0), 0);
      return den ? num / den : null;
    };
    fundidos.push({
      item: vers.map((x) => x.item).join("·"),
      n: nTot,
      p: wavg("p"),
      p_esp: wavg("p_esp"),
      p_uf: wavg("p_uf"),
      p_br: wavg("p_br"),
      habilidade_inep: hab,
      habilidade_custom: vers[0].habilidade_custom,
      param_b: wavg("param_b"),
      tp_lingua: "MULTI",   // marca especial
      _langs: [...new Set(vers.map((x) => x.tp_lingua === 0 ? "EN" : "ES"))].sort(),
      _n_itens: vers.length,  // pra tooltip: quantos itens únicos foram fundidos
    });
  }
  const out = [...outros, ...fundidos];
  out.sort((a, b) => (a.p ?? 2) - (b.p ?? 2));
  return out;
}

function renderItens(rowsRaw, nivel) {
  const tb = $("#tbl-itens tbody");
  let rows = state.area === "LC" ? fundirLEM(rowsRaw) : rowsRaw;

  // filtro por competência (clicada no card de competências)
  if (state.comp_filtro) {
    const comps = window.COMPETENCIAS[state.area] || [];
    const comp = comps.find((c) => c.n === state.comp_filtro);
    if (comp) {
      const hsSet = new Set(comp.hs);
      rows = rows.filter((r) => hsSet.has(r.habilidade_inep));
    }
  }
  atualizarBadgeFiltroComp();

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="7" class="skeleton">Sem dados para esta seleção.</td></tr>`;
    return;
  }
  const cor = AREA_INFO[state.area].cor;
  // Nº de itens por habilidade. Em LEM (fundido) somamos _n_itens pra
  // manter a contagem real (H7 → 3 itens: 2 EN + 1 ES), não 1 linha.
  const habCount = rows.reduce((m, r) => {
    if (r.habilidade_inep) {
      m[r.habilidade_inep] = (m[r.habilidade_inep] || 0) + (r._n_itens || 1);
    }
    return m;
  }, {});
  tb.innerHTML = rows.map((r) => {
    const hab = r.habilidade_custom || (r.habilidade_inep ? `H${r.habilidade_inep}` : "–");
    const n = habCount[r.habilidade_inep] || 0;
    // link do chip inclui filtros ativos pra que habilidade.html mostre o
    // desempenho da mesma seleção (UF/MUN/ESC × rede) usada na página inicial.
    const habLinkQs = new URLSearchParams({
      area: state.area, h: r.habilidade_inep,
      ...(state.nre  ? { nre:  state.nre  } : {}),
      ...(state.mun  ? { mun:  state.mun  } : {}),
      ...(state.esc  ? { esc:  state.esc  } : {}),
      rede: state.rede,
    }).toString();
    const chip = r.habilidade_inep
      ? `<a class="chip-hab" target="_blank"
            href="habilidade.html?${habLinkQs}"
            data-area="${state.area}" data-h="${r.habilidade_inep}"
            title="${hab} · ${AREA_INFO[state.area].nome} — abre detalhes em nova aba">${hab}</a>`
      : `<span class="chip-hab">${hab}</span>`;
    const lang = r.tp_lingua === 0 ? `<span class="chip-lang">EN</span>`
               : r.tp_lingua === 1 ? `<span class="chip-lang">ES</span>`
               : r.tp_lingua === "MULTI" ? `<span class="chip-lang">${r._langs.join("·")}</span>` : "";
    const [bCls, bTxt] = classifB(r.param_b);
    const badge = (d) => d == null ? `<span class="delta-flat">–</span>`
      : Math.abs(d) < 0.005 ? `<span class="delta-flat">=</span>`
      : d > 0 ? `<span class="delta-up">+${fmt(d * 100, 0)} pp</span>`
              : `<span class="delta-down">${fmt(d * 100, 0)} pp</span>`;
    const dHtml = badge(r.p_br == null ? null : r.p - r.p_br);
    const dEspHtml = badge(r.p_esp == null ? null : r.p - r.p_esp);
    // UF só some quando nivel === "BR" (aí não há UF selecionada); em
    // UF/MUN/ESC mostra a média da UF pai — quando disponível.
    const ufTd = nivel === "BR" || r.p_uf == null ? "–"
      : `<span title="UF: ${fmt(r.p_uf * 100, 1)}%">${fmt(r.p_uf * 100, 0)}%</span>`;
    const brTd = r.p_br == null ? "–"
      : `<span title="Brasil: ${fmt(r.p_br * 100, 1)}%">${fmt(r.p_br * 100, 0)}%</span>`;
    return `<tr>
      <td>${chip}${lang}</td>
      <td class="pct-n"><b>${n}</b></td>
      <td class="${bCls}">${bTxt}</td>
      <td class="col-bar">
        <div class="mini-track" title="Acerto observado: ${fmt(r.p * 100, 1)}%${r.p_esp != null ? ` · esperado pela TRI: ${fmt(r.p_esp * 100, 1)}%` : ""}">
          <div class="mini-fill" style="width:${r.p * 100}%;background:${cor}"></div>
          ${r.p_esp == null ? "" :
            `<div class="mini-mark" style="left:${r.p_esp * 100}%"
                  title="Esperado pela TRI: ${fmt(r.p_esp * 100, 1)}%"></div>`}
          <span class="mini-val">${fmt(r.p * 100, 0)}%</span>
        </div>
        ${r.p_br == null ? "" :
          `<div class="mini-track-br" title="Acerto no Brasil: ${fmt(r.p_br * 100, 1)}%">
             <div class="mini-fill-br" style="width:${r.p_br * 100}%"></div>
           </div>`}
      </td>
      <td class="pct-ref">${ufTd} · ${brTd}</td>
      <td>${dHtml}</td>
      <td>${dEspHtml}</td>
    </tr>`;
  }).join("");
}

async function loadItens() {
  const { nivel, chave } = nivelChave();
  $("#tbl-itens tbody").innerHTML =
    `<tr><td colspan="7" class="skeleton">Carregando itens…</td></tr>`;
  $("#tit-ano-itens").textContent = state.ano;
  const rows = await api("itens", { nivel, chave, area: state.area, ano: state.ano });
  renderItens(rows, nivel);
}

/* Badge visual acima da tabela quando filtro por competência está ativo. */
function atualizarBadgeFiltroComp() {
  let el = document.getElementById("badge-comp");
  if (!state.comp_filtro) { if (el) el.remove(); return; }
  const comp = (window.COMPETENCIAS[state.area] || []).find((c) => c.n === state.comp_filtro);
  if (!comp) return;
  if (!el) {
    el = document.createElement("div");
    el.id = "badge-comp";
    el.className = "filtro-ativo";
    const tabela = document.querySelector("#tbl-itens").closest(".card");
    tabela.parentNode.insertBefore(el, tabela);
  }
  el.innerHTML = `<span>Filtrando por: <b>C${comp.n} · ${comp.titulo}</b>
    <span style="color:var(--ink-40);font-weight:500;margin-left:6px">
      (H${comp.hs[0]}–H${comp.hs[comp.hs.length-1]})
    </span></span>
    <button type="button" id="badge-comp-clr" class="btn-ghost btn-xs">✕ limpar</button>`;
  document.getElementById("badge-comp-clr").onclick = () => {
    state.comp_filtro = null;
    renderCompetencias();
    loadItens();
  };
}

/* ---- render: desempenho por competência --------------------------------- */
/* Dois modos:
 *   - "atual"     — barras horizontais no ano selecionado (mostra alvo/BR/TRI).
 *   - "evolucao"  — sparkline por competência ao longo de 2021-2025.
 * Cliques nas linhas filtram a tabela de itens abaixo. */
async function renderCompetencias() {
  const card = document.getElementById("card-comp");
  const body = document.getElementById("comp-body");
  const sub = document.getElementById("tit-comp-sub");
  if (!card || !body) return;

  const comps = window.COMPETENCIAS[state.area] || [];
  if (!comps.length) { card.hidden = true; return; }
  card.hidden = false;

  if (state.comp_modo === "evolucao") {
    sub.textContent = "· 2021 – 2025";
    await renderCompetenciasEvolucao(body, comps);
  } else {
    sub.textContent = `· ${state.ano}`;
    await renderCompetenciasAtual(body, comps);
  }
}

async function renderCompetenciasAtual(body, comps) {
  const { nivel, chave } = nivelChave();
  const rows = await api("itens", { nivel, chave, area: state.area, ano: state.ano });
  const habToComp = window.HAB_TO_COMP[state.area] || {};
  const cor = AREA_INFO[state.area].cor;

  const agg = new Map();
  for (const r of rows || []) {
    if (!r.habilidade_inep) continue;
    const c = habToComp[r.habilidade_inep];
    if (!c) continue;
    const a = agg.get(c.n) || { n: 0, nP: 0, nEsp: 0, nBr: 0,
                                acerto: 0, esp: 0, br: 0, itens: 0, hs: new Set() };
    // Cada média precisa do próprio denominador. Tratar p_esp/p_br nulos como
    // zero sobre o n total afunda a barra: um item sem esperado entrava com 0
    // no numerador mas com o n cheio embaixo (em LC, onde os itens EN·ES podem
    // não ter esperado, isso derrubava a competência vários pp).
    a.n += r.n || 0;
    if (r.p     != null) { a.acerto += r.p     * (r.n || 0); a.nP   += r.n || 0; }
    if (r.p_esp != null) { a.esp    += r.p_esp * (r.n || 0); a.nEsp += r.n || 0; }
    if (r.p_br  != null) { a.br     += r.p_br  * (r.n || 0); a.nBr  += r.n || 0; }
    a.itens += 1;
    a.hs.add(r.habilidade_inep);
    agg.set(c.n, a);
  }

  body.innerHTML = comps.map((c) => {
    const ativa = state.comp_filtro === c.n ? "comp-ativa" : "";
    const a = agg.get(c.n);
    if (!a || !a.n) {
      return `<div class="comp-row comp-row-vazio ${ativa}" data-comp="${c.n}">
        <div class="comp-lbl">
          <b>C${c.n}</b> · <span class="comp-tit">${c.titulo}</span>
          <span class="comp-hs">H${c.hs[0]}–H${c.hs[c.hs.length-1]}</span>
        </div>
        <div class="comp-vazio">sem itens nesta prova</div>
      </div>`;
    }
    const p = a.nP ? a.acerto / a.nP : 0;
    const pEsp = a.nEsp ? a.esp / a.nEsp : 0;
    const pBr = a.nBr ? a.br / a.nBr : 0;
    return `<div class="comp-row ${ativa}" data-comp="${c.n}">
      <div class="comp-lbl">
        <b>C${c.n}</b> · <span class="comp-tit">${c.titulo}</span>
        <span class="comp-hs">H${c.hs[0]}–H${c.hs[c.hs.length-1]} · ${a.itens} ${a.itens===1?"item":"itens"}</span>
      </div>
      <div class="comp-bar">
        <div class="mini-track">
          <div class="mini-fill" style="width:${p*100}%;background:${cor}"></div>
          ${pEsp ? `<div class="mini-mark" style="left:${pEsp*100}%"
                title="Esperado pela TRI: ${fmt(pEsp*100,0)}%"></div>` : ""}
          <span class="mini-val">${fmt(p*100,0)}%</span>
        </div>
        ${pBr ? `<div class="mini-track-br" title="Brasil: ${fmt(pBr*100,0)}%">
                  <div class="mini-fill-br" style="width:${pBr*100}%"></div>
                </div>` : ""}
      </div>
    </div>`;
  }).join("");
  aplicarHandlersCompRows();
}

const _cacheHistItens = {};
async function fetchHistItens(nivel, chave) {
  const k = `${nivel}/${chave}`;
  if (_cacheHistItens[k]) return _cacheHistItens[k];
  const url = nivel === "ESC" ? null : `api/historico/${k}.json`;
  _cacheHistItens[k] = url ? fetch(url).then((r) => r.ok ? r.json() : null) : Promise.resolve(null);
  return _cacheHistItens[k];
}

async function renderCompetenciasEvolucao(body, comps) {
  const { nivel, chave } = nivelChave();
  const rede = state.rede || "T";
  const habToComp = window.HAB_TO_COMP[state.area] || {};
  const cor = AREA_INFO[state.area].cor;

  // Buscar histórico do alvo. Se ESC, não há /historico/ — mostra só o BR.
  const [hist, histBr] = await Promise.all([
    fetchHistItens(nivel, chave),
    fetchHistItens("BR", "BR"),
  ]);

  const serieParaAlvo = (comp, bloco) => ANOS.map((ano) => {
    const lst = bloco?.[rede]?.por_ano?.[String(ano)]?.[state.area] || [];
    let sn = 0, sp = 0;
    for (const [co, n, p] of lst) {
      const h = _habFromCoItem(co);
      // fallback: se não temos meta, usamos o próprio filtro só quando dá
      const c = habToComp[h];
      if (c && c.n === comp.n && p != null && n) {
        sn += n; sp += p * n;
      }
    }
    return sn ? Math.round((sp / sn) * 100) : null;
  });

  // Sem meta de CO_ITEM → habilidade no cliente, a série alvo fica vazia.
  // Uso habilidades/{area}/{h}.json pra fallback do BR (já tem p_br por ano).
  const habBrCache = {};
  async function getBrHabAno(h) {
    if (!habBrCache[h]) {
      habBrCache[h] = fetch(`api/habilidades/${state.area}/${h}.json`)
        .then((r) => r.ok ? r.json() : null);
    }
    return habBrCache[h];
  }

  // BR: pra cada competência, agrega média ponderada dos itens de H nesse ano
  const seriesBrPorComp = {};
  for (const c of comps) {
    const porAno = ANOS.map(() => ({ n: 0, acc: 0 }));
    for (const h of c.hs) {
      const j = await getBrHabAno(h);
      if (!j) continue;
      ANOS.forEach((ano, i) => {
        const p = j.por_ano?.[String(ano)];
        if (p && p.n_participantes_br && p.media_p_acerto_br != null) {
          porAno[i].n += p.n_participantes_br;
          porAno[i].acc += p.media_p_acerto_br * p.n_participantes_br;
        }
      });
    }
    seriesBrPorComp[c.n] = porAno.map((a) => a.n ? Math.round((a.acc / a.n) * 100) : null);
  }

  // Alvo: precisa mapear CO_ITEM → habilidade. Como o hist do alvo só tem
  // 7-tupla com [item, n, p, p_esp, hab, ...], podemos filtrar direto pelo
  // hab (índice 4) sem lookup.
  const seriesAlvoPorComp = {};
  if (hist && nivel !== "BR") {
    for (const c of comps) {
      const hsSet = new Set(c.hs);
      seriesAlvoPorComp[c.n] = ANOS.map((ano) => {
        const lst = hist[rede]?.por_ano?.[String(ano)]?.[state.area] || [];
        let sn = 0, sp = 0;
        for (const [, n, p, , hab] of lst) {
          if (hsSet.has(hab) && p != null && n) {
            sn += n; sp += p * n;
          }
        }
        return sn ? Math.round((sp / sn) * 100) : null;
      });
    }
  }

  body.innerHTML = comps.map((c) => {
    const ativa = state.comp_filtro === c.n ? "comp-ativa" : "";
    const brSerie = seriesBrPorComp[c.n] || ANOS.map(() => null);
    const alvoSerie = seriesAlvoPorComp[c.n];

    const brSpark = window.Charts.sparkline(brSerie, {
      cor: "var(--ink-40)", width: 200, height: 42, anos: ANOS,
    });
    const alvoSpark = alvoSerie
      ? window.Charts.sparkline(alvoSerie, { cor, width: 200, height: 42, anos: ANOS })
      : "";

    const ultBr = brSerie[brSerie.length - 1];
    const ultAlvo = alvoSerie ? alvoSerie[alvoSerie.length - 1] : null;
    const valTxt = ultAlvo != null ? `${ultAlvo}%` : (ultBr != null ? `${ultBr}%` : "–");
    return `<div class="comp-row comp-row-evo ${ativa}" data-comp="${c.n}">
      <div class="comp-lbl">
        <b>C${c.n}</b> · <span class="comp-tit">${c.titulo}</span>
        <span class="comp-hs">H${c.hs[0]}–H${c.hs[c.hs.length-1]}</span>
      </div>
      <div class="comp-evo-spark">
        ${alvoSpark ? `<div class="comp-evo-line" title="Sua seleção">${alvoSpark}</div>` : ""}
        <div class="comp-evo-line" title="Brasil (rede T)">${brSpark}</div>
      </div>
      <div class="comp-evo-num">${valTxt}<div class="comp-evo-lbl">${alvoSerie ? "seleção 2025" : "Brasil 2025"}</div></div>
    </div>`;
  }).join("");
  aplicarHandlersCompRows();
}

function _habFromCoItem() { return null; }   // placeholder — não usado

function aplicarHandlersCompRows() {
  document.querySelectorAll(".comp-row[data-comp]").forEach((row) => {
    row.addEventListener("click", () => {
      const n = parseInt(row.dataset.comp, 10);
      state.comp_filtro = state.comp_filtro === n ? null : n;
      renderCompetencias();
      loadItens();
    });
  });
}

function setActiveTab(selector, key, val) {
  document.querySelectorAll(`${selector} button`).forEach((x) => {
    x.classList.toggle("on", x.dataset[key] === String(val));
  });
}

function setArea(area) {
  state.area = area;
  state.comp_filtro = null;    // trocar de área desativa filtro por competência
  setActiveTab("#tabs-area", "area", area);
  setActiveTab("#tabs-area-comp", "area", area);
  writeStateToURL();
  loadItens();
  renderCompetencias();
}
document.querySelectorAll("#tabs-area button").forEach((b) => {
  b.addEventListener("click", () => setArea(b.dataset.area));
});
document.querySelectorAll("#tabs-area-comp button").forEach((b) => {
  b.addEventListener("click", () => setArea(b.dataset.area));
});

document.querySelectorAll("#tabs-modo-comp button").forEach((b) => {
  b.addEventListener("click", () => {
    state.comp_modo = b.dataset.modo;
    state.comp_filtro = null;   // trocar modo desativa filtro
    setActiveTab("#tabs-modo-comp", "modo", state.comp_modo);
    renderCompetencias();
    loadItens();
  });
});

document.querySelectorAll("#tabs-ano button").forEach((b) => {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    state.ano = parseInt(b.dataset.ano, 10);
    setActiveTab("#tabs-ano", "ano", state.ano);
    writeStateToURL();
    loadItens();
    renderCompetencias();
    const subEl = document.getElementById("tit-comp-sub");
    if (subEl) subEl.textContent = "· " + state.ano;
  });
});

/* Chip da habilidade abre habilidade.html em nova aba (target="_blank"), sem
   filtragem da tabela — comportamento nativo do <a>. */

/* ---------- tooltip das habilidades --------------------------------------- */
const tip = document.createElement("div");
tip.className = "tooltip";
tip.hidden = true;
document.body.appendChild(tip);

document.addEventListener("mouseover", (e) => {
  const c = e.target.closest(".chip-hab[data-h]");
  if (!c) { tip.hidden = true; return; }
  const desc = (window.HABILIDADES?.[c.dataset.area] || {})[c.dataset.h];
  if (!desc) return;
  tip.innerHTML = `<b>H${c.dataset.h} · ${AREA_INFO[c.dataset.area].nome}</b>
    ${desc}`;
  tip.hidden = false;
  const r = c.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, innerWidth - 348));
  // altura real em vez do 336 fixo, que era calibrado pro tooltip com a linha
  // de CTA — sem ela o tooltip encurtou e o limiar antigo o jogaria pra cima
  // do chip sem necessidade.
  const top = r.bottom + tip.offsetHeight + 8 > innerHeight
    ? r.top - tip.offsetHeight - 8 : r.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
});

/* ---------- ciclo principal ---------------------------------------------- */
async function refresh() {
  const { nivel, chave } = nivelChave();
  const data = await api("resumo", { nivel, chave });
  if (data.erro) {
    $("#ent-nome").textContent = "Sem dados nesta rede";
    $("#ent-meta").textContent =
      `A seleção atual não tem concluintes na ${REDE_NOME[state.rede]}.`;
    $("#ent-chip").textContent = NIVEL_NOME[nivel];
    $("#kpis").innerHTML = "";
    $("#areas-comp").innerHTML = "";
    $("#evolucao").hidden = true;
    $("#tbl-itens tbody").innerHTML =
      `<tr><td colspan="7" class="skeleton">Sem dados para esta seleção.</td></tr>`;
    return;
  }
  renderResumo(data);
  loadItens();
  renderCompetencias();
  writeStateToURL();
}

readStateFromURL();

initNREsMunicipios().then(async () => {
  // aplica seleções da URL (rede/area/ano/h) nos tabs
  setActiveTab("#tabs-rede", "rede", state.rede);
  setActiveTab("#tabs-area", "area", state.area);
  setActiveTab("#tabs-area-comp", "area", state.area);
  setActiveTab("#tabs-ano", "ano", state.ano);
  const subElBoot = document.getElementById("tit-comp-sub");
  if (subElBoot) subElBoot.textContent = "· " + state.ano;

  const munAlvo = state.mun;
  const escAlvo = state.esc;
  if (munAlvo && [...$("#sel-mun").options].some((o) => o.value === munAlvo)) {
    $("#sel-mun").value = munAlvo;
    $("#sel-mun").dispatchEvent(new Event("change"));
    if (escAlvo) {
      for (let i = 0; i < 40; i++) {
        if (escolasMun.length) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      const e = escolasMun.find((x) => String(x.chave) === String(escAlvo));
      if (e) {
        state.esc = e.chave;
        inpEsc.value = e.rotulo;
        refresh();
      }
    }
  } else {
    refresh();
  }
});
