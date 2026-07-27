/* Página de habilidade — card de cobertura + 4 trilhas demo ----------------- */

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

// tema curto para batizar as atividades demo (usado no hero e como sub-rótulo)
let tema = desc.split(/[,.;]/)[0]
  .replace(/^(Reconhecer|Identificar|Interpretar|Analisar|Avaliar|Utilizar|Relacionar|Compreender|Resolver|Associar|Comparar|Selecionar|Aplicar|Calcular)\s+/i, "")
  .trim();
if (tema.length > 40) tema = tema.slice(0, 40).replace(/\s+\S*$/, "") + "…";
const temaCap = tema.charAt(0).toUpperCase() + tema.slice(1);
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

/* ------------- 4 trilhas: conteúdo, prática, aprofundamento, recomposição -- */
const wg = (q) => `https://wayground.com/admin/search?query=${encodeURIComponent(q)}`;
const rco = () => `https://rco.pr.gov.br/`;

const TRILHAS = {
  "col-estruturado": {
    plataforma: "RCO",
    href: rco(),
    icone: "📘",
    itens: [
      { nome: "Aula 1 · conceitos fundamentais",
        meta: "3ª série EM · 2 aulas · aula expositiva" },
      { nome: "Aula 2 · situações-problema",
        meta: "3ª série EM · 2 aulas · resolução guiada" },
      { nome: "Sequência didática completa",
        meta: "3ª série EM · 4 aulas · aplicação e prática" },
      { nome: "Aula de sistematização",
        meta: "3ª série EM · 1 aula · fechamento" },
    ],
  },
  "col-pratica": {
    plataforma: "Wayground",
    href: null,
    icone: "✏️",
    itens: [
      { nome: "Lista dirigida",
        meta: "10 questões · 30 min · autoavaliação",
        tipo: "Lista de exercícios" },
      { nome: "Quiz rápido",
        meta: "6 questões · 10 min · gamificado",
        tipo: "Quiz" },
      { nome: "Prática de aplicação",
        meta: "8 questões · 25 min · contextualizada",
        tipo: "Ficha de atividade" },
      { nome: "Flashcards de conceitos",
        meta: "20 cards · revisão espaçada",
        tipo: "Flashcards" },
    ],
  },
  "col-aprofundamento": {
    plataforma: "Wayground",
    href: null,
    icone: "🚀",
    itens: [
      { nome: `Desafio ENEM · ${habTag}`,
        meta: "5 itens de alta dificuldade",
        tipo: "Desafio" },
      { nome: "Estudo de caso aplicado",
        meta: "leitura + discussão · 1 aula",
        tipo: "Projeto" },
      { nome: "Simulado temático",
        meta: "15 questões ENEM · 45 min",
        tipo: "Simulado" },
      { nome: "Vídeo-aula avançada",
        meta: "20 min · perguntas embutidas",
        tipo: "Vídeo interativo" },
    ],
  },
  "col-recomposicao": {
    plataforma: "Wayground",
    href: null,
    icone: "🔁",
    itens: [
      { nome: "Diagnóstico de lacunas",
        meta: "8 questões · mapeia dificuldades",
        tipo: "Avaliação diagnóstica" },
      { nome: "Retomada guiada",
        meta: "3 vídeos curtos + 6 questões",
        tipo: "Aula de reforço" },
      { nome: "Trilha de recuperação",
        meta: "sequência progressiva · 4 níveis",
        tipo: "Trilha adaptativa" },
      { nome: "Sala de dúvidas",
        meta: "vídeo-comentário + banco de exercícios",
        tipo: "Apoio" },
    ],
  },
};

for (const [colId, cfg] of Object.entries(TRILHAS)) {
  const el = document.getElementById(colId);
  el.innerHTML = cfg.itens.map((it) => {
    const href = cfg.href || wg(it.nome);
    const sub = it.tipo ? `${it.tipo} · ${cfg.plataforma}` : cfg.plataforma;
    return `<a class="link-item link-trilha" href="${href}" target="_blank">
      <span class="li-ico">${cfg.icone}</span>
      <span class="li-txt"><b>${it.nome}</b><small>${it.meta} · ${sub}</small></span>
      <span class="li-seta">→</span>
    </a>`;
  }).join("");
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

/* -------- Questões desta habilidade (imagens WebP das provas oficiais) ----- */
Promise.all([
  fetch(`api/habilidades/${area}/${h}.json`).then((r) => r.ok ? r.json() : null),
  fetch(`api/questoes/2025.json`).then((r) => r.ok ? r.json() : null),
]).then(([habData, quest]) => {
  const card = document.getElementById("hab-questoes");
  const grid = document.getElementById("hab-questoes-grid");
  const nota = document.getElementById("hab-questoes-nota");
  if (!card || !grid || !nota) return;

  // Antes o card ficava escondido sem nenhuma mensagem quando um dos dois
  // JSONs faltava — foi assim que a ausência de api/questoes/ no pr2_deploy
  // passou batida. Agora o card sempre aparece dizendo o que houve.
  if (!quest || !quest.itens) {
    nota.textContent = "As imagens das provas oficiais não estão disponíveis nesta versão do painel.";
    card.hidden = false; return;
  }
  if (!habData) {
    nota.textContent = "Não foi possível carregar os itens desta habilidade.";
    card.hidden = false; return;
  }

  const itens2025 = habData.por_ano?.["2025"]?.itens || [];
  if (!itens2025.length) {
    nota.textContent = "Nenhuma questão desta habilidade encontrada no ENEM 2025 regular.";
    card.hidden = false; return;
  }

  const cards = [];
  for (const it of itens2025) {
    const q = quest.itens[String(it.CO_ITEM)];
    if (!q) continue;
    const langLabel = q.tp_lingua === 0 ? "Inglês"
                    : q.tp_lingua === 1 ? "Espanhol" : null;
    const headline = `Questão ${q.co_posicao}` + (langLabel ? ` · ${langLabel}` : "");
    const partesSub = [];
    if (it.param_b != null) partesSub.push(`Dificuldade b = ${Number(it.param_b).toFixed(2)}`);
    if (it.p_br != null) partesSub.push(`${Math.round(it.p_br * 100)}% de acerto no Brasil`);
    const sub = partesSub.join(" · ");
    const imgs = (q.imgs || []).map((src, i) =>
      `<a href="${src}" target="_blank" class="hab-quest-imgwrap"
          title="Abrir em nova aba (página ${q.pags[i]} do caderno)">
         <img loading="lazy" src="${src}" alt="Questão ${q.co_posicao}${langLabel ? " (" + langLabel + ")" : ""}">
       </a>`).join("");
    cards.push(`<div class="hab-quest">
      <div class="hab-quest-head" style="border-left-color:${info.cor}">
        <div class="hab-quest-headline">${headline}</div>
        <div class="hab-quest-sub">${sub}</div>
      </div>
      <div class="hab-quest-imgs">${imgs}</div>
    </div>`);
  }
  if (!cards.length) {
    nota.textContent = "As questões estão mapeadas mas as imagens ainda não foram geradas para esta habilidade.";
  } else {
    grid.innerHTML = cards.join("");
    nota.textContent = `${cards.length} ${cards.length === 1 ? "questão exibida" : "questões exibidas"} do caderno AZUL do ENEM 2025.`;
  }
  card.hidden = false;
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
