/* Habilidades críticas — tabela heatmap: linhas = habilidades, colunas =
 * anos + média + esperado TRI. Respeita filtros da URL (uf/mun/esc/rede).
 * Se sem filtro, mostra BR.
 */
const AREA_INFO = {
  LC: { nome: "Linguagens", cor: "var(--lilac)", chip: "LC" },
  CH: { nome: "Humanas",    cor: "var(--peach)", chip: "CH" },
  CN: { nome: "Natureza",   cor: "var(--mint)",  chip: "CN" },
  MT: { nome: "Matemática", cor: "var(--lime)",  chip: "MT" },
};
const ANOS = [2021, 2022, 2023, 2024, 2025];
const REDE_NOME = { PUB: "rede pública" };  // só existe essa opção agora

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const globais = window.Filtros ? window.Filtros.carregar() : {};
const LOCK_UF = window.LOCK_UF || "PR";
const state = {
  area: params.get("area") || "",
  sort_col: "delta",    // "area"|"h"|"desc"|"a0..a4"|"media"|"esperado"|"delta"
  sort_dir: "asc",      // "asc" | "desc"
  uf: LOCK_UF,
  nre: globais.nre || "",
  mun: globais.mun || "",
  esc: globais.esc || "",
  rede: globais.rede || "PUB",
  anos_ativos: new Set(ANOS),   // anos considerados no cálculo de média/esperado
};
// direção default por coluna: números começam "asc" (piores primeiro),
// texto começa "asc" (alfabético). Δ e média começam ascendente pra listar
// os mais críticos primeiro.
const SORT_DEFAULT_DIR = {
  area: "asc", h: "asc", desc: "asc",
  a0: "asc", a1: "asc", a2: "asc", a3: "asc", a4: "asc",
  media: "asc", esperado: "asc", delta: "asc",
};

function nivelChave() {
  if (state.esc) return { nivel: "ESC", chave: state.esc };
  if (state.mun) return { nivel: "MUN", chave: state.mun };
  if (state.nre) return { nivel: "NRE", chave: state.nre };
  return { nivel: "UF",  chave: state.uf };
}

/* mapa NRE → [cd_municipio] carregado no boot pra agregação client-side */
let NRE_TO_MUNS = {};
const LOCK_UF_NOME = window.LOCK_UF_NOME || "Paraná";
function rotuloAlvo() {
  const partes = [];
  // nome amigável, não o código: reaproveita o texto já selecionado nos
  // campos (option do <select>, ou o valor digitado no combo de escola) em
  // vez de refazer uma chamada só pra resolver nome — os dois já refletem a
  // seleção corrente sempre que render() roda.
  if (state.esc) {
    const rotulo = $("#inp-esc")?.value;
    partes.push(rotulo ? rotulo : `Escola INEP ${state.esc}`);
  } else if (state.mun) {
    const opt = $("#sel-mun")?.selectedOptions?.[0];
    partes.push(opt && opt.value === state.mun ? opt.textContent : `Município ${state.mun}`);
  } else if (state.nre) {
    partes.push(`NRE ${state.nre}`);
  } else {
    partes.push(LOCK_UF_NOME);
  }
  partes.push(REDE_NOME[state.rede]);
  return partes.join(" · ");
}

let habIndex = null;   // api/habilidades/index.json (descrições + habilidades cobrando)
let dataAlvo = null;   // computação {area: {h: {anos:[5], media, esp}}}
let ultimasLinhas = [];   // linhas do último render(), na ordem em tela — usado pelo export Excel

/* ----------- fetches --------------------------------------------------- */
async function carregarDados() {
  habIndex = await fetch("api/habilidades/index.json").then((r) => r.json());
  const { nivel, chave } = nivelChave();

  // NRE: agrega client-side os municípios do NRE
  if (nivel === "NRE") return await carregarNRE(chave);

  // ESC: puxa historico/ESC/{inep}.json (gerado por pipeline/build_historico_esc_pr.py).
  // Se faltar, fallback pro PR com aviso.
  if (nivel === "ESC") {
    const hist = await fetch(`api/historico/ESC/${chave}.json`).then((r) => r.ok ? r.json() : null);
    if (!hist) return await carregarUF();
    return computarDeHistorico(hist);
  }

  const hist = await fetch(`api/historico/${nivel}/${chave}.json`).then((r) => r.ok ? r.json() : null);
  if (!hist) return await carregarUF();
  return computarDeHistorico(hist);
}
async function carregarUF() {
  const hist = await fetch(`api/historico/UF/${state.uf}.json`).then((r) => r.ok ? r.json() : null);
  if (!hist) throw new Error("historico UF/PR ausente");
  return computarDeHistorico(hist);
}

/* Agrega client-side o histórico dos munis do NRE.
 * Consolida por_ano[ano][area] concatenando as 7-tuplas dos municípios;
 * o computarDeHistorico faz a média ponderada por n como sempre. */
async function carregarNRE(nre) {
  const cds = NRE_TO_MUNS[nre] || [];
  if (!cds.length) return await carregarUF();
  const results = await Promise.all(cds.map((cd) =>
    fetch(`api/historico/MUN/${cd}.json`).then((r) => r.ok ? r.json() : null)));
  const merged = { [state.rede]: { por_ano: {} } };
  for (const h of results) {
    const bloco = h?.[state.rede]?.por_ano;
    if (!bloco) continue;
    for (const [ano, areas] of Object.entries(bloco)) {
      merged[state.rede].por_ano[ano] = merged[state.rede].por_ano[ano] || {};
      for (const [area, rows] of Object.entries(areas)) {
        merged[state.rede].por_ano[ano][area] =
          (merged[state.rede].por_ano[ano][area] || []).concat(rows);
      }
    }
  }
  return computarDeHistorico(merged);
}

/* Agrega itens da 7-tupla [item, n, p, p_esp, hab, param_b, tp_lingua] em
 * médias ponderadas por (area, habilidade, ano). Também acumula esperado
 * pelo mesmo n. */
function computarDeHistorico(hist) {
  const rede = state.rede;
  const out = { LC: {}, CH: {}, CN: {}, MT: {} };
  for (const area of Object.keys(out)) {
    for (const h of Object.keys(habIndex.areas[area] || {})) {
      out[area][h] = { anos: ANOS.map(() => null), esp: ANOS.map(() => null),
                        n: ANOS.map(() => 0) };
    }
  }
  for (let i = 0; i < ANOS.length; i++) {
    const ano = ANOS[i];
    const bloco = hist?.[rede]?.por_ano?.[String(ano)];
    if (!bloco) continue;
    for (const area of Object.keys(out)) {
      const lst = bloco[area] || [];
      const agg = {};   // hab → {sn, sp, se}
      for (const [, n, p, p_esp, hab] of lst) {
        if (hab == null || !n) continue;
        const a = agg[hab] || { sn: 0, sp: 0, se: 0, ne: 0 };
        a.sn += n;
        if (p != null) a.sp += p * n;
        if (p_esp != null) { a.se += p_esp * n; a.ne += n; }
        agg[hab] = a;
      }
      for (const [hab, a] of Object.entries(agg)) {
        if (!out[area][hab]) continue;
        out[area][hab].anos[i] = a.sn ? a.sp / a.sn : null;
        out[area][hab].esp[i] = a.ne ? a.se / a.ne : null;
        out[area][hab].n[i] = a.sn;
      }
    }
  }
  // agregações finais (média/esperado/delta) ficam a cargo de agregar(),
  // pra respeitar o filtro de anos ativos sem precisar refazer o fetch.
  return out;
}

/* Recalcula média/esperado/delta considerando somente state.anos_ativos.
 * É chamado no render — não é preciso refetch quando muda a seleção. */
function agregar(cell) {
  let sn = 0, sp = 0, se = 0, sne = 0;
  cell.anos.forEach((p, i) => {
    if (!state.anos_ativos.has(ANOS[i])) return;
    const n = cell.n[i];
    if (p != null && n) { sn += n; sp += p * n; }
    if (cell.esp[i] != null && n) { sne += n; se += cell.esp[i] * n; }
  });
  const media = sn ? sp / sn : null;
  const esperado = sne ? se / sne : null;
  const delta = (media != null && esperado != null) ? media - esperado : null;
  return { media, esperado, delta };
}

/* ----------- coloração --------------------------------------------------- */
function corAcerto(p) {
  if (p == null) return "transparent";
  // escala vermelho → amarelo → verde-lima (verde tipo Wayground)
  // p em [0..1], centrada em 0.5
  const t = Math.max(0, Math.min(1, p));
  const r1 = [255, 143, 143], y = [251, 235, 132], g = [187, 227, 138];
  const mix = (a, b, k) => `rgb(${Math.round(a[0] + (b[0]-a[0])*k)},${Math.round(a[1] + (b[1]-a[1])*k)},${Math.round(a[2] + (b[2]-a[2])*k)})`;
  if (t < 0.5) return mix(r1, y, t / 0.5);
  return mix(y, g, (t - 0.5) / 0.5);
}
function corDelta(d) {
  if (d == null) return "transparent";
  // arredondado a 0 pp → neutro (nem lacuna nem força)
  if (Math.abs(d * 100) < 0.5) return "var(--ink-06)";
  // divergente centrado em 0 (± 15pp = saturado)
  const t = Math.min(1, Math.abs(d) / 0.15);
  const base = d >= 0 ? [187, 227, 138] : [255, 143, 143];
  const alfa = 0.20 + t * 0.80;
  return `rgba(${base[0]},${base[1]},${base[2]},${alfa.toFixed(2)})`;
}

/* ----------- células e linha (compartilhado entre tela e PDF) ------------ */
function cel(p, extraCls = "") {
  if (p == null) return `<td class="crit-cel-vazio ${extraCls}">—</td>`;
  const pct = Math.round(p * 100);
  return `<td class="crit-cel ${extraCls}" style="background:${corAcerto(p)}">${pct}%</td>`;
}
function celEsp(p) {
  if (p == null) return `<td class="crit-cel-vazio crit-col-esp">—</td>`;
  const pct = Math.round(p * 100);
  return `<td class="crit-cel crit-col-esp" style="background:${corAcerto(p)}">${pct}%</td>`;
}
function celAno(p, i) {
  const inativo = !state.anos_ativos.has(ANOS[i]) ? "crit-ano-inativo" : "";
  return cel(p, inativo);
}
function celDelta(l) {
  if (l.delta == null) return `<td class="crit-cel-vazio">—</td>`;
  const pp = l.delta * 100;
  const arr = Math.round(pp);
  const sign = arr > 0 ? "+" : arr < 0 ? "−" : "";
  return `<td class="crit-cel crit-delta" style="background:${corDelta(l.delta)}">${sign}${Math.abs(arr)} pp</td>`;
}
function linhaHtml(l) {
  const info = AREA_INFO[l.area];
  const desc = l.desc.length > 80 ? l.desc.slice(0, 78) + "…" : l.desc;
  const linkQs = new URLSearchParams({
    area: l.area, h: l.h,
    ...(state.uf ? { uf: state.uf } : {}),
    ...(state.mun ? { mun: state.mun } : {}),
    ...(state.esc ? { esc: state.esc } : {}),
    ...(state.rede !== "T" ? { rede: state.rede } : {}),
  }).toString();
  return `<tr>
    <td class="crit-col-area"><span class="chip-area-tag" style="background:${info.cor}">${info.chip}</span></td>
    <td class="crit-col-h"><a class="chip-hab" href="habilidade.html?${linkQs}" target="_blank">H${l.h}</a></td>
    <td class="crit-col-desc" title="${l.desc.replace(/"/g,"&quot;")}">${desc}</td>
    ${l.anos.map(celAno).join("")}
    ${cel(l.media)}
    ${celEsp(l.esperado)}
    ${celDelta(l)}
  </tr>`;
}

/* Ordena uma cópia da lista pela coluna/direção correntes (mesma lógica que
 * os cliques no <th> já usam). Reaproveitada pela tabela em tela e por cada
 * mini-tabela do PDF, pra manter o critério de ordem que a pessoa escolheu
 * mesmo dentro de cada grupo de competência. */
const AREA_ORDER = ["LC", "CH", "CN", "MT"];
function ordenarLinhas(lista) {
  const col = state.sort_col;
  const dir = state.sort_dir === "desc" ? -1 : 1;
  function chave(l) {
    if (col === "area") return AREA_ORDER.indexOf(l.area) * 100 + l.h;
    if (col === "h") return l.h;
    if (col === "desc") return (l.desc || "").toLowerCase();
    if (col.startsWith("a")) return l.anos[parseInt(col.slice(1), 10)];
    return l[col];
  }
  return [...lista].sort((a, b) => {
    const va = chave(a), vb = chave(b);
    const nullA = va == null || va === "";
    const nullB = vb == null || vb === "";
    if (nullA && nullB) return 0;
    if (nullA) return 1;
    if (nullB) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return va.localeCompare(vb, "pt-BR") * dir;
    }
    return (va - vb) * dir;
  });
}

/* PDF: mesmas linhas, agrupadas por área e depois por competência da Matriz
 * de Referência (window.COMPETENCIAS, de competencias.js) — pedido porque a
 * tabela única, plana, ficava longa demais pra ler de um jeito organizado.
 * Dentro de cada competência, mantém a ordenação escolhida na tela. */
function montarPrintAgrupado(linhas) {
  const areasOrdem = state.area ? [state.area] : AREA_ORDER;
  const theadHtml = document.getElementById("crit-thead").outerHTML;
  let html = "";
  for (const area of areasOrdem) {
    const porArea = linhas.filter((l) => l.area === area);
    if (!porArea.length) continue;
    html += `<h4 class="print-area-tit" style="border-color:${AREA_INFO[area].cor}">${AREA_INFO[area].nome}</h4>`;
    const comps = window.COMPETENCIAS?.[area] || [];
    for (const c of comps) {
      const porComp = ordenarLinhas(porArea.filter((l) => c.hs.includes(l.h)));
      if (!porComp.length) continue;
      html += `<h5 class="print-comp-tit">Competência ${c.n} · ${c.titulo}</h5>
        <table class="tbl crit-tabela print-tabela-comp">
          <thead>${theadHtml}</thead>
          <tbody>${porComp.map(linhaHtml).join("")}</tbody>
        </table>`;
    }
  }
  return html;
}

/* ----------- render ----------------------------------------------------- */
function render() {
  if (!dataAlvo || !habIndex) return;
  const alvoTxt = rotuloAlvo();
  const alvoEl = document.getElementById("crit-alvo");
  alvoEl.innerHTML = `Analisando: <b>${alvoTxt}</b>`;
  alvoEl.hidden = false;

  const areas = state.area ? [state.area] : AREA_ORDER;
  const linhas = [];
  for (const area of areas) {
    const cells = habIndex.areas[area] || {};
    for (const [h, info] of Object.entries(cells)) {
      const cell = dataAlvo[area]?.[h];
      if (!cell) continue;
      const agg = agregar(cell);
      linhas.push({
        area, h: parseInt(h, 10), desc: info.desc || "",
        anos: cell.anos, media: agg.media, esperado: agg.esperado, delta: agg.delta,
      });
    }
  }

  const linhasOrdenadas = ordenarLinhas(linhas);

  // atualiza indicadores nos <th>
  const dir = state.sort_dir === "desc" ? -1 : 1;
  document.querySelectorAll("#crit-thead th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === state.sort_col) th.classList.add(dir === 1 ? "sort-asc" : "sort-desc");
  });

  // sumário
  $("#crit-resumo").innerHTML = `${linhas.length} habilidades no grupo`;

  // atualiza rótulo da coluna Média conforme anos ativos
  const anosSel = ANOS.filter((a) => state.anos_ativos.has(a));
  let anosLbl;
  if (anosSel.length === ANOS.length) {
    anosLbl = "2021 – 2025";
  } else if (anosSel.length === 1) {
    anosLbl = String(anosSel[0]);
  } else if (anosSel.length && anosSel[anosSel.length-1] - anosSel[0] === anosSel.length - 1) {
    anosLbl = `${anosSel[0]} – ${anosSel[anosSel.length-1]}`;
  } else {
    anosLbl = anosSel.join(" · ");
  }
  const lblMed = $("#crit-media-lbl");
  if (lblMed) lblMed.textContent = anosLbl;

  // resumo estático do PDF — a data/hora só é preenchida no clique do botão,
  // pra refletir quando o relatório foi de fato gerado, não quando a página
  // carregou. O resto (alvo, área, anos, contagem) já muda a cada render().
  const areaNome = state.area ? AREA_INFO[state.area].nome : "Todas as áreas";
  const filtrosEl = $("#crit-print-filtros");
  if (filtrosEl) {
    filtrosEl.textContent =
      `${alvoTxt} · ${areaNome} · anos ${anosLbl} · ${linhas.length} habilidades`;
  }

  // tabela em tela: plana, ordenável por qualquer coluna — inalterada
  document.getElementById("crit-tbody").innerHTML = linhasOrdenadas.map(linhaHtml).join("");

  // PDF: mesmas linhas, agrupadas por área/competência
  const printEl = $("#crit-print-agrupado");
  if (printEl) printEl.innerHTML = montarPrintAgrupado(linhas);

  // guarda a ordem em tela pro export Excel (mesmo filtro, mesma ordenação)
  ultimasLinhas = linhasOrdenadas;
}

/* ----------- export Excel (CSV) ------------------------------------------ */
// ";" como separador e BOM UTF-8 porque o Excel em pt-BR abre assim direto,
// sem passar pelo assistente de importação (mesma convenção já usada no CSV
// de escolas/NRE gerado antes). Vira número puro (sem "%") pra continuar
// somável/filtrável na planilha; unidade vai no cabeçalho da coluna.
function csvCel(v) {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function slug(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
function baixarExcel(linhas, alvoTxt) {
  const pct = (p) => (p == null ? "" : Math.round(p * 100));
  const pp = (d) => (d == null ? "" : Math.round(d * 100));
  const header = [
    "Área", "Habilidade", "Descrição",
    "2021 (%)", "2022 (%)", "2023 (%)", "2024 (%)", "2025 (%)",
    "Média (%)", "Esperado TRI (%)", "Δ vs esperado (pp)",
  ];
  const linhasCsv = linhas.map((l) => [
    l.area, `H${l.h}`, l.desc,
    ...l.anos.map(pct),
    pct(l.media), pct(l.esperado), pp(l.delta),
  ]);
  const csv = "\uFEFF" + [header, ...linhasCsv]
    .map((row) => row.map(csvCel).join(";"))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analise_habilidades_${slug(alvoTxt)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ----------- handlers --------------------------------------------------- */
// "Baixar PDF" abre o diálogo de impressão do navegador (destino "Salvar como
// PDF") em vez de gerar o arquivo em JS — sem dependência externa, e a tabela
// já está inteira no DOM (sem paginação/virtualização), então o que sai no
// PDF é exatamente o filtro em tela. Ver @media print em styles.css.
$("#btn-pdf").addEventListener("click", () => {
  const el = $("#crit-print-data");
  if (el) el.textContent = `Gerado em ${new Date().toLocaleString("pt-BR")}`;
  window.print();
});

// "Baixar Excel": mesma tabela em tela (mesmo filtro, mesma ordenação),
// como .csv com BOM+";" pra abrir direto no Excel em pt-BR.
$("#btn-excel").addEventListener("click", () => {
  baixarExcel(ultimasLinhas, rotuloAlvo());
});

// Sem handler de troca de rede: só "Pública" existe (ver ESTADO.md).
document.querySelectorAll("#crit-area button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#crit-area button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.area = b.dataset.area;
    atualizarURL();
    render();
  });
});
document.addEventListener("click", (e) => {
  const th = e.target.closest("#crit-thead th.sortable");
  if (!th) return;
  const col = th.dataset.sort;
  if (state.sort_col === col) {
    state.sort_dir = state.sort_dir === "asc" ? "desc" : "asc";
  } else {
    state.sort_col = col;
    state.sort_dir = SORT_DEFAULT_DIR[col] || "asc";
  }
  render();
});
/* toggle de anos ativos — clica pra excluir/incluir do cálculo de média/esp */
document.querySelectorAll("#crit-anos button").forEach((b) => {
  b.addEventListener("click", () => {
    const ano = parseInt(b.dataset.ano, 10);
    if (state.anos_ativos.has(ano)) {
      if (state.anos_ativos.size === 1) return;   // não deixa apagar todos
      state.anos_ativos.delete(ano);
      b.classList.remove("on");
    } else {
      state.anos_ativos.add(ano);
      b.classList.add("on");
    }
    // marca colunas do header
    document.querySelectorAll("#crit-thead th").forEach((th) => {
      const s = th.dataset.sort;
      if (!s || !s.startsWith("a")) return;
      const anoI = ANOS[parseInt(s.slice(1), 10)];
      th.classList.toggle("crit-th-inativo", !state.anos_ativos.has(anoI));
    });
    render();
  });
});

function atualizarURL() {
  const p = new URLSearchParams();
  if (state.nre)  p.set("nre", state.nre);
  if (state.mun)  p.set("mun", state.mun);
  if (state.esc)  p.set("esc", state.esc);
  if (state.rede !== "PUB") p.set("rede", state.rede);
  if (state.area) p.set("area", state.area);
  const qs = p.toString();
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  if (window.Filtros) window.Filtros.salvar({
    nre: state.nre, mun: state.mun, esc: state.esc, rede: state.rede,
  });
}

/* ----------- Seletores UF > MUN > ESC (idem ao painel) ------------------- */
async function apiJson(url) {
  return fetch(url).then((r) => r.ok ? r.json() : null);
}
async function apiUfs()        { return (await apiJson("api/ufs.json"))?.[state.rede] || []; }
async function apiMuns(uf)     { return (await apiJson(`api/municipios/${uf}.json`))?.[state.rede] || []; }
async function apiEscolas(mun) {
  const lst = (await apiJson(`api/escolas/${mun}.json`)) || [];
  if (state.rede === "T") return lst;
  return lst.filter((e) => state.rede === "PRIV" ? e.dependencia === 4 : e.dependencia !== 4);
}
function fillSelect(sel, itens, placeholder, valor, rotulo) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    itens.map((i) => `<option value="${i[valor]}">${i[rotulo]}</option>`).join("");
  sel.disabled = itens.length === 0;
}

async function initSelects() {
  // pr2: carrega mapa NRE → munis e popula dropdown de NRE
  NRE_TO_MUNS = await fetch("data/nre_to_muns.json").then((r) => r.ok ? r.json() : {});
  const nres = Object.keys(NRE_TO_MUNS).sort();
  $("#sel-nre").innerHTML =
    `<option value="">Todos (PR inteiro)</option>` +
    nres.map((n) => `<option value="${n}">${n}</option>`).join("");
  if (state.nre) $("#sel-nre").value = state.nre;

  const munsAll = await apiMuns(state.uf);
  const munsFiltrados = state.nre ? filtrarMunsPorNRE(munsAll, state.nre) : munsAll;
  fillSelect($("#sel-mun"), munsFiltrados, "Todos os municípios", "chave", "nome");
  if (state.mun) $("#sel-mun").value = state.mun;
  if (state.mun) {
    const escs = await apiEscolas(state.mun);
    montarEscolas(escs);
    if (state.esc) {
      const e = escolasMun.find((x) => String(x.chave) === String(state.esc));
      if (e) $("#inp-esc").value = e.rotulo;
    }
  }
}

function filtrarMunsPorNRE(muns, nre) {
  const cds = new Set((NRE_TO_MUNS[nre] || []).map(String));
  return muns.filter((m) => cds.has(String(m.chave)));
}

$("#sel-nre").addEventListener("change", async (e) => {
  state.nre = e.target.value;
  state.mun = ""; state.esc = "";
  const munsAll = await apiMuns(state.uf);
  const filtrados = state.nre ? filtrarMunsPorNRE(munsAll, state.nre) : munsAll;
  fillSelect($("#sel-mun"), filtrados, "Todos os municípios", "chave", "nome");
  montarEscolas([]);
  atualizarURL();
  await recarregarAlvo();
});

/* combobox de escolas — mesmo padrão do app.js */
let escolasMun = [];
function montarEscolas(escs) {
  escolasMun = escs.map((x) => ({
    chave: x.chave, rotulo: x.rotulo, n: x.n_participantes,
    busca: `${x.rotulo} ${x.chave}`.toLowerCase(),
  }));
  const inp = $("#inp-esc");
  inp.value = "";
  inp.disabled = !escolasMun.length;
  inp.placeholder = escolasMun.length
    ? `Digite para buscar entre ${escolasMun.length} escolas…`
    : "Digite para buscar…";
  $("#combo-list").hidden = true;
}
function renderCombo(filtro) {
  const q = filtro.trim().toLowerCase();
  const achadas = escolasMun.filter((e) => e.busca.includes(q)).slice(0, 50);
  const lst = $("#combo-list");
  lst.innerHTML = achadas.length
    ? achadas.map((e) =>
        `<button type="button" data-chave="${e.chave}">
           <span>${e.rotulo}</span><small>${e.n?.toLocaleString?.("pt-BR") || ""} alunos</small>
         </button>`).join("")
    : `<div class="combo-vazio">Nenhuma escola encontrada</div>`;
  lst.hidden = false;
}

/* pr2: sem #sel-uf — UF fixa em PR */
$("#sel-mun").addEventListener("change", async (e) => {
  state.mun = e.target.value; state.esc = "";
  if (state.mun) {
    const escs = await apiEscolas(state.mun);
    montarEscolas(escs);
  } else {
    montarEscolas([]);
  }
  atualizarURL();
  await recarregarAlvo();
});
$("#inp-esc").addEventListener("input", () => {
  if ($("#inp-esc").value === "" && state.esc) {
    state.esc = "";
    atualizarURL();
    recarregarAlvo();
  }
  renderCombo($("#inp-esc").value);
});
$("#inp-esc").addEventListener("focus", () => {
  if (escolasMun.length) renderCombo($("#inp-esc").value);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".combo")) $("#combo-list").hidden = true;
});
$("#combo-list").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.esc = b.dataset.chave;
  $("#inp-esc").value = escolasMun.find((x) => x.chave == state.esc)?.rotulo || "";
  $("#combo-list").hidden = true;
  atualizarURL();
  recarregarAlvo();
});
$("#btn-limpar").addEventListener("click", async () => {
  state.nre = state.mun = state.esc = "";
  $("#sel-nre").value = "";
  const munsAll = await apiMuns(state.uf);
  fillSelect($("#sel-mun"), munsAll, "Todos os municípios", "chave", "nome");
  montarEscolas([]);
  atualizarURL();
  await recarregarAlvo();
});

async function recarregarAlvo() {
  document.getElementById("crit-tbody").innerHTML =
    `<tr><td colspan="11" class="skeleton" style="padding:24px;text-align:center">Carregando…</td></tr>`;
  try {
    dataAlvo = await carregarDados();
    render();
  } catch (e) {
    console.error(e);
    document.getElementById("crit-tbody").innerHTML =
      `<tr><td colspan="11" class="skeleton" style="padding:24px;text-align:center;color:var(--red-bad)">
         Erro ao carregar dados desse grupo.
       </td></tr>`;
  }
}

/* aplica seleções da URL nos tabs */
document.querySelectorAll("#crit-rede button").forEach((x) => {
  x.classList.toggle("on", x.dataset.rede === state.rede);
});
if (state.area) {
  document.querySelectorAll("#crit-area button").forEach((x) => {
    x.classList.toggle("on", x.dataset.area === state.area);
  });
}

/* ----------- boot ------------------------------------------------------- */
(async () => {
  await initSelects();
  try {
    dataAlvo = await carregarDados();
    render();
  } catch (e) {
    console.error(e);
    document.getElementById("crit-tbody").innerHTML =
      `<tr><td colspan="11" class="skeleton" style="padding:24px;text-align:center;color:var(--red-bad)">
         Erro ao carregar dados. Verifique se o servidor está rodando e os JSONs em api/ existem.
       </td></tr>`;
  }
})();
