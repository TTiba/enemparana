/* Chart helpers — SVG inline puro, sem lib externa.
 *
 * Três funções principais:
 *   sparkline(values, opts)   → SVG string (mini gráfico ~80×24 pra KPI)
 *   lineChart(series, opts)   → SVG string (evolução temporal ~600×260)
 *   heatmap(matrix, opts)     → SVG string (grid 30×5 pra habilidades)
 *
 * Todas as funções aceitam `null`/`undefined` em qualquer célula e desenham
 * gaps corretamente. As cores vêm de variáveis CSS (--pink, --lilac, …).
 */

const CHART_CORES = {
  geral: "var(--pink)",
  LC:    "var(--lilac)",
  CH:    "var(--peach)",
  CN:    "var(--mint)",
  MT:    "var(--lime)",
  RED:   "var(--rose)",
  brasil:"var(--ink-40)",
};

/* ---------------- sparkline ---------------------------------------------- */
function sparkline(values, opts = {}) {
  const w = opts.width  || 80;
  const h = opts.height || 24;
  const cor = opts.cor  || CHART_CORES.geral;
  const anos = opts.anos || null;   // se passado, mesmo len que values
  const validos = values.filter((v) => v != null);
  if (validos.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;

  const min = Math.min(...validos), max = Math.max(...validos);
  const range = max - min || 1;
  const pad = 3;
  const stepX = (w - 2 * pad) / (values.length - 1);
  const yFor = (v) => v == null ? null
    : (h - pad) - ((v - min) / range) * (h - 2 * pad);

  let d = "", opened = false;
  values.forEach((v, i) => {
    const y = yFor(v);
    if (y == null) { opened = false; return; }
    d += (opened ? "L" : "M") + (pad + i * stepX).toFixed(1) + " " + y.toFixed(1);
    opened = true;
  });
  const dots = values.map((v, i) => {
    const y = yFor(v);
    if (y == null) return "";
    const cx = (pad + i * stepX).toFixed(1);
    const flag = anos && anos[i] === 2021 ? "spark-2021" : "";
    return `<circle class="spark-dot ${flag}" cx="${cx}" cy="${y.toFixed(1)}" r="1.8"/>`;
  }).join("");
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
              preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

/* ---------------- line chart --------------------------------------------- */
/* series = [{ nome, cor, valores: [n1..n5], estilo?, foco? }]
 * opts   = { xLabels, yMin?, yMax?, width?, height?, id?, legend? } */
function lineChart(series, opts = {}) {
  const w = opts.width || 960;
  const h = opts.height || 300;
  const legend = opts.legend !== false;
  const padL = 44, padR = 12, padT = 12, padB = 32;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const xs = opts.xLabels || series[0]?.valores.map((_, i) => i) || [];
  const stepX = xs.length > 1 ? chartW / (xs.length - 1) : 0;

  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  const yMin = opts.yMin != null ? opts.yMin : Math.floor(Math.min(...todos) * 0.98);
  const yMax = opts.yMax != null ? opts.yMax : Math.ceil(Math.max(...todos) * 1.02);
  const range = yMax - yMin || 1;
  const yFor = (v) => v == null ? null : padT + chartH - ((v - yMin) / range) * chartH;
  const xFor = (i) => padL + i * stepX;

  // eixo Y: 4 gridlines
  const ticks = 4;
  let grids = "";
  for (let i = 0; i <= ticks; i++) {
    const yVal = yMin + (range * i) / ticks;
    const y = yFor(yVal).toFixed(1);
    grids += `<line class="grid" x1="${padL}" x2="${w - padR}" y1="${y}" y2="${y}"/>
              <text class="axis" x="${padL - 6}" y="${y}" text-anchor="end" dy="0.32em">${Math.round(yVal)}</text>`;
  }
  // eixo X: labels
  let xax = "";
  xs.forEach((lb, i) => {
    xax += `<text class="axis" x="${xFor(i).toFixed(1)}" y="${h - padB + 16}" text-anchor="middle">${lb}</text>`;
  });

  // séries: linha + pontos
  let paths = "", pontos = "";
  series.forEach((s) => {
    const cor = s.cor;
    const dash = s.estilo === "brasil" ? "4 3" : "";
    const opaco = s.estilo === "brasil" ? "0.75" : "1";
    let d = "", opened = false;
    s.valores.forEach((v, i) => {
      const y = yFor(v);
      if (y == null) { opened = false; return; }
      d += (opened ? "L" : "M") + xFor(i).toFixed(1) + " " + y.toFixed(1);
      opened = true;
    });
    paths += `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2"
                    stroke-dasharray="${dash}" opacity="${opaco}"
                    stroke-linecap="round" stroke-linejoin="round"/>`;
    s.valores.forEach((v, i) => {
      const y = yFor(v);
      if (y == null) return;
      const flag = xs[i] === 2021 ? " ponto-2021" : "";
      pontos += `<circle class="ln-dot${flag}" cx="${xFor(i).toFixed(1)}"
                         cy="${y.toFixed(1)}" r="3.5" fill="${cor}"
                         data-serie="${s.nome}" data-x="${xs[i]}" data-v="${v}"/>`;
    });
  });

  const legs = !legend ? "" : `<div class="ln-legend">${
    series.map((s) => `<span class="ln-leg-item">
        <i class="ln-leg-dot" style="background:${s.cor};${s.estilo==="brasil"?"opacity:.6":""}"></i>
        ${s.nome}${s.estilo==="brasil"?" (Brasil)":""}
      </span>`).join("")}</div>`;

  // width/height sem atributos: o SVG escala pra 100% do container via CSS,
  // mantendo o aspecto pelo viewBox.
  return `<div class="ln-wrap">
    <svg class="ln-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${grids}${xax}${paths}${pontos}
    </svg>
    ${legs}
  </div>`;
}

/* ---------------- heatmap ------------------------------------------------ */
/* matrix = 2D array of numbers/null; opts = { rows, cols, colorFn, cellW, cellH,
 *          onCellClick?, tooltipFn? } */
/* Heatmap em HTML/CSS Grid. Colunas dividem a largura disponível igualmente
 * (1fr cada), linhas são finas e uniformes. Cada célula é um <div> — sem
 * distorção de texto ou explosão de proporção que o SVG tinha. */
function heatmap(matrix, opts = {}) {
  const rows = opts.rows || matrix.map((_, i) => `L${i}`);
  const cols = opts.cols || (matrix[0] || []).map((_, i) => `C${i}`);
  const showVal = opts.showValue !== false;   // por default mostra o valor na célula
  const valFmt = opts.valueFmt || ((v) => v);

  let out = `<div class="hm-grid" style="--n-cols:${cols.length}">`;
  // cabeçalho
  out += `<div class="hm-corner"></div>`;
  cols.forEach((c) => { out += `<div class="hm-col-hdr">${c}</div>`; });
  // linhas
  rows.forEach((r, ri) => {
    out += `<div class="hm-row-hdr">${r}</div>`;
    (matrix[ri] || []).forEach((v, ci) => {
      const fill = (v == null) ? "var(--ink-6)" : opts.colorFn(v);
      const tt = opts.tooltipFn ? opts.tooltipFn(ri, ci, v) : "";
      const cls = opts.onCellClick ? "hm-cell hm-clickable" : "hm-cell";
      const conteudo = (v == null || !showVal) ? "" : valFmt(v);
      out += `<div class="${cls}" style="background:${fill}"
                   data-r="${ri}" data-c="${ci}" data-v="${v ?? ""}"
                   title="${tt.replace(/"/g,"&quot;")}">${conteudo}</div>`;
    });
  });
  out += `</div>`;
  return out;
}

/* ---------------- escala sequencial e diverging ------------------------- */
/* Cores da paleta do site em RGB (usadas nos gradientes sem passar por
 * color-mix, que fica instável entre browsers pra valores máximos). */
const PALETA_RGB = {
  pink:  [255,  49, 159],
  peach: [255, 196, 138],
  lilac: [198, 180, 229],
  mint:  [163, 229, 224],
  lime:  [236, 235, 117],
  rose:  [255, 152, 207],
  red:   [255, 130, 130],   // coral claro (evita marrom escuro no mid do diverging)
};

function _mix(from, to, t) {
  return `rgb(${Math.round(from[0] + (to[0]-from[0])*t)}, ${
    Math.round(from[1] + (to[1]-from[1])*t)}, ${
    Math.round(from[2] + (to[2]-from[2])*t)})`;
}

/* Escala sequencial: 0 → quase-branco (fundo cream), max → cor plena. */
function escalaSequencial(maxVal, corBase) {
  const to = typeof corBase === "string" ? PALETA_RGB[corBase] : corBase;
  const from = [252, 250, 238];   // cream levemente off-white
  return (v) => {
    if (v == null || v <= 0) return "rgb(243, 239, 218)";  // var(--cream)
    const t = Math.min(1, v / maxVal);
    return _mix(from, to, 0.15 + t * 0.85);
  };
}

/* Escala divergente: cor baixa (satura em 0) → neutro (centro) → cor alta
 * (satura em 1). Range completo pra dar mais níveis discrimináveis. */
function escalaDiverging(centro, corBaixa, corAlta) {
  const baixa = typeof corBaixa === "string" ? PALETA_RGB[corBaixa] : corBaixa;
  const alta  = typeof corAlta  === "string" ? PALETA_RGB[corAlta]  : corAlta;
  const neutro = [252, 250, 238];
  return (v) => {
    if (v == null) return "rgb(243, 239, 218)";
    const d = v - centro;
    // satura no extremo (0 ou 1), não em ±0.15 — dá gradiente completo
    const t = Math.min(1, Math.abs(d) / centro);
    return _mix(neutro, d < 0 ? baixa : alta, 0.20 + t * 0.80);
  };
}

/* ---------------- tooltip auto-attach para line chart ------------------- */
/* Anexa um listener global uma única vez. Todos os pontos `.ln-dot` em
 * qualquer lineChart passam a mostrar tooltip no hover com nome/ano/valor.  */
(function attachLnTooltip() {
  if (window._lnTooltipAttached) return;
  window._lnTooltipAttached = true;

  const tip = document.createElement("div");
  tip.className = "ln-tooltip";
  tip.hidden = true;
  document.body.appendChild(tip);

  function fmtVal(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
  }

  function mostrar(circle) {
    const svg = circle.ownerSVGElement;
    const x = circle.getAttribute("data-x");
    // pega TODOS os pontos do mesmo ano dentro do mesmo SVG (todas as séries)
    const irmaos = svg
      ? Array.from(svg.querySelectorAll(`circle.ln-dot[data-x="${CSS.escape(x)}"]`))
      : [circle];
    const linhas = irmaos.map((el) => {
      const s = el.getAttribute("data-serie");
      const v = el.getAttribute("data-v");
      const cor = el.getAttribute("fill") || "currentColor";
      const ativo = el === circle;
      return `<div class="ln-tip-row ${ativo ? "on" : ""}">
        <i class="ln-tip-swatch" style="background:${cor}"></i>
        <span class="ln-tip-serie">${s}</span>
        <span class="ln-tip-v">${fmtVal(v)}</span>
      </div>`;
    }).join("");
    tip.innerHTML = `<div class="ln-tip-head">${x}</div>${linhas}`;
    tip.hidden = false;
    const r = circle.getBoundingClientRect();
    const top = r.top + window.scrollY - tip.offsetHeight - 10;
    const left = r.left + window.scrollX + r.width / 2 - tip.offsetWidth / 2;
    tip.style.top = `${Math.max(8, top)}px`;
    tip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tip.offsetWidth - 8))}px`;
  }
  function esconder() { tip.hidden = true; }

  document.addEventListener("mouseover", (e) => {
    const c = e.target.closest("circle.ln-dot");
    if (c) mostrar(c);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest("circle.ln-dot")) esconder();
  });
})();

/* ---------------- radar ---------------------------------------------------
 * radar(eixos, series, opts) → string SVG.
 *
 *   eixos  = [{ lbl, cor? }, …]          um vértice por eixo
 *   series = [{ id, nome, cor, valores: [n|null], on }, …]
 *
 * O domínio NÃO começa em zero: numa escala 0–1000 as diferenças entre
 * escola e estado (tipicamente 30–80 pontos) somem. Ele é derivado dos
 * dados, e por isso os anéis vêm **rotulados com o valor** — sem isso o
 * gráfico exagera diferença, que é a crítica clássica ao radar com base
 * deslocada. `opts.dominio = [min, max]` fixa a escala à mão.
 */
function radar(eixos, series, opts = {}) {
  const w = opts.width || 340;
  const h = opts.height || 300;
  const cx = w / 2;
  const cy = h / 2 + 6;
  const r = Math.min(w, h) / 2 - (opts.margem || 54);
  const n = eixos.length;
  if (!n) return "";

  const vivos = series.filter((s) => s.on !== false);
  const todos = vivos.flatMap((s) => s.valores).filter((v) => v != null);
  if (!todos.length) {
    return `<svg viewBox="0 0 ${w} ${h}" class="radar"><text x="${cx}" y="${cy}"
      text-anchor="middle" font-size="12" fill="var(--ink-40)">sem dados</text></svg>`;
  }

  let [lo, hi] = opts.dominio || [];
  if (lo == null || hi == null) {
    const mn = Math.min(...todos), mx = Math.max(...todos);
    const folga = Math.max((mx - mn) * 0.35, mx * 0.04) || 10;
    const passo = opts.passo || 25;
    lo = Math.max(0, Math.floor((mn - folga) / passo) * passo);
    hi = Math.ceil((mx + folga) / passo) * passo;
  }
  if (hi === lo) hi = lo + 1;
  const rr = (v) => ((v - lo) / (hi - lo)) * r;
  const ang = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const px = (i, raio) => cx + Math.cos(ang(i)) * raio;
  const py = (i, raio) => cy + Math.sin(ang(i)) * raio;

  const ANEIS = 4;
  let g = "";

  // teia + rótulo de valor de cada anel
  for (let k = 1; k <= ANEIS; k++) {
    const raio = (r * k) / ANEIS;
    const pts = Array.from({ length: n }, (_, i) => `${px(i, raio)},${py(i, raio)}`).join(" ");
    g += `<polygon points="${pts}" fill="none" stroke="var(--ink-12)" stroke-width="1"/>`;
    const val = Math.round(lo + ((hi - lo) * k) / ANEIS);
    g += `<text x="${cx + 4}" y="${cy - raio + 4}" font-size="9" fill="var(--ink-40)">${val}</text>`;
  }
  // raios
  for (let i = 0; i < n; i++) {
    g += `<line x1="${cx}" y1="${cy}" x2="${px(i, r)}" y2="${py(i, r)}"
           stroke="var(--ink-12)" stroke-width="1"/>`;
  }
  // rótulos dos eixos
  for (let i = 0; i < n; i++) {
    const a = ang(i);
    const lx = cx + Math.cos(a) * (r + 20);
    const ly = cy + Math.sin(a) * (r + 20);
    const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
    g += `<text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" font-size="11"
           font-weight="800" fill="var(--ink)">${eixos[i].lbl}</text>`;
  }
  // polígonos das séries
  for (const s of vivos) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const v = s.valores[i];
      if (v == null) continue;
      pts.push(`${px(i, rr(v))},${py(i, rr(v))}`);
    }
    if (pts.length < 2) continue;
    g += `<polygon points="${pts.join(" ")}" fill="${s.cor}" fill-opacity="${s.preenche === false ? 0 : 0.18}"
           stroke="${s.cor}" stroke-width="2.5" stroke-linejoin="round"/>`;
    for (let i = 0; i < n; i++) {
      const v = s.valores[i];
      if (v == null) continue;
      g += `<circle cx="${px(i, rr(v))}" cy="${py(i, rr(v))}" r="3.5" fill="${s.cor}"
             stroke="var(--card)" stroke-width="1.5"
             title="${s.nome} · ${eixos[i].lbl}: ${v.toLocaleString("pt-BR", {minimumFractionDigits:1, maximumFractionDigits:1})}"/>`;
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="radar" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}

/* ---------------- histograma (distribuição por faixa) ---------------------
 * histograma(buckets, opts) → string SVG. `buckets` = {valor: contagem}.
 * opts.marca desenha uma linha vertical (usada pra situar a média da escola
 * dentro da distribuição do município/NRE/estado).
 */
function histograma(buckets, opts = {}) {
  const w = opts.width || 300;
  const h = opts.height || 120;
  const padB = 20, padL = 4, padT = 8;
  const chaves = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  if (!chaves.length) return "";
  const max = Math.max(...chaves.map((k) => buckets[k]));
  const lo = chaves[0], hi = chaves[chaves.length - 1];
  const span = (hi - lo) || 1;
  const bw = Math.max(1, ((w - padL * 2) / (chaves.length)) - 1);
  const x = (v) => padL + ((v - lo) / span) * (w - padL * 2 - bw);
  const alt = h - padB - padT;

  let g = "";
  for (const k of chaves) {
    const bh = (buckets[k] / max) * alt;
    g += `<rect x="${x(k).toFixed(1)}" y="${(padT + alt - bh).toFixed(1)}" width="${bw.toFixed(1)}"
           height="${bh.toFixed(1)}" fill="${opts.cor || "var(--lilac)"}" rx="1"
           title="${k}–${k + 24}: ${buckets[k].toLocaleString("pt-BR")} alunos"/>`;
  }
  g += `<line x1="0" y1="${padT + alt}" x2="${w}" y2="${padT + alt}" stroke="var(--ink-12)"/>`;
  g += `<text x="0" y="${h - 6}" font-size="9" fill="var(--ink-40)">${lo}</text>`;
  g += `<text x="${w}" y="${h - 6}" font-size="9" fill="var(--ink-40)" text-anchor="end">${hi}</text>`;

  if (opts.marca != null && opts.marca >= lo && opts.marca <= hi) {
    const mx = x(opts.marca) + bw / 2;
    g += `<line x1="${mx.toFixed(1)}" y1="${padT - 4}" x2="${mx.toFixed(1)}" y2="${padT + alt}"
           stroke="var(--pink)" stroke-width="2" stroke-dasharray="3 2"/>`;
    g += `<text x="${mx.toFixed(1)}" y="${h - 6}" font-size="9" font-weight="800"
           fill="var(--pink)" text-anchor="middle">${Math.round(opts.marca)}</text>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="histo" preserveAspectRatio="none">${g}</svg>`;
}

window.Charts = { sparkline, lineChart, heatmap, radar, histograma, escalaSequencial, escalaDiverging };
