/* Mapa coroplético — variante Mato Grosso, em NÍVEL ÚNICO.
 *
 * O painel do Paraná tem dois níveis (NRE → município), porque aquele estado
 * organiza a educação em Núcleos Regionais. Mato Grosso não tem equivalente
 * no dado do ENEM, então este mapa já abre nos 141 municípios: clicar num
 * deles só troca o painel lateral — não há drill-down nem botão de voltar.
 *
 * Se um dia existir divisão regional de MT (polos/assessorias da SEDUC), o
 * caminho é gerar nre_agg.json, nre_to_muns.json e a malha das regionais no
 * mesmo formato do PR e trazer de volta as funções de drill-down do
 * pr2/mapa.js — o resto deste arquivo é idêntico ao de lá.
 *
 * Sem o card "Top escolas": o painel não compara escolas entre si no mapa
 * (removido no PR em 13/08); o ranking vive na sua própria página. */

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
let vista = { nivel: "MUN" };   // nível único em MT
let dados = [];                 // municípios da rede corrente
let porChave = {};              // cd_municipio → dados
let gPaths = null;
let chaveDe = null;

/* assets — carregados uma vez no boot */
let MUN_GEO = null;             // FeatureCollection dos municípios de MT
let UF_ENT = null;              // api/entidade/UF/MT.json (KPIs + hist do estado)
// HIST_NOTA não existe em MT: o arquivo hist_nota_pr.json é gerado por
// pipeline/build_hist_nota_pr.py, que varre o CSV bruto dos microdados. Sem
// ele, o histograma aparece no estado (vem de entidade/UF) e some no
// município — renderHistograma(null) esconde o card.
const HIST_NOTA = null;

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
    .attr("stroke-width", 0.45)
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
           <span class="tip-cta">Clique para ver detalhes →</span>`
        : `<b>${rotulo(d)}</b>Sem dados na rede selecionada.`;
      tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - 350)}px`;
      tip.style.top = `${ev.clientY + 14}px`;
    })
    .on("mouseleave", () => { tip.hidden = true; })
    .on("click", (ev, d) => { tip.hidden = true; aoClicar(d); });

  // Rótulo: nome do município, quando cabe na área desenhada.
  //
  // No painel do PR o nível de cima eram os 32 NREs, então bastava o corte por
  // área. Aqui são 141 municípios num mapa do mesmo tamanho e só o corte por
  // área ainda deixa os nomes empilhados uns sobre os outros no centro-sul.
  // Por isso, depois de ordenar do maior pro menor, um rótulo só entra se o
  // centróide dele estiver longe o bastante de todos os já colocados.
  const labelFor = (d) => d.properties.name || d.properties.nome || "";
  const minArea = 320;
  const fontSize = 8;
  const MAX_CHARS = 14;
  const larguraTexto = (t) => t.length * fontSize * 0.58;  // DM Sans 700, aprox.
  const colocados = [];
  const rotulados = features
    .filter((d) => path.area(d) > minArea && labelFor(d))
    .sort((a, b) => path.area(b) - path.area(a))
    .filter((d) => {
      const [x, y] = path.centroid(d);
      if (!isFinite(x) || !isFinite(y)) return false;
      const w = larguraTexto(labelFor(d).slice(0, MAX_CHARS)) / 2 + 2;
      const h = fontSize * 0.8;
      const caixa = [x - w, y - h, x + w, y + h];
      const bate = colocados.some((c) =>
        caixa[0] < c[2] && caixa[2] > c[0] && caixa[1] < c[3] && caixa[3] > c[1]);
      if (bate) return false;
      colocados.push(caixa);
      return true;
    });
  svg.append("g").selectAll("text")
    .data(rotulados).join("text")
    .attr("transform", (d) => `translate(${path.centroid(d)})`)
    .attr("text-anchor", "middle").attr("dy", "0.35em")
    .style("font", `700 ${fontSize}px 'DM Sans', sans-serif`)
    .style("fill", "#3b142a")
    .style("stroke", "rgba(255,253,245,0.85)")
    .style("stroke-width", "2.5px")
    .style("stroke-linejoin", "round")
    .style("paint-order", "stroke")
    .style("pointer-events", "none")
    .text((d) => labelFor(d).slice(0, MAX_CHARS));
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

  $("#rank-titulo").textContent = `Municípios · ${METRICAS[metrica]}`;
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
    const onclick = `event.preventDefault(); abreMunicipio('${r.chave}')`;
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
async function abreEstado() {
  vista = { nivel: "MUN" };
  $("#mapa-titulo").textContent = `${LOCK_UF_NOME} · municípios`;
  $("#btn-brasil").hidden = true;          // nível único: não há para onde voltar
  history.replaceState(null, "", "mapa.html");

  const todos = (await j(`api/municipios/${LOCK_UF}.json`))?.[rede] || [];
  dados = todos;
  porChave = Object.fromEntries(dados.map((d) => [String(d.chave), d]));
  chaveDe = (d) => String(d.properties.id || d.properties.codarea);

  desenha(MUN_GEO.features,
    (d) => {
      const r = porChave[chaveDe(d)];
      if (r) abreMunicipio(r.chave);
    },
    (d) => d.properties.name || `Município ${chaveDe(d)}`);
  pinta();
  await carregarDetalhesEstado();
}

async function abreMunicipio(chave) {
  const r = porChave[String(chave)];
  const nome = r ? r.nome : `Município ${chave}`;
  await carregarDetalhesMUN({ nivel: "MUN", chave: String(chave), nome });
}

window.abreMunicipio = abreMunicipio;

/* ============================================================ detalhes == */
function REDE_TXT() {
  return { T: "todas as redes", PUB: "rede pública", PRIV: "rede privada" }[rede];
}

async function carregarDetalhesEstado() {
  // No Paraná os KPIs do estado saem de nre_agg.json (refs por rede). Sem a
  // camada regional, a mesma informação vem do resumo da própria UF.
  const bloco = UF_ENT?.[rede];
  const alvo = bloco?.resumo?.alvo;
  $("#det-titulo").textContent = LOCK_UF_NOME;
  $("#det-sub").textContent = REDE_TXT();
  if (!alvo) {
    $("#det-kpis").innerHTML = `<div class="skeleton">Sem dados na ${REDE_TXT()}.</div>`;
    $("#card-hist").hidden = true;
    return;
  }
  renderKpis({ ...alvo, nivel: "UF", chave: LOCK_UF }, "UF", LOCK_UF);
  await renderHistograma(bloco?.hist_nota, LOCK_UF_NOME,
    { nivel: "UF", chave: LOCK_UF, nome: LOCK_UF_NOME });
}

async function carregarDetalhesMUN(alvo) {
  try {
    const { nivel, chave, nome } = alvo;
    $("#det-titulo").textContent = nome;
    $("#det-sub").textContent = REDE_TXT();
    $("#det-kpis").innerHTML = `<div class="skeleton">Carregando…</div>`;
    $("#card-hist").hidden = true;
      `<div class="skeleton" style="padding:12px">Carregando…</div>`;

    const ent = await j(`api/entidade/${nivel}/${chave}.json`);
    if (!ent) {
      $("#det-kpis").innerHTML = `<div class="skeleton">Sem dados.</div>`;
      return;
    }
    const bloco = ent[rede];
    const alvoResumo = bloco?.resumo?.alvo;
    if (!alvoResumo) {
      $("#det-kpis").innerHTML =
        `<div class="skeleton">Sem dados na ${REDE_TXT()}.</div>`;
      return;
    }
    renderKpis(alvoResumo, nivel, chave);
    // hist_nota MUN não vem do banco (só BR/UF). Usa HIST_NOTA (PR-específico).
    const histMun = bloco?.hist_nota
      || HIST_NOTA?.por_rede?.[rede]?.[`MUN/${chave}`]
      || null;
    await renderHistograma(histMun, nome, alvo);
  } catch (err) {
    console.error("carregarDetalhesMUN:", err);
    $("#det-kpis").innerHTML =
      `<div class="skeleton" style="color:var(--red-bad)">Erro: ${err.message}</div>`;
  }
}

function renderKpis(alvo, nivel, chave) {
  const el = $("#det-kpis");
  const linkPainel = nivel === "UF" ? `index.html` : `index.html?mun=${chave}`;

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


/* ============================================================ handlers == */
$("#btn-brasil").addEventListener("click", () => abreEstado());
$("#chk-minn").addEventListener("change", pinta);
// Sem handler de troca de rede: só "Pública" existe (ver ESTADO.md).
document.querySelectorAll("#tabs-metrica button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs-metrica button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    metrica = b.dataset.m;
    pinta();
    if (vista.nivel === "MUN" && vista.chave) carregarDetalhesMUN(vista);
    else carregarDetalhesEstado();
  });
});

/* ============================================================ boot ====== */
(async function main() {
  [MUN_GEO, UF_ENT] = await Promise.all([
    j(`data/mun_${LOCK_UF.toLowerCase()}.geojson`),
    j(`api/entidade/UF/${LOCK_UF}.json`),
  ]);
  if (!MUN_GEO) {
    wrap.innerHTML = `<div class="skeleton">Malha de municípios não encontrada
      (data/mun_${LOCK_UF.toLowerCase()}.geojson).</div>`;
    return;
  }
  await abreEstado();

  // deep-link: mapa.html?mun=...
  const p = new URLSearchParams(location.search);
  const munInicial = p.get("mun") || globais.mun;
  if (munInicial && porChave[String(munInicial)]) await abreMunicipio(munInicial);
})();
