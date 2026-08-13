/* Mapa coroplético — variante Paraná (pr2) com drill-down NRE → Município.
 *
 * Nível 1 (NRE): choropleth dos 32 NREs a partir de data/nre_pr.geojson +
 *                data/nre_agg.json. Clique num NRE abre os municípios dele.
 * Nível 2 (MUN): subset de data/mun_pr.geojson filtrado por properties.nre.
 *                Dados dos municípios vêm de api/municipios/PR.json[rede],
 *                cross-ref pelo NRE_TO_MUNS.
 * Nível 3 (MUN individual): só o painel lateral muda — carrega KPIs +
 *                histograma + top escolas do município. O mapa permanece
 *                no nível 2 destacando o município. */

const LOCK_UF = window.LOCK_UF || "PR";
const LOCK_UF_NOME = window.LOCK_UF_NOME || "Paraná";

const METRICAS = {
  media_geral: "Média geral", media_lc: "Linguagens",
  media_ch: "Humanas", media_cn: "Natureza", media_mt: "Matemática",
};
const CAMPO_METRICA = {
  media_geral: "geral", media_lc: "lc", media_ch: "ch",
  media_cn: "cn", media_mt: "mt",
};
const COR_CLARA = "#fdeef7", COR_ESCURA = "#b00073", SEM_DADOS = "#e9e5d4";
const W = 640, H = 600;
const $ = (s) => document.querySelector(s);
const fmt0 = (v) => (v == null ? "–" : Math.round(v).toLocaleString("pt-BR"));
const fmtInt = (v) => (v == null ? "–" : (+v).toLocaleString("pt-BR"));

const globais = window.Filtros ? window.Filtros.carregar() : {};

let metrica = "media_geral";
let rede = globais.rede || "PUB";
let vista = { nivel: "NRE" };   // "NRE" | "MUN"
let dados = [];                 // dados do nível atual (NREs ou munis)
let porChave = {};              // chave (nome NRE ou cd municipio) → dados
let gPaths = null;
let chaveDe = null;

/* assets NRE — carregados uma vez no boot */
let NRE_AGG = null;             // { por_rede:{T,PUB,PRIV}, refs:{...} }
let NRE_GEO = null;             // FeatureCollection dos 32 NREs
let MUN_GEO = null;             // FeatureCollection dos 399 munis (com prop `nre`)
let NRE_TO_MUNS = {};
let HIST_NOTA = null;           // hist_nota por (rede, "NRE/x"|"MUN/x"|"UF/PR")

const tip = $("#map-tip");
const wrap = $("#mapa-wrap");

async function j(url) { return fetch(url).then((r) => r.ok ? r.json() : null); }

/* ============================================================ mapa ======= */
function desenha(features, aoClicar, rotulo) {
  wrap.innerHTML = "";
  const svg = d3.select(wrap).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%")
    .attr("role", "img");
  const fc = { type: "FeatureCollection", features };
  const path = d3.geoPath(d3.geoMercator().fitSize([W, H], fc));

  gPaths = svg.append("g").selectAll("path")
    .data(features).join("path")
    .attr("d", path)
    .attr("stroke", "#3b142a")
    .attr("stroke-width", vista.nivel === "NRE" ? 0.7 : 0.4)
    .style("cursor", "pointer")
    .on("mousemove", (ev, d) => {
      const r = porChave[chaveDe(d)];
      tip.hidden = false;
      const linhaN = r && r.n_lc != null
        ? `${fmtInt(r.n_lc)} fizeram 1º dia · ${fmtInt(r.n_mt || 0)} fizeram 2º dia`
        : r ? `${fmtInt(r.n_participantes)} concluintes` : "";
      tip.innerHTML = r
        ? `<b>${r.nome}</b>
           ${METRICAS[metrica]}: <b style="color:var(--lime)">${fmt0(r[metrica])}</b><br>
           <span style="color:var(--rose)">${linhaN}</span>
           <span class="tip-cta">${vista.nivel === "NRE"
             ? "Clique para abrir os municípios →"
             : "Clique para ver detalhes →"}</span>`
        : `<b>${rotulo(d)}</b>Sem dados na rede selecionada.`;
      tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - 350)}px`;
      tip.style.top = `${ev.clientY + 14}px`;
    })
    .on("mouseleave", () => { tip.hidden = true; })
    .on("click", (ev, d) => { tip.hidden = true; aoClicar(d); });

  // rótulos: nome do NRE (nível 1) ou município (nível 2), quando cabem
  const labelFor = vista.nivel === "NRE"
    ? (d) => (d.properties.nome || "").split(/[\s\-]/)[0]
    : (d) => d.properties.nome || "";
  const minArea = vista.nivel === "NRE" ? 700 : 250;
  const fontSize = vista.nivel === "NRE" ? 9 : 8;
  svg.append("g").selectAll("text")
    .data(features).join("text")
    .attr("transform", (d) => `translate(${path.centroid(d)})`)
    .attr("text-anchor", "middle").attr("dy", "0.35em")
    .style("font", `700 ${fontSize}px 'DM Sans', sans-serif`)
    .style("fill", "#3b142a")
    .style("stroke", "rgba(255,253,245,0.85)")
    .style("stroke-width", "2.5px")
    .style("stroke-linejoin", "round")
    .style("paint-order", "stroke")
    .style("pointer-events", "none")
    .text((d) => path.area(d) > minArea ? labelFor(d).slice(0, 14) : "");
}

function pinta() {
  const vals = dados.map((d) => +d[metrica]).filter(Boolean);
  const [mn, mx] = [Math.min(...vals), Math.max(...vals)];
  const cor = d3.scaleLinear().domain([mn, mx])
    .range([COR_CLARA, COR_ESCURA]).interpolate(d3.interpolateLab);

  gPaths?.transition().duration(400).attr("fill", (d) => {
    const r = porChave[chaveDe(d)];
    return r && r[metrica] ? cor(+r[metrica]) : SEM_DADOS;
  });

  $("#leg-min").textContent = fmt0(mn);
  $("#leg-max").textContent = fmt0(mx);
  $(".leg-grad").style.background = `linear-gradient(90deg, ${COR_CLARA}, ${COR_ESCURA})`;

  $("#rank-titulo").textContent = vista.nivel === "NRE"
    ? `NREs · ${METRICAS[metrica]}` : `Municípios · ${METRICAS[metrica]}`;
  const incluiPequenos = $("#chk-minn").checked;
  const nPresentes = (d) => d.n_lc != null ? +d.n_lc : +d.n_participantes;
  const ord = [...dados].filter((d) => d[metrica] &&
      (incluiPequenos || nPresentes(d) >= 30))
    .sort((a, b) => b[metrica] - a[metrica]);
  const conc = (r) => {
    const n = nPresentes(r);
    return `${n.toLocaleString("pt-BR")} fizeram a prova`;
  };
  $("#ranking").innerHTML = ord.map((r, i) => {
    const onclick = vista.nivel === "NRE"
      ? `event.preventDefault(); abreNREDrill('${r.chave}')`
      : `event.preventDefault(); abreMunicipio('${r.chave}')`;
    return `<a class="rank-row" href="#" onclick="${onclick}">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-uf" title="${r.nome} · ${conc(r)}">
        ${r.nome}<small>${conc(r)}</small>
      </span>
      <span class="rank-bar"><span style="width:${
        Math.max(5, ((r[metrica] - mn) / (mx - mn || 1)) * 100)}%;
        background:${cor(+r[metrica])}"></span></span>
      <span class="rank-val">${fmt0(r[metrica])}</span>
    </a>`;
  }).join("");
}

/* ============================================================ vistas ==== */
async function abreParana() {
  vista = { nivel: "NRE" };
  $("#mapa-titulo").textContent = `${LOCK_UF_NOME} · NREs`;
  $("#btn-brasil").hidden = true;
  history.replaceState(null, "", "mapa.html");

  const celulas = NRE_AGG?.por_rede?.[rede]?.celulas || {};
  dados = Object.entries(celulas).map(([nome, cel]) => ({
    chave: nome, nome, ...cel,
  }));
  porChave = Object.fromEntries(dados.map((d) => [d.chave, d]));
  chaveDe = (d) => d.properties.nome;

  desenha(NRE_GEO.features,
    (d) => abreNREDrill(d.properties.nome),
    (d) => d.properties.nome);
  pinta();
  await carregarDetalhesEstado();
}

async function abreNREDrill(nre) {
  vista = { nivel: "MUN", nre };
  $("#mapa-titulo").textContent = `${nre} · municípios`;
  $("#btn-brasil").hidden = false;
  $("#btn-brasil").textContent = `← ${LOCK_UF_NOME}`;
  history.replaceState(null, "", `mapa.html?nre=${encodeURIComponent(nre)}`);
  wrap.innerHTML = `<div class="skeleton">Carregando municípios de ${nre}…</div>`;

  const featuresNRE = MUN_GEO.features.filter(
    (f) => f.properties.nre === nre);
  const cdsSet = new Set(featuresNRE.map((f) => String(f.properties.codarea)));

  // dados dos municípios do PR na rede corrente
  const todosMuns = (await j(`api/municipios/${LOCK_UF}.json`))?.[rede] || [];
  dados = todosMuns.filter((m) => cdsSet.has(String(m.chave)));
  porChave = Object.fromEntries(dados.map((d) => [String(d.chave), d]));
  chaveDe = (d) => String(d.properties.codarea);

  desenha(featuresNRE,
    (d) => {
      const r = porChave[chaveDe(d)];
      if (r) abreMunicipio(r.chave);
    },
    (d) => `Município ${d.properties.codarea}`);
  pinta();
  await carregarDetalhesNRE(nre);
}

async function abreMunicipio(chave) {
  const r = porChave[String(chave)];
  const nome = r ? r.nome : `Município ${chave}`;
  await carregarDetalhesMUN({ nivel: "MUN", chave: String(chave), nome });
}

window.abreNREDrill = abreNREDrill;
window.abreMunicipio = abreMunicipio;

/* ============================================================ detalhes == */
function REDE_TXT() {
  return { T: "todas as redes", PUB: "rede pública", PRIV: "rede privada" }[rede];
}

async function carregarDetalhesEstado() {
  const ref = NRE_AGG?.refs?.[rede]?.[LOCK_UF];
  if (!ref) {
    $("#det-titulo").textContent = LOCK_UF_NOME;
    $("#det-kpis").innerHTML = `<div class="skeleton">Sem dados na ${REDE_TXT()}.</div>`;
    $("#card-hist").hidden = true;
    $("#top-esc-body").innerHTML = "";
    return;
  }
  $("#det-titulo").textContent = LOCK_UF_NOME;
  $("#det-sub").textContent = REDE_TXT();
  renderKpis({ ...ref, nivel: "UF", chave: LOCK_UF }, "UF", LOCK_UF);
  // histograma + top escolas do PR inteiro
  const ent = await j(`api/entidade/UF/${LOCK_UF}.json`);
  const bloco = ent?.[rede];
  await renderHistograma(bloco?.hist_nota, LOCK_UF_NOME,
    { nivel: "UF", chave: LOCK_UF, nome: LOCK_UF_NOME });
  await renderTopEscolas({ nivel: "UF", chave: LOCK_UF, nome: LOCK_UF_NOME });
}

async function carregarDetalhesNRE(nre) {
  const cel = NRE_AGG?.por_rede?.[rede]?.celulas?.[nre];
  $("#det-titulo").textContent = `NRE ${nre}`;
  $("#det-sub").textContent = REDE_TXT();
  if (!cel) {
    $("#det-kpis").innerHTML = `<div class="skeleton">Sem dados na ${REDE_TXT()}.</div>`;
    $("#card-hist").hidden = true;
    $("#top-esc-body").innerHTML = "";
    return;
  }
  renderKpis({ ...cel, nivel: "NRE", chave: nre, nome: `NRE ${nre}` }, "NRE", nre);
  const histNRE = HIST_NOTA?.por_rede?.[rede]?.[`NRE/${nre}`] || null;
  await renderHistograma(histNRE, `NRE ${nre}`,
    { nivel: "NRE", chave: nre, nome: `NRE ${nre}` });
  await renderTopEscolasNRE(nre);
}

async function renderTopEscolasNRE(nre) {
  $("#top-esc-titulo").textContent = `Top escolas · NRE ${nre}`;
  $("#top-esc-body").innerHTML =
    `<div class="skeleton" style="padding:12px">Carregando…</div>`;
  const cds = NRE_TO_MUNS[nre] || [];
  const listas = await Promise.all(cds.map((cd) =>
    j(`api/top_escolas/MUN/${cd}.json`).then((d) => (d && d[rede]) || [])));
  const escolas = listas.flat()
    .filter((e) => e && e.media_geral != null)
    .sort((a, b) => b.media_geral - a.media_geral);
  if (!escolas.length) {
    $("#top-esc-body").innerHTML =
      `<div class="skeleton" style="padding:12px">Nenhuma escola na ${REDE_TXT()}.</div>`;
    return;
  }
  const linhas = escolas.slice(0, 10).map((e, i) => {
    const rot = e.nome || `Escola INEP ${e.chave}`;
    const dep = e.dependencia_nome ? ` · ${e.dependencia_nome}` : "";
    const loc = e.municipio ? ` · ${e.municipio}` : "";
    return `<a class="top-esc-row"
              href="index.html?mun=${e.co_municipio || ""}&esc=${e.chave}"
              title="${rot}${dep}${loc}">
      <span class="rank-pos">${i + 1}</span>
      <span class="top-esc-nome">
        ${rot}<small>${dep}${loc} · ${fmtInt(e.n_lc != null ? e.n_lc : e.n_participantes)} fizeram a prova</small>
      </span>
      <span class="top-esc-val">${fmt0(e.media_geral)}</span>
    </a>`;
  }).join("");
  // sem link "ver todas": a página de ranking foi substituída por "Sua
  // Escola", que não lista escolas (ver ESTADO.md).
  $("#top-esc-body").innerHTML = linhas;
}

async function carregarDetalhesMUN(alvo) {
  try {
    const { nivel, chave, nome } = alvo;
    $("#det-titulo").textContent = nome;
    $("#det-sub").textContent = REDE_TXT();
    $("#det-kpis").innerHTML = `<div class="skeleton">Carregando…</div>`;
    $("#card-hist").hidden = true;
    $("#top-esc-body").innerHTML =
      `<div class="skeleton" style="padding:12px">Carregando…</div>`;

    const ent = await j(`api/entidade/${nivel}/${chave}.json`);
    if (!ent) {
      $("#det-kpis").innerHTML = `<div class="skeleton">Sem dados.</div>`;
      $("#top-esc-body").innerHTML = "";
      return;
    }
    const bloco = ent[rede];
    const alvoResumo = bloco?.resumo?.alvo;
    if (!alvoResumo) {
      $("#det-kpis").innerHTML =
        `<div class="skeleton">Sem dados na ${REDE_TXT()}.</div>`;
      $("#top-esc-body").innerHTML = "";
      return;
    }
    renderKpis(alvoResumo, nivel, chave);
    // hist_nota MUN não vem do banco (só BR/UF). Usa HIST_NOTA (PR-específico).
    const histMun = bloco?.hist_nota
      || HIST_NOTA?.por_rede?.[rede]?.[`MUN/${chave}`]
      || null;
    await renderHistograma(histMun, nome, alvo);
    await renderTopEscolas(alvo);
  } catch (err) {
    console.error("carregarDetalhesMUN:", err);
    $("#det-kpis").innerHTML =
      `<div class="skeleton" style="color:var(--red-bad)">Erro: ${err.message}</div>`;
    $("#top-esc-body").innerHTML = "";
  }
}

function renderKpis(alvo, nivel, chave) {
  const el = $("#det-kpis");
  const linkPainel = nivel === "UF"
    ? `index.html`
    : nivel === "NRE"
      ? `index.html?nre=${encodeURIComponent(chave)}`
      : `index.html?mun=${chave}`;

  el.innerHTML = `
    <div class="det-n">
      <div class="det-n-val">${fmtInt(alvo.n_lc != null ? alvo.n_lc : alvo.n_participantes)}</div>
      <div class="det-n-lbl">${alvo.n_lc != null ? "fizeram o 1º dia · " + fmtInt(alvo.n_mt) + " fizeram o 2º" : "concluintes com escola em 2025"} · ${REDE_TXT()}</div>
    </div>
    <div class="det-medias">
      ${[
        ["Média geral", "media_geral", "var(--pink)"],
        ["Linguagens",  "media_lc",    "var(--lilac)"],
        ["Humanas",     "media_ch",    "var(--peach)"],
        ["Natureza",    "media_cn",    "var(--mint)"],
        ["Matemática",  "media_mt",    "var(--lime)"],
      ].map(([nome, campo, cor]) => `
        <div class="det-m">
          <div class="det-m-lbl" style="border-left:3px solid ${cor}">${nome}</div>
          <div class="det-m-val">${fmt0(alvo[campo])}</div>
        </div>`).join("")}
    </div>
    <a class="det-cta" href="${linkPainel}">Abrir painel completo →</a>`;
}

let histBRcache = {};
async function renderHistograma(histAlvo, nomeAlvo, alvo) {
  if (!histAlvo) {
    $("#card-hist").hidden = true;
    return;
  }
  $("#card-hist").hidden = false;
  $("#hist-titulo").textContent =
    `Distribuição da nota · ${METRICAS[metrica]}`;
  if (!histBRcache[rede]) {
    const br = await j(`api/entidade/BR/BR.json`);
    histBRcache[rede] = br?.[rede]?.hist_nota || null;
  }
  const campo = CAMPO_METRICA[metrica];
  const distAlvo = histAlvo[campo] || {};
  const distBR = (histBRcache[rede] || {})[campo] || {};
  desenharHistograma(distAlvo, distBR, nomeAlvo);
  $("#hist-hint").innerHTML = `barras = ${nomeAlvo} · <span style="color:var(--lilac);font-weight:700">linha</span> = Brasil (mesma rede)`;
}

function desenharHistograma(dist, distRef, nomeAlvo) {
  const buckets = [];
  for (let b = 0; b <= 975; b += 25) buckets.push(b);
  const nAlvo = buckets.map((b) => dist[b] || 0);
  const totalAlvo = nAlvo.reduce((s, v) => s + v, 0);
  const pctAlvo = totalAlvo ? nAlvo.map((v) => v / totalAlvo) : nAlvo;

  const pctRef = distRef ? (() => {
    const nRef = buckets.map((b) => distRef[b] || 0);
    const t = nRef.reduce((s, v) => s + v, 0) || 1;
    return nRef.map((v) => v / t);
  })() : null;

  const maxY = Math.max(...pctAlvo, ...(pctRef || [0])) * 1.05 || 0.01;

  const W = 620, H = 240, padL = 44, padR = 12, padT = 12, padB = 30;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const bw = iw / buckets.length;
  const xFor = (i) => padL + i * bw;
  const yFor = (p) => padT + ih - (p / maxY) * ih;

  let grids = "";
  for (let i = 0; i <= 4; i++) {
    const yv = (maxY * i) / 4;
    const y = yFor(yv).toFixed(1);
    grids += `<line class="grid" x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}"/>
              <text class="axis" x="${padL-6}" y="${y}" text-anchor="end" dy="0.32em">${Math.round(yv*100)}%</text>`;
  }
  let xax = "";
  [0, 250, 500, 750, 1000].forEach((v) => {
    const ix = Math.round(v / 25);
    xax += `<text class="axis" x="${xFor(ix) + bw/2}" y="${H - padB + 16}" text-anchor="middle">${v}</text>`;
  });

  const bars = pctAlvo.map((p, i) => {
    const h = ih - (yFor(p) - padT);
    return `<rect class="h-bar" x="${xFor(i) + 1}" y="${yFor(p)}"
                  width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}"
                  data-bucket="${buckets[i]}" data-p="${p}"/>`;
  }).join("");
  let refPath = "";
  if (pctRef) {
    let d = "";
    pctRef.forEach((p, i) => {
      const cx = xFor(i) + bw / 2, cy = yFor(p);
      d += (i === 0 ? "M" : "L") + cx.toFixed(1) + " " + cy.toFixed(1);
    });
    refPath = `<path d="${d}" fill="none" stroke="var(--lilac)" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  $("#hist-body").innerHTML = `
    <div class="hist-wrap">
      <svg class="hist-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${grids}${xax}${bars}${refPath}
      </svg>
      <div class="hist-legend">
        <span class="hist-total">Total: ${fmtInt(totalAlvo)} concluintes</span>
      </div>
    </div>`;
}

/* -------- top escolas --------------------------------------------------- */
async function renderTopEscolas(alvo) {
  const { nivel, chave, nome } = alvo;
  $("#top-esc-titulo").textContent = `Top escolas · ${nome}`;
  const url = nivel === "UF" ? `api/top_escolas/UF/${chave}.json`
            : nivel === "MUN" ? `api/top_escolas/MUN/${chave}.json`
            : null;
  if (!url) {
    $("#top-esc-body").innerHTML = "";
    return;
  }
  const data = await j(url);
  const lst = (data && data[rede]) || [];
  if (!lst.length) {
    $("#top-esc-body").innerHTML =
      `<div class="skeleton" style="padding:12px">Nenhuma escola na ${REDE_TXT()}.</div>`;
    return;
  }
  const linhas = lst.slice(0, 10).map((e, i) => {
    const rot = e.nome || `Escola INEP ${e.chave}`;
    const dep = e.dependencia_nome ? ` · ${e.dependencia_nome}` : "";
    const loc = nivel === "UF" ? ` · ${e.municipio}` : "";
    return `<a class="top-esc-row"
              href="index.html?mun=${e.co_municipio || ""}&esc=${e.chave}"
              title="${rot}${dep}${loc}">
      <span class="rank-pos">${i + 1}</span>
      <span class="top-esc-nome">
        ${rot}<small>${dep}${loc} · ${fmtInt(e.n_lc != null ? e.n_lc : e.n_participantes)} fizeram a prova</small>
      </span>
      <span class="top-esc-val">${fmt0(e.media_geral)}</span>
    </a>`;
  }).join("");
  // idem: sem link "ver todas" desde a remoção do ranking.
  $("#top-esc-body").innerHTML = linhas;
}

/* ============================================================ handlers == */
$("#btn-brasil").addEventListener("click", () => abreParana());
$("#chk-minn").addEventListener("change", pinta);
// Sem handler de troca de rede: só "Pública" existe (ver ESTADO.md).
document.querySelectorAll("#tabs-metrica button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs-metrica button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    metrica = b.dataset.m;
    pinta();
    if (vista.nivel === "NRE") carregarDetalhesEstado();
    else carregarDetalhesNRE(vista.nre);
  });
});

/* ============================================================ boot ====== */
(async function main() {
  [NRE_AGG, NRE_GEO, MUN_GEO, NRE_TO_MUNS, HIST_NOTA] = await Promise.all([
    j("data/nre_agg.json"),
    j("data/nre_pr.geojson"),
    j("data/mun_pr.geojson"),
    j("data/nre_to_muns.json"),
    j("data/hist_nota_pr.json"),
  ]);
  // deep-link: mapa.html?nre=... ou ?mun=...
  const p = new URLSearchParams(location.search);
  const nreInicial = p.get("nre") || globais.nre;
  const munInicial = p.get("mun") || globais.mun;
  if (nreInicial && NRE_AGG?.por_rede?.[rede]?.celulas?.[nreInicial]) {
    await abreNREDrill(nreInicial);
    if (munInicial) await abreMunicipio(munInicial);
  } else {
    await abreParana();
  }
})();
