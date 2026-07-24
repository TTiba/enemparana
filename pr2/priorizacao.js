/* Página de priorização — visual do Δ esperado por habilidade -----------------
   Dado combinado 2024+2025, do CSV pr/data/priorizacao_habilidades_pr_estado.
   O painel mostra as 30 habilidades da área selecionada como uma barra
   horizontal centrada no zero, com Δ (combinado) preenchendo pra esquerda
   (negativo, "lacuna") ou pra direita (positivo, "força"). Sobre a barra,
   dois traços verticais marcam Δ de 2024 e 2025 individualmente pra o
   usuário conseguir avaliar consistência de olho. */

const AREA_INFO = {
  LC: "Linguagens, Códigos e suas Tecnologias",
  CH: "Ciências Humanas e suas Tecnologias",
  CN: "Ciências da Natureza e suas Tecnologias",
  MT: "Matemática e suas Tecnologias",
};
const AREA_NOME = { LC: "Linguagens", CH: "Humanas", CN: "Natureza", MT: "Matemática" };

const $ = (s) => document.querySelector(s);
const state = { area: "MT", consistente: false, ordDelta: true };
let dados = null;

/* Escala: fixamos a extensão do eixo em ±ESCALA_MAX pp pra as áreas ficarem
   comparáveis entre si. 12pp cobre virtualmente tudo que vimos no PR. */
const ESCALA_MAX = 12;

const fmt = (v, d = 1) =>
  v == null ? "–" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (v) => v == null ? "–" : (+v).toLocaleString("pt-BR");

async function load() {
  const r = await fetch("data/priorizacao_habilidades_pr_estado.json");
  dados = await r.json();
  desenharEixo();
  render();
}

/* Converte um Δ em pp pra posição percentual dentro da barra (0..100). */
function pctDe(pp) {
  return Math.max(0, Math.min(100, ((pp + ESCALA_MAX) / (2 * ESCALA_MAX)) * 100));
}

function corDo(item) {
  if (Math.abs(item.delta_pp) < 1) return "rgba(0,0,0,.25)";
  if (item.delta_pp < 0) {
    return item.consistente ? "var(--rose)" : "#f4c56a";
  }
  return item.consistente ? "#8fbeed" : "rgba(143,190,237,.55)";
}

function categoriza(item) {
  if (Math.abs(item.delta_pp) < 1) return "Neutra";
  if (item.delta_pp < 0) return item.consistente ? "Lacuna consistente" : "Lacuna inconsistente";
  return item.consistente ? "Força consistente" : "Força inconsistente";
}

function desenharEixo() {
  const eixo = $("#pri-eixo");
  eixo.innerHTML = "";
  for (const t of [-10, -5, 0, 5, 10]) {
    const el = document.createElement("span");
    el.className = "tk";
    el.style.left = `${pctDe(t)}%`;
    el.textContent = `${t > 0 ? "+" : ""}${t}pp`;
    eixo.appendChild(el);
  }
}

function descricaoHab(area, h) {
  return (window.HABILIDADES?.[area] || {})[h] || "";
}

function tituloCurto(desc) {
  if (!desc) return "";
  const primeira = desc.split(/[,.:;]/)[0].trim();
  return primeira.length > 90 ? primeira.slice(0, 88) + "…" : primeira;
}

function render() {
  const lista0 = (dados.por_area[state.area] || []).slice();
  const lista = state.consistente ? lista0.filter((x) => x.consistente) : lista0;

  if (state.ordDelta) {
    lista.sort((a, b) => a.delta_pp - b.delta_pp);
  } else {
    lista.sort((a, b) => a.h - b.h);
  }

  $("#pri-titulo").textContent =
    `${AREA_NOME[state.area]} · habilidades por Δ esperado (2024+2025)`;

  const grade = $("#pri-grade");
  grade.innerHTML = "";
  for (const it of lista) {
    const cor = corDo(it);
    const desc = descricaoHab(state.area, it.h);
    const linha = document.createElement("div");
    linha.className = "cel-h";
    linha.innerHTML = `<small>H</small><b>${it.h}</b>`;
    grade.appendChild(linha);

    const barWrap = document.createElement("div");
    barWrap.className = "pri-bar-wrap";
    // zona de ruído (±1pp)
    const ruido = document.createElement("div");
    ruido.className = "pri-bar-ruido";
    ruido.style.left = `${pctDe(-1)}%`;
    ruido.style.width = `${pctDe(1) - pctDe(-1)}%`;
    barWrap.appendChild(ruido);
    // linha zero
    const zero = document.createElement("div");
    zero.className = "pri-bar-zero";
    zero.style.left = `${pctDe(0)}%`;
    barWrap.appendChild(zero);
    // barra do Δ combinado
    const fill = document.createElement("div");
    fill.className = "pri-bar-fill";
    fill.style.background = cor;
    const centro = pctDe(0);
    const alvo = pctDe(it.delta_pp);
    fill.style.left = `${Math.min(centro, alvo)}%`;
    fill.style.width = `${Math.abs(alvo - centro)}%`;
    barWrap.appendChild(fill);
    // marcador 2024
    if (it.delta_2024 != null) {
      const y = document.createElement("div");
      y.className = "pri-year-mark";
      y.dataset.y = "24";
      y.style.left = `${pctDe(it.delta_2024)}%`;
      barWrap.appendChild(y);
    }
    // marcador 2025
    if (it.delta_2025 != null) {
      const y = document.createElement("div");
      y.className = "pri-year-mark";
      y.dataset.y = "25";
      y.style.left = `${pctDe(it.delta_2025)}%`;
      barWrap.appendChild(y);
    }
    barWrap.title = `Δ combinado: ${it.delta_pp > 0 ? "+" : ""}${fmt(it.delta_pp, 2)}pp`
      + ` (2024 ${it.delta_2024 != null ? (it.delta_2024 > 0 ? "+" : "") + fmt(it.delta_2024, 2) : "–"}pp`
      + ` · 2025 ${it.delta_2025 != null ? (it.delta_2025 > 0 ? "+" : "") + fmt(it.delta_2025, 2) : "–"}pp)`
      + `\nN=${fmtInt(it.n_alunos)} respostas · ${it.n_itens} itens`
      + `\n${desc}`;
    grade.appendChild(barWrap);

    const val = document.createElement("div");
    val.className = "cel-val";
    val.style.color = it.delta_pp < 0 && it.consistente ? "var(--rose)"
                    : it.delta_pp > 0 && it.consistente ? "#4d84be"
                    : "var(--ink)";
    val.innerHTML = `${it.delta_pp > 0 ? "+" : ""}${fmt(it.delta_pp, 2)}pp<br>
                     <small style="font-weight:400;color:var(--ink-60);font-size:10px">
                       ${it.consistente ? "✓ consistente" : "? inconsistente"}</small>`;
    grade.appendChild(val);

    const hint = document.createElement("div");
    hint.className = "pri-hab-titulo";
    hint.innerHTML = `<span title="${desc.replace(/"/g, '&quot;')}">${tituloCurto(desc) || "—"}</span>
                      <small>${fmtInt(it.n_alunos)} respostas · ${it.n_itens} ${it.n_itens === 1 ? "item" : "itens"}</small>`;
    grade.appendChild(hint);
  }

  renderSummary(lista0);
}

function renderSummary(lista) {
  const el = $("#pri-summary");
  const lacunaConsist = lista.filter((x) => x.delta_pp < -1 && x.consistente).length;
  const lacunaIncons = lista.filter((x) => x.delta_pp < -1 && !x.consistente).length;
  const forcaConsist = lista.filter((x) => x.delta_pp > 1 && x.consistente).length;
  const neutro = lista.filter((x) => Math.abs(x.delta_pp) <= 1).length;
  el.innerHTML = `
    <section class="card">
      <h4>Lacunas consistentes</h4>
      <div class="num" style="color:var(--rose)">${lacunaConsist}</div>
      <div class="lbl">Δ &lt; -1pp em 2024 e 2025</div>
    </section>
    <section class="card">
      <h4>Lacunas inconsistentes</h4>
      <div class="num" style="color:#c48a2a">${lacunaIncons}</div>
      <div class="lbl">Só um ano abaixo — investigar</div>
    </section>
    <section class="card">
      <h4>Forças consistentes</h4>
      <div class="num" style="color:#4d84be">${forcaConsist}</div>
      <div class="lbl">Δ &gt; +1pp em 2024 e 2025</div>
    </section>
    <section class="card">
      <h4>Dentro do ruído</h4>
      <div class="num" style="color:var(--ink-60)">${neutro}</div>
      <div class="lbl">|Δ| ≤ 1pp — sem sinal claro</div>
    </section>`;
}

document.querySelectorAll("#tabs-area button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs-area button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.area = b.dataset.a;
    render();
  });
});

$("#chk-consistente").addEventListener("change", (e) => {
  state.consistente = e.target.checked;
  render();
});
$("#chk-ord-delta").addEventListener("change", (e) => {
  state.ordDelta = e.target.checked;
  render();
});

load();
