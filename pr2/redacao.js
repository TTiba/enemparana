/* Redação isolada — dois números lado a lado ("1º dia, com zeros" vs recorte
 * "2 dias, sem zeros") + competências + ranking de escolas. Rede sempre
 * pública (ver ESTADO.md: escolas particulares removidas do painel).
 *
 * NÃO rotular o primeiro número como "oficial (Inep)": ele é calculado aqui a
 * partir do microdado, não é um número divulgado pelo INEP, e o rótulo antigo
 * dava a entender que o órgão o havia calculado (ver ESTADO.md, correção 12/08).
 *
 * Cópia adaptada do padrão de filtro de app.js/ranking_escolas.js — este repo
 * não compartilha módulo de página, cada uma tem sua cópia (ver habilidade.js,
 * criticas.js). Aqui simplificado: sem itens, sem anos, só redação.
 */
const $ = (s) => document.querySelector(s);
const fmt1 = (v) => v == null ? "–" : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (v) => v == null ? "–" : Math.round(v).toLocaleString("pt-BR");
const fmtInt = (v) => v == null ? "–" : (+v).toLocaleString("pt-BR");
const fmtPct = (v) => v == null ? "–" : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

const LOCK_UF = window.LOCK_UF || "PR";
const globais = window.Filtros ? window.Filtros.carregar() : {};
const state = { nre: globais.nre || "", mun: globais.mun || "", esc: globais.esc || "" };

let NRE_AGG = null, NRE_TO_MUNS = {}, MUNS_ALL = [], MUN_TO_NRE = {};
let REDACAO = null;          // api/redacao/index.json — hoje só UF/PR
let RANKING = [];            // api/top_escolas_full/UF/PR.json (já sem particulares)

function nivelChave() {
  if (state.esc) return { nivel: "ESC", chave: state.esc };
  if (state.mun) return { nivel: "MUN", chave: state.mun };
  if (state.nre) return { nivel: "NRE", chave: state.nre };
  return { nivel: "UF", chave: LOCK_UF };
}

/* ---------- filtros: NRE / município / escola ------------------------------ */
function fillSelect(sel, itens, placeholder, valor, rotulo) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    itens.map((i) => `<option value="${i[valor]}">${i[rotulo]}</option>`).join("");
  sel.disabled = itens.length === 0;
}
function municipiosDoNRE(nre) {
  const cds = new Set((NRE_TO_MUNS[nre] || []).map(String));
  return MUNS_ALL.filter((m) => cds.has(String(m.chave)));
}

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
document.addEventListener("click", (e) => { if (!e.target.closest(".combo")) comboList.hidden = true; });
comboList.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.esc = b.dataset.chave;
  inpEsc.value = escolasMun.find((x) => x.chave == state.esc)?.rotulo || "";
  comboList.hidden = true;
  refresh();
});

async function carregarEscolasDoMun(mun) {
  const lst = await fetch(`api/escolas/${mun}.json`).then((r) => r.ok ? r.json() : []);
  return lst.map((x) => ({
    chave: x.chave, rotulo: x.rotulo, n: x.n_participantes,
    busca: `${x.rotulo} ${x.chave}`.toLowerCase(),
  }));
}

$("#sel-nre").addEventListener("change", (e) => {
  state.nre = e.target.value; state.mun = ""; state.esc = "";
  const muns = state.nre ? municipiosDoNRE(state.nre) : MUNS_ALL;
  fillSelect($("#sel-mun"), muns, "Todos os municípios", "chave", "nome");
  setEscolas([]);
  salvarEstado();
  refresh();
});
$("#sel-mun").addEventListener("change", async (e) => {
  state.mun = e.target.value; state.esc = "";
  setEscolas(state.mun ? await carregarEscolasDoMun(state.mun) : []);
  salvarEstado();
  refresh();
});
$("#btn-limpar").addEventListener("click", () => {
  state.nre = state.mun = state.esc = "";
  $("#sel-nre").value = ""; $("#sel-mun").value = "";
  setEscolas([]);
  salvarEstado();
  refresh();
});
function salvarEstado() {
  if (window.Filtros) window.Filtros.salvar({ nre: state.nre, mun: state.mun, esc: state.esc, rede: "PUB" });
}

/* ---------- competências (bar rows, reaproveita o padrão de app.js) ------- */
// bar-row padrão tem rótulo de 130px fixos, sem quebra — curto demais pros
// nomes das competências. bar-row-larga dá mais espaço e permite quebrar.
function barRowComp(lbl, val, max, cor, valTxt) {
  const w = val == null ? 0 : Math.min(100, (val / max) * 100);
  return `<div class="bar-row bar-row-larga">
    <div class="lbl">${lbl}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${cor}"></div></div>
    <div class="bar-val">${valTxt}</div></div>`;
}
const COMP_NOME = {
  1: "C1 · domínio da norma", 2: "C2 · compreensão do tema",
  3: "C3 · argumentação", 4: "C4 · coesão", 5: "C5 · proposta de intervenção",
};

/* ---------- carrega o alvo selecionado ------------------------------------ */
async function alvoDia1() {
  const { nivel, chave } = nivelChave();
  if (nivel === "UF") {
    const d = await fetch(`api/entidade/UF/${LOCK_UF}.json`).then((r) => r.json());
    return { ...d.PUB.resumo.alvo, nome: "Paraná", nivelNome: "Estado" };
  }
  if (nivel === "NRE") {
    const cel = NRE_AGG?.por_rede?.PUB?.celulas?.[chave];
    return cel ? { nome: `NRE ${chave}`, nivelNome: "NRE", ...cel } : null;
  }
  if (nivel === "MUN") {
    const d = await fetch(`api/entidade/MUN/${chave}.json`).then((r) => r.ok ? r.json() : null);
    if (!d?.PUB) return null;
    return { nome: d.PUB.resumo.alvo.nome, nivelNome: "Município", ...d.PUB.resumo.alvo };
  }
  // ESC
  const d = await fetch(`api/entidade/ESC/${chave}.json`).then((r) => r.ok ? r.json() : null);
  if (!d) return null;
  const a = d.resumo.alvo;
  return { ...a, nome: a.escola?.nome || a.nome, nivelNome: "Escola" };
}

async function refresh() {
  const alvo = await alvoDia1();
  const { nivel } = nivelChave();

  if (!alvo) {
    $("#ent-nome").textContent = "Sem dados nesta seleção";
    $("#ent-meta").textContent = "";
    $("#red-of-num").textContent = "–"; $("#red-of-sub").textContent = "";
    $("#red-sz-num").textContent = "–"; $("#red-sz-sub").textContent = "";
    $("#red-comps").innerHTML = "";
    return;
  }

  $("#ent-nome").textContent = alvo.nome || "Paraná";
  $("#ent-chip").textContent = alvo.nivelNome;
  const meta = [];
  if (alvo.n_lc != null) meta.push(`${fmtInt(alvo.n_lc)} fizeram o 1º dia`);
  if (alvo.escola) meta.push(`${alvo.escola.dependencia_nome} · ${alvo.escola.municipio}/${alvo.escola.uf} · código INEP ${alvo.escola.chave}`);
  meta.push("rede pública");
  $("#ent-meta").textContent = meta.join(" · ");

  // -------- 1º dia, com zeros
  $("#red-of-num").textContent = fmt1(alvo.media_red);
  $("#red-of-sub").textContent = alvo.n_red != null
    ? `${fmtInt(alvo.n_red)} alunos · presentes no 1º dia, zero conta como nota`
    : "";

  // -------- recorte sem zeros — só existe hoje no nível UF (ver ESTADO.md)
  if (nivel === "UF" && REDACAO?.["UF/PR"]?.PUB) {
    const r = REDACAO["UF/PR"].PUB;
    const pct = r.n ? (r.n0 / r.n * 100) : null;
    $("#red-sz-num").textContent = fmt1(r.media_sz);
    $("#red-sz-sub").textContent =
      `${fmtInt(r.n)} fizeram os 2 dias · ${fmtInt(r.n0)} zeraram (${fmtPct(pct)})`;
  } else {
    $("#red-sz-num").textContent = "–";
    $("#red-sz-sub").textContent =
      "indisponível para esta seleção — calculado só para o Paraná inteiro " +
      "até rodar o script com os microdados por escola/município (ver Entenda os dados)";
  }

  // -------- competências (mesma base do 1º dia — existem em qualquer nível)
  $("#red-comps").innerHTML = [1, 2, 3, 4, 5].map((i) =>
    barRowComp(COMP_NOME[i], alvo[`media_comp${i}`], 200, "var(--rose)", fmt0(alvo[`media_comp${i}`]))
  ).join("");
}

/* ---------- ranking (adaptado de ranking_escolas.js, ordenado por redação) - */
const rkState = { nre: "", dep: 0, busca: "", sort_col: "media_red", sort_dir: "desc" };
const DEP_NOME = { 0: "todas as redes", 1: "federal", 2: "estadual", 3: "municipal" };
const RK_SORT_DEFAULT_DIR = {
  nome: "asc", municipio: "asc", dependencia_nome: "asc", n_red: "desc", media_red: "desc",
};

function renderRanking() {
  const q = rkState.busca.trim().toLowerCase();
  let linhas = RANKING.filter((e) => {
    if (rkState.dep && e.dependencia !== rkState.dep) return false;
    if (rkState.nre && MUN_TO_NRE[String(e.co_municipio)] !== rkState.nre) return false;
    if (q && !`${e.nome || ""} ${e.municipio || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  linhas.sort((a, b) => {
    let va = a[rkState.sort_col], vb = b[rkState.sort_col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") {
      return rkState.sort_dir === "desc" ? vb.localeCompare(va, "pt-BR") : va.localeCompare(vb, "pt-BR");
    }
    return rkState.sort_dir === "desc" ? vb - va : va - vb;
  });

  $("#red-rk-resumo").innerHTML =
    `<b>${fmtInt(linhas.length)}</b> escolas${rkState.nre ? " · NRE " + rkState.nre : ""}` +
    (rkState.dep ? ` · rede ${DEP_NOME[rkState.dep]}` : "") +
    (q ? ` · busca "${rkState.busca}"` : "");

  const tb = $("#rk-tbody");
  if (!linhas.length) {
    tb.innerHTML = `<tr><td colspan="6" class="skeleton" style="padding:24px;text-align:center">Nenhuma escola nesse filtro.</td></tr>`;
    return;
  }
  tb.innerHTML = linhas.slice(0, 1000).map((e, i) => {
    const link = `index.html?mun=${e.co_municipio}&esc=${e.chave}`;
    return `<tr>
      <td class="rk-pos">${i + 1}</td>
      <td class="rk-escola"><a href="${link}" title="${e.nome}">${e.nome || `Escola INEP ${e.chave}`}</a></td>
      <td class="rk-mun">${e.municipio || "—"}</td>
      <td>${e.dependencia_nome || "—"}</td>
      <td class="rk-num">${fmtInt(e.n_red)}</td>
      <td class="rk-num rk-forte">${fmt0(e.media_red)}</td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".rk-sort").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === rkState.sort_col) th.classList.add(rkState.sort_dir === "asc" ? "sort-asc" : "sort-desc");
  });
}
document.querySelectorAll("#rk-rede button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#rk-rede button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    rkState.dep = parseInt(b.dataset.dep, 10);
    renderRanking();
  });
});
$("#rk-busca").addEventListener("input", (e) => { rkState.busca = e.target.value; renderRanking(); });
document.querySelectorAll(".rk-sort").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (rkState.sort_col === col) rkState.sort_dir = rkState.sort_dir === "desc" ? "asc" : "desc";
    else { rkState.sort_col = col; rkState.sort_dir = RK_SORT_DEFAULT_DIR[col] || "asc"; }
    renderRanking();
  });
});
$("#rk-nre").addEventListener("change", (e) => { rkState.nre = e.target.value; renderRanking(); });

/* ---------- boot ------------------------------------------------------------ */
(async () => {
  const j = (u) => fetch(u).then((r) => (r.ok ? r.json() : null));
  const [nreAgg, nreToMuns, muns, redacao, ranking] = await Promise.all([
    j("data/nre_agg.json"),
    j("data/nre_to_muns.json"),
    j(`api/municipios/${LOCK_UF}.json`),
    j("api/redacao/index.json"),
    j("api/top_escolas_full/UF/PR.json"),
  ]);
  NRE_AGG = nreAgg;
  NRE_TO_MUNS = nreToMuns || {};
  for (const [nre, cds] of Object.entries(NRE_TO_MUNS)) cds.forEach((cd) => (MUN_TO_NRE[String(cd)] = nre));
  MUNS_ALL = muns?.PUB || [];
  REDACAO = redacao || {};
  RANKING = Array.isArray(ranking) ? ranking : [];

  const nres = Object.keys(NRE_TO_MUNS).sort();
  const opts = `<option value="">Todos (PR inteiro)</option>` + nres.map((n) => `<option value="${n}">${n}</option>`).join("");
  $("#sel-nre").innerHTML = opts;
  $("#rk-nre").innerHTML = opts;
  if (state.nre) { $("#sel-nre").value = state.nre; }

  const munsIniciais = state.nre ? municipiosDoNRE(state.nre) : MUNS_ALL;
  fillSelect($("#sel-mun"), munsIniciais, "Todos os municípios", "chave", "nome");
  if (state.mun) {
    $("#sel-mun").value = state.mun;
    setEscolas(await carregarEscolasDoMun(state.mun));
    if (state.esc) {
      const e = escolasMun.find((x) => String(x.chave) === state.esc);
      if (e) inpEsc.value = e.rotulo; else state.esc = "";
    }
  }

  refresh();
  renderRanking();
})();
