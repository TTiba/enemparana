/* Filtros globais persistentes — variante pr2 (Paraná).
 * Diferenças vs. web/filtros.js:
 *   - KEY = "enem.filtros.pr2" (isolado do painel nacional).
 *   - DEFAULTS.uf = "PR" e sempre força uf="PR" (ignora URL/LS para uf).
 *   - DEFAULTS.rede = "PUB" (default = escolas públicas).
 *   - Adiciona campo `nre` ao schema.
 */
(function () {
  const KEY = "enem.filtros.pr2";
  const LOCK_UF = window.LOCK_UF || "PR";
  const REDES = new Set(["T", "PUB", "PRIV"]);
  const DEFAULTS = { uf: LOCK_UF, nre: "", mun: "", esc: "", rede: "PUB" };

  function lerLS() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {};
      const o = JSON.parse(raw) || {};
      const out = {};
      if (typeof o.nre === "string")  out.nre  = o.nre;
      if (typeof o.mun === "string")  out.mun  = o.mun;
      if (typeof o.esc === "string")  out.esc  = o.esc;
      if (REDES.has(o.rede))          out.rede = o.rede;
      return out;
    } catch { return {}; }
  }

  function lerURL() {
    const p = new URLSearchParams(location.search);
    const out = {};
    if (p.get("nre")) out.nre = p.get("nre");
    if (p.get("mun")) out.mun = p.get("mun");
    if (p.get("esc")) out.esc = p.get("esc");
    if (REDES.has(p.get("rede"))) out.rede = p.get("rede");
    return out;
  }

  function carregar() {
    const url = lerURL();
    const ls  = lerLS();
    const p = new URLSearchParams(location.search);
    const temUrlNre = p.has("nre");
    const temUrlMun = p.has("mun");
    const temUrlEsc = p.has("esc");
    return {
      uf:   LOCK_UF,
      nre:  temUrlNre ? (url.nre || "") : (url.nre ?? ls.nre ?? DEFAULTS.nre),
      mun:  temUrlMun ? (url.mun || "") : (url.mun ?? ls.mun ?? DEFAULTS.mun),
      esc:  temUrlEsc ? (url.esc || "") : (url.esc ?? ls.esc ?? DEFAULTS.esc),
      rede: url.rede  ?? ls.rede ?? DEFAULTS.rede,
    };
  }

  function salvar(f) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        nre: f.nre || "", mun: f.mun || "", esc: f.esc || "",
        rede: REDES.has(f.rede) ? f.rede : "PUB",
      }));
    } catch { /* ignora */ }
  }

  function limpar() {
    try { localStorage.removeItem(KEY); } catch { /* ignora */ }
  }

  window.Filtros = { carregar, salvar, limpar };
})();
