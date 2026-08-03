/* Ranking completo de escolas — consome api/top_escolas_full/* (todas as
 * escolas com n>=30). Filtros: UF, rede, busca por texto. Ordenação por
 * qualquer coluna numérica. */

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS",
             "MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC",
             "SE","SP","TO"];
const UF_NOME = {
  AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",
  DF:"Distrito Federal",ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",
  MT:"Mato Grosso",MS:"Mato Grosso do Sul",MG:"Minas Gerais",PA:"Pará",
  PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",RJ:"Rio de Janeiro",
  RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",
  RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins",
};
const $ = (s) => document.querySelector(s);
const fmt0 = (v) => v == null ? "–" : Math.round(v).toLocaleString("pt-BR");
const fmtInt = (v) => v == null ? "–" : (+v).toLocaleString("pt-BR");

const params = new URLSearchParams(location.search);
const globais = window.Filtros ? window.Filtros.carregar() : {};
const LOCK_UF = window.LOCK_UF || "PR";

const state = {
  uf: LOCK_UF,
  nre: params.get("nre") || globais.nre || "",
  dep: 0,   // 0 = todas · 1 fed · 2 estad · 3 mun · 4 priv
  busca: "",
  sort_col: "media_geral",
  sort_dir: "desc",
};

let MUN_TO_NRE = {};   // { "4100103": "APUCARANA", ... }
let NRE_LISTA = [];    // ["APUCARANA", "AREA METROP.NORTE", ...] alfabético
// direção default por coluna: strings ascendem (A→Z); números descem (maior→menor)
const SORT_DEFAULT_DIR = {
  nome: "asc", municipio: "asc", uf: "asc", dependencia_nome: "asc",
  n_participantes: "desc", n_lc: "desc", n_mt: "desc",
  media_geral: "desc", media_lc: "desc",
  media_ch: "desc", media_cn: "desc", media_mt: "desc",
};

let dados = [];    // todas as escolas do escopo (BR ou UF)

/* pr2: UF fixa em PR — dropdown já vem oculto via HTML */

async function initNRE() {
  const nreToMuns = await fetch("data/nre_to_muns.json").then((r) => r.ok ? r.json() : {});
  for (const [nre, cds] of Object.entries(nreToMuns)) {
    cds.forEach((cd) => (MUN_TO_NRE[String(cd)] = nre));
  }
  NRE_LISTA = Object.keys(nreToMuns).sort();
  const sel = $("#rk-nre");
  sel.innerHTML =
    `<option value="">Todos (PR inteiro)</option>` +
    NRE_LISTA.map((n) => `<option value="${n}">${n}</option>`).join("");
  if (state.nre) sel.value = state.nre;
  sel.addEventListener("change", () => {
    state.nre = sel.value;
    const p = new URLSearchParams(location.search);
    if (state.nre) p.set("nre", state.nre); else p.delete("nre");
    history.replaceState(null, "", p.toString() ? "?" + p.toString() : location.pathname);
    if (window.Filtros) window.Filtros.salvar({ ...globais, nre: state.nre });
    render();
  });
}

/* rede default = "Todas" */
document.querySelectorAll("#rk-rede button").forEach((b) => {
  b.classList.toggle("on", parseInt(b.dataset.dep, 10) === state.dep);
});

const DEP_NOME = { 0: "todas as redes", 1: "federal", 2: "estadual", 3: "municipal", 4: "privada" };

async function carregar() {
  $("#rk-tbody").innerHTML =
    `<tr><td colspan="12" class="skeleton" style="padding:24px;text-align:center">Carregando…</td></tr>`;
  const url = state.uf
    ? `api/top_escolas_full/UF/${state.uf}.json`
    : `api/top_escolas_full/BR.json`;
  const d = await fetch(url).then((r) => r.ok ? r.json() : null);
  dados = Array.isArray(d) ? d : [];
  $("#rk-escopo").textContent = state.uf ? UF_NOME[state.uf] : "Brasil";
  render();
}

function render() {
  const q = state.busca.trim().toLowerCase();
  let linhas = dados.filter((e) => {
    if (state.dep && e.dependencia !== state.dep) return false;
    if (state.nre && MUN_TO_NRE[String(e.co_municipio)] !== state.nre) return false;
    if (q) {
      const alvo = `${e.nome || ""} ${e.municipio || ""}`.toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });
  linhas.sort((a, b) => {
    let va = a[state.sort_col];
    let vb = b[state.sort_col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return state.sort_dir === "desc"
        ? vb.localeCompare(va, "pt-BR")
        : va.localeCompare(vb, "pt-BR");
    }
    return state.sort_dir === "desc" ? (vb - va) : (va - vb);
  });

  $("#rk-resumo").innerHTML =
    `<b>${fmtInt(linhas.length)}</b> escolas em ${state.nre ? "NRE " + state.nre : "Paraná"}` +
    (state.dep ? ` · rede ${DEP_NOME[state.dep]}` : "") +
    (q ? ` · busca "${state.busca}"` : "");

  const tb = $("#rk-tbody");
  if (!linhas.length) {
    tb.innerHTML = `<tr><td colspan="12" class="skeleton" style="padding:24px;text-align:center">Nenhuma escola nesse filtro.</td></tr>`;
    return;
  }
  tb.innerHTML = linhas.slice(0, 1000).map((e, i) => {
    const link = `index.html?uf=${e.uf}&mun=${e.co_municipio}&esc=${e.chave}`;
    const nome = e.nome || `Escola INEP ${e.chave}`;
    return `<tr>
      <td class="rk-pos">${i + 1}</td>
      <td class="rk-escola"><a href="${link}" title="${nome}">${nome}</a></td>
      <td class="rk-mun">${e.municipio || "—"}</td>
      <td>${e.uf || "—"}</td>
      <td>${e.dependencia_nome || "—"}</td>
      <td class="rk-num">${fmtInt(e.n_lc != null ? e.n_lc : e.n_participantes)}</td>
      <td class="rk-num">${fmtInt(e.n_mt != null ? e.n_mt : e.n_participantes)}</td>
      <td class="rk-num rk-forte">${fmt0(e.media_geral)}</td>
      <td class="rk-num">${fmt0(e.media_lc)}</td>
      <td class="rk-num">${fmt0(e.media_ch)}</td>
      <td class="rk-num">${fmt0(e.media_cn)}</td>
      <td class="rk-num">${fmt0(e.media_mt)}</td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".rk-sort").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === state.sort_col) {
      th.classList.add(state.sort_dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

/* pr2: sem seletor de UF — UF fixa em PR */
document.querySelectorAll("#rk-rede button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#rk-rede button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.dep = parseInt(b.dataset.dep, 10);
    render();
  });
});
$("#rk-busca").addEventListener("input", (e) => {
  state.busca = e.target.value;
  render();
});
document.querySelectorAll(".rk-sort").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (state.sort_col === col) {
      state.sort_dir = state.sort_dir === "desc" ? "asc" : "desc";
    } else {
      state.sort_col = col;
      state.sort_dir = SORT_DEFAULT_DIR[col] || "asc";
    }
    render();
  });
});

(async () => {
  await initNRE();
  await carregar();
})();
