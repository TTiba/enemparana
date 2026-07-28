/* Página de habilidade — cobertura no ENEM, questões da prova e evolução ---- */

const AREA_INFO = {
  LC: { nome: "Linguagens, Códigos e suas Tecnologias", cor: "var(--lilac)" },
  CH: { nome: "Ciências Humanas e suas Tecnologias",    cor: "var(--peach)" },
  CN: { nome: "Ciências da Natureza e suas Tecnologias", cor: "var(--mint)" },
  MT: { nome: "Matemática e suas Tecnologias",          cor: "var(--lime)" },
};

const params = new URLSearchParams(location.search);
const area = params.get("area") || "MT";
const h = parseInt(params.get("h") || "1", 10);
const info = AREA_INFO[area] || AREA_INFO.MT;
const desc = (window.HABILIDADES?.[area] || {})[h] || "";

// filtros herdados: URL > localStorage > defaults (via Filtros helper)
const _globais = window.Filtros ? window.Filtros.carregar() : {};
const LOCK_UF = window.LOCK_UF || "PR";
const F = {
  uf:   LOCK_UF,
  nre:  _globais.nre  || "",
  mun:  _globais.mun  || "",
  esc:  _globais.esc  || "",
  rede: _globais.rede || "PUB",
};
// se o link veio com filtros novos na URL, salva no localStorage também
if (window.Filtros) window.Filtros.salvar(F);
function nivelChaveDoFiltro() {
  if (F.esc) return { nivel: "ESC", chave: F.esc };
  if (F.mun) return { nivel: "MUN", chave: F.mun };
  if (F.uf)  return { nivel: "UF",  chave: F.uf };
  return { nivel: "BR", chave: "BR" };
}

const habTag = `H${h}`;

const comp = window.HAB_TO_COMP?.[area]?.[h];

document.title = `${area} · H${h} · Painel ENEM`;
document.getElementById("hab-banda").style.background = info.cor;
document.getElementById("hab-area").textContent = info.nome;
document.getElementById("hab-comp").textContent = comp
  ? `Competência de área ${comp.n} · ${comp.titulo}`
  : "";
const chipH = document.getElementById("hab-chip-h");
chipH.textContent = habTag;
chipH.style.background = info.cor;
document.getElementById("hab-desc").textContent = desc || `Habilidade ${h}`;

// Bloco "Alvo": exibe filtro atual (UF/MUN/ESC × rede) se veio da página inicial
const REDE_NOME = { T: "todas as redes", PUB: "rede pública", PRIV: "rede privada" };
const alvoEl = document.getElementById("hab-alvo");
if (F.uf || F.mun || F.esc || F.rede !== "T") {
  const partes = [];
  if (F.esc) partes.push(`Escola INEP ${F.esc}`);
  if (F.mun) partes.push(`Município ${F.mun}`);
  if (F.uf)  partes.push(F.uf);
  if (F.rede !== "T") partes.push(REDE_NOME[F.rede]);
  alvoEl.innerHTML = `Analisando: <b>${partes.join(" · ")}</b>`;
  alvoEl.hidden = false;
}

/* -------- Cobertura no ENEM: 5 stat tiles (2021..2025) + detalhes ---------- */
const ANOS_HAB = [2021, 2022, 2023, 2024, 2025];

/* Rótulo do alvo (aparece em cada tile: "27% acerto SP", "27% pública" etc). */
function rotuloAlvo() {
  const alvo = nivelChaveDoFiltro();
  if (alvo.nivel === "BR" && F.rede === "T") return "Brasil";
  const partes = [];
  if (F.esc) partes.push(`escola ${F.esc}`);
  else if (F.mun) partes.push(F.mun);
  else if (F.uf)  partes.push(F.uf);
  if (F.rede === "PUB")  partes.push("pública");
  if (F.rede === "PRIV") partes.push("privada");
  return partes.join(" · ") || "Brasil";
}

/* Calcula {ano: p_alvo} usando o historico do alvo. Se BR/T, atalho. */
async function computarAcertoPorAno(dataHab) {
  const alvo = nivelChaveDoFiltro();
  const rede = F.rede || "T";
  // Atalho: BR/T já vem no api/habilidades/{area}/{h}.json
  if (alvo.nivel === "BR" && rede === "T") {
    const out = {};
    for (const ano of ANOS_HAB) {
      out[ano] = dataHab.por_ano?.[String(ano)]?.media_p_acerto_br ?? null;
    }
    return out;
  }
  // Precisa do historico do alvo. Se ESC (sem historico/), fallback: só 2025
  // via api/entidade/ESC/{chave}.json (já traz itens do ano corrente).
  const url = alvo.nivel === "ESC"
    ? `api/entidade/ESC/${alvo.chave}.json`
    : `api/historico/${alvo.nivel}/${alvo.chave}.json`;
  const hist = await fetch(url).then((r) => r.ok ? r.json() : null);
  const out = {};
  if (alvo.nivel === "ESC") {
    // única fonte disponível: itens do ano corrente. Marca demais anos null.
    for (const ano of ANOS_HAB) out[ano] = null;
    const itensArea = hist?.itens?.[area] || [];
    const hsSet = new Set([h]);
    let sn = 0, sp = 0;
    for (const [, n, p, , hab] of itensArea) {
      if (hsSet.has(hab) && p != null && n) { sn += n; sp += p * n; }
    }
    if (sn) out[2025] = sp / sn;
    return out;
  }
  // BR/UF/MUN: historico com por_ano
  for (const ano of ANOS_HAB) {
    const lst = hist?.[rede]?.por_ano?.[String(ano)]?.[area] || [];
    let sn = 0, sp = 0;
    for (const [, n, p, , hab] of lst) {
      if (hab === h && p != null && n) { sn += n; sp += p * n; }
    }
    out[ano] = sn ? sp / sn : null;
  }
  return out;
}

fetch(`api/habilidades/${area}/${h}.json`)
  .then((r) => r.ok ? r.json() : null)
  .then(async (data) => {
    if (!data) return;
    const card = document.getElementById("hab-cobertura");
    const tiles = document.getElementById("hab-cobertura-tiles");
    if (!card || !tiles) return;
    card.hidden = false;

    const acertoPorAno = await computarAcertoPorAno(data);
    const rotAlvo = rotuloAlvo();

    tiles.innerHTML = ANOS_HAB.map((ano) => {
      const d = data.por_ano?.[String(ano)];
      const n = d?.n_itens ?? 0;
      const p = acertoPorAno[ano];
      const badge = ano === 2021
        ? `<span class="hab-tile-flag" title="Aplicada em jan/2022 · pandemia">⚠</span>`
        : "";
      const cls = n === 0 ? "hab-tile hab-tile-vazio" : "hab-tile";
      return `<div class="${cls}">
        <div class="hab-tile-ano">${ano}${badge}</div>
        <div class="hab-tile-num">${n}</div>
        <div class="hab-tile-lbl">${n === 1 ? "item" : "itens"}</div>
        <div class="hab-tile-p">${p == null ? "—" : Math.round(p * 100) + "% · " + rotAlvo}</div>
      </div>`;
    }).join("");

    const rec = (data.itens_recorrentes || []).filter((x) => x.anos.length >= 2);
    const notaRec = document.getElementById("hab-recorrentes");
    if (rec.length && notaRec) {
      notaRec.hidden = false;
      notaRec.textContent =
        `${rec.length} ${rec.length === 1 ? "item apareceu" : "itens apareceram"} em mais de um ano — INEP reutiliza itens pré-testados.`;
    }

    // detalhes: tabela por ano (dentro do <details>)
    const det = document.getElementById("hab-itens-detalhe");
    if (det) {
      det.innerHTML = ANOS_HAB.map((ano) => {
        const d = data.por_ano?.[String(ano)];
        if (!d?.itens?.length) return "";
        const rows = d.itens.map((it) => `
          <tr>
            <td class="item-code">${it.CO_ITEM}</td>
            <td>${it.param_b == null ? "–" : Number(it.param_b).toFixed(2)}</td>
            <td>${it.p_br == null ? "–" : Math.round(it.p_br * 100) + "%"}</td>
          </tr>`).join("");
        return `<h5 style="margin:10px 0 4px;font-size:13px;color:var(--ink-40)">${ano}</h5>
                <table class="tbl">
                  <thead><tr><th>CO_ITEM</th><th>Dificuldade (b)</th><th>% BR</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>`;
      }).join("");
    }
  })
  .catch((e) => console.warn("cobertura não carregada:", e));

/* -------- Questões desta habilidade (imagens WebP das provas oficiais) -----
 * Multi-ano: tenta api/questoes/{ano}.json pra cada ano da série. Ano sem o
 * JSON (ou cujo caderno ainda não cobre a área — ex.: 2024 só tem o dia 1)
 * entra na nota "sem imagens ainda", nunca em silêncio. */
const ANOS_QUESTOES = [...ANOS_HAB].sort((a, b) => b - a);   // 2025 → 2021
Promise.all([
  fetch(`api/habilidades/${area}/${h}.json`).then((r) => r.ok ? r.json() : null),
  ...ANOS_QUESTOES.map((ano) =>
    fetch(`api/questoes/${ano}.json`).then((r) => r.ok ? r.json() : null).catch(() => null)),
]).then(([habData, ...quests]) => {
  const card = document.getElementById("hab-questoes");
  const grid = document.getElementById("hab-questoes-grid");
  const nota = document.getElementById("hab-questoes-nota");
  if (!card || !grid || !nota) return;

  // Antes o card ficava escondido sem nenhuma mensagem quando um dos JSONs
  // faltava — foi assim que a ausência de api/questoes/ no pr2_deploy passou
  // batida. Agora o card sempre aparece dizendo o que houve.
  if (!habData) {
    nota.textContent = "Não foi possível carregar os itens desta habilidade.";
    card.hidden = false; return;
  }
  const questPorAno = {};
  ANOS_QUESTOES.forEach((ano, i) => { if (quests[i]?.itens) questPorAno[ano] = quests[i].itens; });
  if (!Object.keys(questPorAno).length) {
    nota.textContent = "As imagens das provas oficiais não estão disponíveis nesta versão do painel.";
    card.hidden = false; return;
  }

  // Um slide por questão, do ano mais recente pro mais antigo. Com recorte
  // (região só da questão, colunas costuradas) quando o gerador produziu;
  // senão cai pra(s) página(s) inteira(s) — caso do 2025, vindo do pipeline
  // nacional antigo.
  const slides = [];
  const semImagem = [];   // anos em que a habilidade caiu mas não há imagem
  for (const ano of ANOS_QUESTOES) {
    const itensAno = habData.por_ano?.[String(ano)]?.itens || [];
    if (!itensAno.length) continue;          // habilidade não caiu nesse ano
    const qmap = questPorAno[ano];
    let achou = false;
    for (const it of itensAno) {
      const q = qmap?.[String(it.CO_ITEM)];
      if (!q) continue;
      achou = true;
      const langLabel = q.tp_lingua === 0 ? "Inglês"
                      : q.tp_lingua === 1 ? "Espanhol" : null;
      const partesSub = [];
      if (it.param_b != null) partesSub.push(`b = ${Number(it.param_b).toFixed(2)}`);
      if (it.p_br != null) partesSub.push(`${Math.round(it.p_br * 100)}% de acerto no Brasil`);
      const pagLink = (q.imgs || [])[0];
      const corpo = q.recorte
        ? `<img loading="lazy" src="${q.recorte}" alt="ENEM ${ano} · questão ${q.co_posicao}${langLabel ? " (" + langLabel + ")" : ""}">`
        : (q.imgs || []).map((src, i) =>
            `<img loading="lazy" src="${src}" alt="ENEM ${ano} · questão ${q.co_posicao} · página ${q.pags[i]}">`).join("");
      slides.push(`<div class="hc-slide">
        <div class="hab-quest-head" style="border-left-color:${info.cor}">
          <div class="hab-quest-headline">
            <span class="hc-ano-chip">ENEM ${ano}</span> Questão ${q.co_posicao}${langLabel ? ` · ${langLabel}` : ""}
          </div>
          <div class="hab-quest-sub">${partesSub.join(" · ")}
            ${pagLink ? ` · <a href="${pagLink}" target="_blank">ver página do caderno</a>` : ""}</div>
        </div>
        <div class="hc-img">${corpo}</div>
      </div>`);
    }
    if (!achou) semImagem.push(ano);
  }

  if (!slides.length) {
    nota.textContent = semImagem.length
      ? `As questões de ${semImagem.join(", ")} estão mapeadas, mas as imagens dessas provas ainda não foram geradas.`
      : "Nenhuma questão desta habilidade encontrada nas provas regulares.";
    card.hidden = false;
    return;
  }

  grid.innerHTML = `
    <div class="hab-carrossel">
      <button class="hc-nav hc-prev" aria-label="Questão anterior">‹</button>
      <div class="hc-viewport">${slides.join("")}</div>
      <button class="hc-nav hc-next" aria-label="Próxima questão">›</button>
    </div>
    <div class="hc-contador"></div>`;

  card.hidden = false;   // antes de medir: com o card hidden, clientWidth é 0

  const vp = grid.querySelector(".hc-viewport");
  const cont = grid.querySelector(".hc-contador");
  const bPrev = grid.querySelector(".hc-prev");
  const bNext = grid.querySelector(".hc-next");
  const atual = () => vp.clientWidth ? Math.round(vp.scrollLeft / vp.clientWidth) : 0;
  const atualizar = () => {
    const i = atual();
    cont.textContent = `${i + 1} / ${slides.length}`;
    bPrev.disabled = i <= 0;
    bNext.disabled = i >= slides.length - 1;
  };
  const ir = (delta) => vp.scrollBy({ left: delta * vp.clientWidth, behavior: "smooth" });
  bPrev.addEventListener("click", () => ir(-1));
  bNext.addEventListener("click", () => ir(1));
  vp.addEventListener("scroll", () => requestAnimationFrame(atualizar), { passive: true });
  atualizar();

  const anosOk = ANOS_QUESTOES.filter((a) =>
    (habData.por_ano?.[String(a)]?.itens || []).some((it) => questPorAno[a]?.[String(it.CO_ITEM)]));
  nota.textContent = `${slides.length} ${slides.length === 1 ? "questão" : "questões"} `
    + `do caderno AZUL (${anosOk.join(", ")}) — use as setas pra navegar.`
    + (semImagem.length ? ` Sem imagens ainda para: ${semImagem.join(", ")}.` : "");
}).catch((e) => {
  console.warn("questões não carregadas:", e);
  const card = document.getElementById("hab-questoes");
  const nota = document.getElementById("hab-questoes-nota");
  if (card && nota) {
    nota.textContent = "Erro ao carregar as questões desta habilidade.";
    card.hidden = false;
  }
});

/* -------- Evolução do desempenho na habilidade (2021-2025) ---------------- */
/* Séries:
 *  - Brasil (tracejado): media_p_acerto_br do ano (habilidades/{area}/{h}.json).
 *  - Esperado TRI (lilás): media dos p_esp dos itens da habilidade no BR/T.
 *  - Alvo (linha colorida): média ponderada no alvo escolhido pelos filtros
 *    da URL (historico/{nivel}/{chave}.json). Só aparece se filtros != BR.
 */
async function renderEvolucaoHabilidade() {
  const alvo = nivelChaveDoFiltro();
  const rede = F.rede || "T";
  const habJson = await fetch(`api/habilidades/${area}/${h}.json`).then((r) => r.ok ? r.json() : null);
  if (!habJson) return;
  const habBrPorAno = habJson.por_ano || {};

  // Guardo CO_ITEM da habilidade em cada ano pra cruzar com hist do alvo.
  const coItensPorAno = {};
  for (const ano of ANOS_HAB) {
    const its = habBrPorAno[String(ano)]?.itens || [];
    coItensPorAno[ano] = new Set(its.map((x) => x.CO_ITEM));
  }

  // BR e Esperado TRI: pega dos JSONs históricos BR (via historico/BR/BR.json).
  //   No BR/rede=T, resumo por item {CO_ITEM: [p, p_esp]} por ano.
  //   Fallback pra habJson quando historico não estiver disponível.
  const historicoBR = await fetch(`api/historico/BR/BR.json`).then((r) => r.ok ? r.json() : null);

  const serieBR = ANOS_HAB.map((ano) => {
    const media = habBrPorAno[String(ano)]?.media_p_acerto_br;
    return media != null ? media * 100 : null;
  });

  // Esperado TRI: agrega p_esp dos itens da habilidade × ano em BR/T
  const serieTRI = ANOS_HAB.map((ano) => {
    const bloco = historicoBR?.T?.por_ano?.[String(ano)]?.[area] || [];
    let sumP = 0, sumN = 0;
    for (const arr of bloco) {
      const [co, n, , p_esp] = arr;
      if (coItensPorAno[ano].has(co) && p_esp != null && n) {
        sumP += p_esp * n; sumN += n;
      }
    }
    return sumN ? (sumP / sumN) * 100 : null;
  });

  // Alvo (se filtros != BR): idem, mas do historico/{nivel}/{chave}.json
  let serieAlvo = null;
  let nomeAlvo = "Brasil";
  if (alvo.nivel !== "BR") {
    const hist = await fetch(`api/historico/${alvo.nivel}/${alvo.chave}.json`).then((r) => r.ok ? r.json() : null);
    if (hist && hist[rede]) {
      serieAlvo = ANOS_HAB.map((ano) => {
        const bloco = hist[rede].por_ano?.[String(ano)]?.[area] || [];
        let sumP = 0, sumN = 0;
        for (const arr of bloco) {
          const [co, n, p] = arr;
          if (coItensPorAno[ano].has(co) && p != null && n) {
            sumP += p * n; sumN += n;
          }
        }
        return sumN ? (sumP / sumN) * 100 : null;
      });
      // rótulo do alvo
      const partes = [];
      if (F.esc) partes.push(`Escola ${F.esc}`);
      else if (F.mun) partes.push(F.mun);
      else if (F.uf)  partes.push(F.uf);
      nomeAlvo = partes.join("·") || alvo.chave;
    }
  }

  // Render
  const validas = [...serieBR, ...serieTRI, ...(serieAlvo || [])].filter((v) => v != null);
  if (!validas.length) return;
  const series = [];
  if (serieAlvo) {
    series.push({ nome: nomeAlvo, cor: info.cor, valores: serieAlvo });
  }
  series.push({ nome: "Brasil", cor: "var(--pink)", estilo: "brasil", valores: serieBR });
  series.push({ nome: "Esperado (TRI)", cor: "var(--lilac)", valores: serieTRI });

  const yMin = Math.max(0, Math.floor(Math.min(...validas) - 5));
  const yMax = Math.min(100, Math.ceil(Math.max(...validas) + 5));

  const svg = window.Charts.lineChart(series, {
    xLabels: ANOS_HAB, yMin, yMax,
  });
  document.getElementById("hab-evolucao-body").innerHTML = svg;
  const tituloEl = document.getElementById("hab-evolucao-titulo");
  tituloEl.textContent = serieAlvo
    ? `Evolução do desempenho · ${nomeAlvo} vs Brasil vs esperado TRI · 2021 – 2025`
    : "Evolução do desempenho · 2021 – 2025";
  document.getElementById("hab-evolucao").hidden = false;
}
renderEvolucaoHabilidade().catch((e) => console.warn("evolução não carregada:", e));
