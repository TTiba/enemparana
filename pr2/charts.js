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

window.Charts = { sparkline, lineChart, heatmap, escalaSequencial, escalaDiverging };
