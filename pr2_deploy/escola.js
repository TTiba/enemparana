/* Sua Escola — dois radares (áreas do conhecimento e competências da
 * redação) comparando escola × município × NRE × Paraná, mais contagem de
 * alunos e distribuição por faixa de nota. Rede sempre pública (ver
 * ESTADO.md: escolas particulares removidas do painel).
 *
 * Substituiu a página de ranking (`ranking_escolas.*`, removida): a tabela
 * de classificação saiu inteira a pedido.
 *
 * Cópia adaptada do padrão de filtro de app.js/redacao.js — este repo não
 * compartilha módulo de página, cada uma tem sua cópia.
 */
const $ = (s) => document.querySelector(s);
const fmt1 = (v) => v == null ? "–" : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = (v) => v == null ? "–" : (+v).toLocaleString("pt-BR");

const LOCK_UF = window.LOCK_UF || "PR";
const LOCK_UF_NOME = window.LOCK_UF_NOME || "Paraná";
const globais = window.Filtros ? window.Filtros.carregar() : {};
const state = { nre: globais.nre || "", mun: globais.mun || "", esc: globais.esc || "" };

let NRE_AGG = null, NRE_TO_MUNS = {}, MUNS_ALL = [], HIST = null, UF_ALVO = null;
let escolasMun = [];

/* séries dos radares — `on` é alternado pela legenda clicável */
const SERIES = [
  { id: "esc", nome: "Escola",       cor: "var(--pink)",   on: true },
  { id: "mun", nome: "Município",    cor: "var(--mint)",   on: true },
  { id: "nre", nome: "NRE",          cor: "var(--peach)",  on: true },
  { id: "uf",  nome: LOCK_UF_NOME,   cor: "var(--lilac)",  on: true },
];
const EIXOS_AREA = [
  { lbl: "Linguagens", campo: "media_lc" },
  { lbl: "Humanas",    campo: "media_ch" },
  { lbl: "Natureza",   campo: "media_cn" },
  { lbl: "Matemática", campo: "media_mt" },
];
const EIXOS_COMP = [
  { lbl: "C1 norma",      campo: "media_comp1" },
  { lbl: "C2 tema",       campo: "media_comp2" },
  { lbl: "C3 argumento",  campo: "media_comp3" },
  { lbl: "C4 coesão",     campo: "media_comp4" },
  { lbl: "C5 intervenção",campo: "media_comp5" },
];
// `zeroFora`: o histograma de `data/hist_nota_pr.json` é gerado com filtro
// `nota > 0` (build_hist_nota_pr.py), então não contém quem zerou. Nas quatro
// áreas isso descarta 0,03–0,22% dos alunos e é irrelevante; na **redação
// descarta 4,97%** — e são justamente os zeros, que puxam a média ~21,5
// pontos (ver ESTADO.md §4b). Como o `media_red` da escola **inclui** zeros,
// marcar essa média sobre um histograma sem zeros compara populações
// diferentes: a marca cairia à esquerda do que deveria. Por isso a redação
// mostra a distribuição mas não recebe a marca.
const AREAS_N = [
  { lbl: "Linguagens", n: "n_lc",  media: "media_lc",  cor: "var(--lilac)", dia: 1, hk: "lc" },
  { lbl: "Humanas",    n: "n_ch",  media: "media_ch",  cor: "var(--peach)", dia: 1, hk: "ch" },
  { lbl: "Redação",    n: "n_red", media: "media_red", cor: "var(--rose)",  dia: 1, hk: "red", zeroFora: true },
  { lbl: "Natureza",   n: "n_cn",  media: "media_cn",  cor: "var(--mint)",  dia: 2, hk: "cn" },
  { lbl: "Matemática", n: "n_mt",  media: "media_mt",  cor: "var(--lime)",  dia: 2, hk: "mt" },
];

function nivelChave() {
  if (state.esc) return { nivel: "ESC", chave: state.esc };
  if (state.mun) return { nivel: "MUN", chave: state.mun };
  if (state.nre) return { nivel: "NRE", chave: state.nre };
  return { nivel: "UF", chave: LOCK_UF };
}

/* ---------- filtros ------------------------------------------------------- */
function fillSelect(sel, itens, placeholder, valor, rotulo) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    itens.map((i) => `<option value="${i[valor]}">${i[rotulo]}</option>`).join("");
  sel.disabled = itens.length === 0;
}
function municipiosDoNRE(nre) {
  const cds = new Set((NRE_TO_MUNS[nre] || []).map(String));
  return MUNS_ALL.filter((m) => cds.has(String(m.chave)));
}
function nreDoMun(cd) {
  for (const [nre, cds] of Object.entries(NRE_TO_MUNS)) {
    if (cds.map(String).includes(String(cd))) return nre;
  }
  return "";
}

const inpEsc = $("#inp-esc");
const comboList = $("#combo-list");
function setEscolas(lista) {
  escolasMun = lista;
  inpEsc.value = "";
  inpEsc.disabled = lista.length === 0;
  inpEsc.placeholder = lista.length
    ? `Digite para buscar entre ${lista.length} escolas…` : "Selecione um município";
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
  salvarEstado();
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
  fillSelect($("#sel-mun"), state.nre ? municipiosDoNRE(state.nre) : MUNS_ALL,
             "Todos os municípios", "chave", "nome");
  setEscolas([]); salvarEstado(); refresh();
});
$("#sel-mun").addEventListener("change", async (e) => {
  state.mun = e.target.value; state.esc = "";
  setEscolas(state.mun ? await carregarEscolasDoMun(state.mun) : []);
  salvarEstado(); refresh();
});
$("#btn-limpar").addEventListener("click", () => {
  state.nre = state.mun = state.esc = "";
  $("#sel-nre").value = ""; $("#sel-mun").value = "";
  fillSelect($("#sel-mun"), MUNS_ALL, "Todos os municípios", "chave", "nome");
  setEscolas([]); salvarEstado(); refresh();
});
function salvarEstado() {
  if (window.Filtros) window.Filtros.salvar({ nre: state.nre, mun: state.mun, esc: state.esc, rede: "PUB" });
}

/* ---------- carga dos quatro níveis --------------------------------------- */
async function alvoDe(nivel, chave) {
  if (nivel === "UF") return UF_ALVO;
  if (nivel === "NRE") return NRE_AGG?.por_rede?.PUB?.celulas?.[chave] || null;
  if (nivel === "MUN") {
    const d = await fetch(`api/entidade/MUN/${chave}.json`).then((r) => r.ok ? r.json() : null);
    return d?.PUB?.resumo?.alvo || null;
  }
  const d = await fetch(`api/entidade/ESC/${chave}.json`).then((r) => r.ok ? r.json() : null);
  return d?.resumo?.alvo || null;
}

/* Resolve os quatro contextos de uma vez. Município e NRE saem da seleção
 * corrente; se a pessoa parou num nível acima, os de baixo ficam nulos e a
 * série some do gráfico (em vez de mostrar linha achatada em zero). */
async function carregarContextos() {
  const nre = state.nre || (state.mun ? nreDoMun(state.mun) : "");
  const [esc, mun] = await Promise.all([
    state.esc ? alvoDe("ESC", state.esc) : null,
    state.mun ? alvoDe("MUN", state.mun) : null,
  ]);
  return {
    esc, mun,
    nre: nre ? await alvoDe("NRE", nre) : null,
    uf: UF_ALVO,
    nreNome: nre,
  };
}

/* ---------- radares ------------------------------------------------------- */
function montarSeries(ctx, eixos) {
  return SERIES.map((s) => ({
    ...s,
    dados: ctx[s.id],
    valores: eixos.map((e) => {
      const v = ctx[s.id]?.[e.campo];
      return v == null ? null : v;
    }),
  })).filter((s) => s.dados);
}
function legendaHtml(series, alvoId) {
  return series.map((s) => `
    <button type="button" class="leg-item${s.on ? "" : " off"}"
            data-alvo="${alvoId}" data-id="${s.id}">
      <span class="leg-dot" style="background:${s.cor}"></span>${s.nome}
    </button>`).join("");
}
function desenharRadares(ctx) {
  const sa = montarSeries(ctx, EIXOS_AREA);
  const sc = montarSeries(ctx, EIXOS_COMP);
  // viewBox largo: com 4 eixos os rótulos de leste/oeste ("Matemática",
  // "Humanas") saem na horizontal e eram cortados na borda do SVG.
  $("#radar-areas").innerHTML = sa.length
    ? window.Charts.radar(EIXOS_AREA, sa, { passo: 25, width: 440, height: 330, margem: 74 })
    : `<p class="hint" style="padding:20px 0">Sem dados para esta seleção.</p>`;
  $("#radar-comps").innerHTML = sc.length
    ? window.Charts.radar(EIXOS_COMP, sc, { passo: 10, width: 440, height: 330, margem: 74 })
    : `<p class="hint" style="padding:20px 0">Sem dados para esta seleção.</p>`;
  $("#leg-areas").innerHTML = legendaHtml(sa, "areas");
  $("#leg-comps").innerHTML = legendaHtml(sc, "comps");
}
// legenda clicável: alterna a série e redesenha os dois gráficos
document.addEventListener("click", (e) => {
  const b = e.target.closest(".leg-item");
  if (!b) return;
  const s = SERIES.find((x) => x.id === b.dataset.id);
  if (!s) return;
  const visiveis = SERIES.filter((x) => x.on).length;
  if (s.on && visiveis <= 1) return;      // nunca deixa o gráfico vazio
  s.on = !s.on;
  if (CTX) desenharRadares(CTX);
});

/* ---------- alunos + distribuição ----------------------------------------- */
function desenharAlunos(alvo) {
  const d1 = AREAS_N.filter((a) => a.dia === 1).map((a) => alvo[a.n]).filter((v) => v != null);
  const d2 = AREAS_N.filter((a) => a.dia === 2).map((a) => alvo[a.n]).filter((v) => v != null);
  const max1 = d1.length ? Math.max(...d1) : 0;
  const max2 = d2.length ? Math.max(...d2) : 0;
  const abandono = (max1 && max2) ? max1 - max2 : null;

  $("#alunos-sub").textContent = alvo.n_participantes != null
    ? `${fmtInt(alvo.n_participantes)} inscritos com escola identificada` : "";

  $("#alunos-grid").innerHTML = AREAS_N.map((a) => `
    <div class="aluno-cel">
      <div class="aluno-top" style="background:${a.cor}">${a.lbl}</div>
      <div class="aluno-num">${fmtInt(alvo[a.n])}</div>
      <div class="aluno-sub">${a.dia}º dia · média ${fmt1(alvo[a.media])}</div>
    </div>`).join("") + (abandono != null ? `
    <div class="aluno-cel aluno-cel-nota">
      <div class="aluno-top" style="background:var(--ink-06)">Entre os dias</div>
      <div class="aluno-num">−${fmtInt(abandono)}</div>
      <div class="aluno-sub">deixaram de fazer o 2º dia</div>
    </div>` : "");
}

/* A distribuição por faixa existe em UF, NRE e MUN — não por escola (ver
 * ESTADO.md). Então usa-se o nível mais fino disponível como pano de fundo e
 * marca-se a média da escola dentro dele, que responde "onde minha escola cai
 * nessa distribuição". */
function escopoHist(ctx) {
  // Se algum dia o hist_nota ganhar nível ESC (build_hist_nota_pr.py hoje só
  // emite UF/NRE/MUN), a página passa a usar a distribuição da própria escola
  // sozinha, sem mudar mais nada aqui.
  if (state.esc && HIST?.[`ESC/${state.esc}`]) {
    return { chave: `ESC/${state.esc}`, nome: "sua escola", propria: true };
  }
  if (state.mun && HIST?.[`MUN/${state.mun}`]) {
    const nome = MUNS_ALL.find((m) => String(m.chave) === String(state.mun))?.nome || "município";
    return { chave: `MUN/${state.mun}`, nome };
  }
  if (ctx.nreNome && HIST?.[`NRE/${ctx.nreNome}`]) {
    return { chave: `NRE/${ctx.nreNome}`, nome: `NRE ${ctx.nreNome}` };
  }
  return { chave: `UF/${LOCK_UF}`, nome: LOCK_UF_NOME };
}
function desenharDistribuicao(ctx, alvo) {
  const esc = escopoHist(ctx);
  const blocos = HIST?.[esc.chave];
  if (!blocos) {
    $("#dist-grid").innerHTML = `<p class="hint">Distribuição indisponível para esta seleção.</p>`;
    $("#dist-escopo").textContent = "";
    $("#dist-nota").textContent = "";
    return;
  }
  $("#dist-escopo").textContent = esc.nome;
  $("#dist-grid").innerHTML = AREAS_N.map((a) => {
    const b = blocos[a.hk];
    if (!b) return "";
    const total = Object.values(b).reduce((s, v) => s + v, 0);
    const marca = (state.esc && !a.zeroFora) ? alvo[a.media] : null;
    const nota = a.zeroFora
      ? ` · <span class="dist-alerta">sem os zeros</span>`
      : (marca != null ? ` · sua escola: <b>${fmt1(marca)}</b>` : "");
    return `<div class="dist-cel">
      <div class="dist-top"><span class="dist-dot" style="background:${a.cor}"></span>${a.lbl}</div>
      ${window.Charts.histograma(b, { cor: a.cor, marca })}
      <div class="dist-sub">${fmtInt(total)} alunos${nota}</div>
    </div>`;
  }).join("");

  const base = `Barras: distribuição de <b>${esc.nome}</b>, em faixas de 25
    pontos. O INEP não publica a distribuição por escola — só a média —, por
    isso o pano de fundo é o nível mais fino disponível.`;
  const zeros = `A distribuição conta apenas notas <b>acima de zero</b>. Nas
    quatro áreas isso deixa de fora menos de 0,3% dos alunos; na
    <b>redação são ~5%</b>, que são exatamente os zeros. Como a média de
    redação da escola inclui os zeros, ela não é comparável a essa
    distribuição — por isso a redação não recebe a marca.`;
  $("#dist-nota").innerHTML = state.esc
    ? `${base} A linha rosa marca a <b>média da escola selecionada</b>
       dentro da distribuição. ${zeros}`
    : `${base} Selecione uma escola para marcar a média dela dentro da
       distribuição. ${zeros}`;
}

/* ---------- refresh ------------------------------------------------------- */
let CTX = null;
async function refresh() {
  const { nivel } = nivelChave();
  CTX = await carregarContextos();
  const alvo = CTX.esc || CTX.mun || CTX.nre || CTX.uf;

  if (!alvo) {
    $("#ent-nome").textContent = "Sem dados nesta seleção";
    $("#ent-meta").textContent = "";
    $("#ent-chip").textContent = "";
    $("#radar-areas").innerHTML = $("#radar-comps").innerHTML = "";
    $("#leg-areas").innerHTML = $("#leg-comps").innerHTML = "";
    $("#alunos-grid").innerHTML = "";
    $("#dist-grid").innerHTML = "";
    return;
  }

  const nomes = { ESC: "Escola", MUN: "Município", NRE: "NRE", UF: "Estado" };
  $("#ent-chip").textContent = nomes[nivel];
  $("#ent-nome").textContent = nivel === "UF" ? LOCK_UF_NOME
    : (alvo.escola?.nome || alvo.nome || nivelChave().chave);

  const meta = [];
  if (alvo.n_lc != null) meta.push(`${fmtInt(alvo.n_lc)} fizeram o 1º dia`);
  if (alvo.n_mt != null) meta.push(`${fmtInt(alvo.n_mt)} fizeram o 2º dia`);
  if (alvo.media_geral != null) meta.push(`média geral ${fmt1(alvo.media_geral)}`);
  if (alvo.escola) meta.push(`${alvo.escola.dependencia_nome} · ${alvo.escola.municipio} · INEP ${alvo.escola.chave}`);
  meta.push("rede pública");
  $("#ent-meta").textContent = meta.join(" · ");

  desenharRadares(CTX);
  desenharAlunos(alvo);
  desenharDistribuicao(CTX, alvo);
}

/* ---------- boot ---------------------------------------------------------- */
(async () => {
  const [nreAgg, nreToMuns, muns, ufEnt, hist] = await Promise.all([
    fetch("data/nre_agg.json").then((r) => r.ok ? r.json() : null),
    fetch("data/nre_to_muns.json").then((r) => r.ok ? r.json() : {}),
    fetch(`api/municipios/${LOCK_UF}.json`).then((r) => r.ok ? r.json() : null),
    fetch(`api/entidade/UF/${LOCK_UF}.json`).then((r) => r.ok ? r.json() : null),
    fetch("data/hist_nota_pr.json").then((r) => r.ok ? r.json() : null),
  ]);
  NRE_AGG = nreAgg;
  NRE_TO_MUNS = nreToMuns || {};
  MUNS_ALL = muns?.PUB || [];
  UF_ALVO = ufEnt?.PUB?.resumo?.alvo || null;
  HIST = hist?.por_rede?.PUB || null;

  $("#sel-nre").innerHTML = `<option value="">Todos (PR inteiro)</option>` +
    Object.keys(NRE_TO_MUNS).sort().map((n) => `<option value="${n}">${n}</option>`).join("");
  if (state.nre) $("#sel-nre").value = state.nre;

  fillSelect($("#sel-mun"), state.nre ? municipiosDoNRE(state.nre) : MUNS_ALL,
             "Todos os municípios", "chave", "nome");
  if (state.mun) {
    $("#sel-mun").value = state.mun;
    setEscolas(await carregarEscolasDoMun(state.mun));
    if (state.esc) {
      const e = escolasMun.find((x) => String(x.chave) === String(state.esc));
      if (e) inpEsc.value = e.rotulo;
    }
  }
  await refresh();
})();
