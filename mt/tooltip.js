/* Tooltip próprio, substituindo o `title` nativo -----------------------------
 *
 * O `title` do HTML está correto em toda a UI (verificado no DOM: os valores
 * com 1 casa decimal chegam certinhos nas células de % acerto). O problema é
 * o comportamento do tooltip nativo: ~1s de atraso, some ao menor movimento
 * do mouse e não dá pra estilizar — foi por isso que passou a impressão de
 * "não funciona" nas colunas de % acerto do painel.
 *
 * Aqui o `title` vira `data-tip` na primeira vez que o elemento é apontado
 * (some o nativo) e desenhamos uma bolha própria, imediata. A bolha vive no
 * <body> com position:fixed porque a tabela de itens fica dentro de um
 * `.tbl-scroll` com overflow:auto — um ::after seria recortado na borda.
 */
(function () {
  "use strict";

  var bolha = null;
  var alvoAtual = null;

  function garantirBolha() {
    if (bolha) return bolha;
    bolha = document.createElement("div");
    bolha.className = "tip-bolha";
    bolha.setAttribute("role", "tooltip");
    document.body.appendChild(bolha);
    return bolha;
  }

  /* Move title → data-tip pra suprimir o tooltip nativo, preservando o texto
   * em aria-label pra leitor de tela (o title fazia esse papel antes). */
  function migrar(el) {
    var t = el.getAttribute("title");
    if (t == null || t === "") return;
    el.setAttribute("data-tip", t);
    if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", t);
    el.removeAttribute("title");
  }

  function posicionar(el) {
    var r = el.getBoundingClientRect();
    var b = bolha.getBoundingClientRect();
    var margem = 8;
    var x = r.left + r.width / 2 - b.width / 2;
    x = Math.max(margem, Math.min(x, window.innerWidth - b.width - margem));
    var y = r.top - b.height - 6;
    bolha.classList.toggle("tip-abaixo", y < margem);
    if (y < margem) y = r.bottom + 6;
    bolha.style.left = Math.round(x) + "px";
    bolha.style.top = Math.round(y) + "px";
  }

  function mostrar(el) {
    var txt = el.getAttribute("data-tip");
    if (!txt) return;
    alvoAtual = el;
    garantirBolha();
    bolha.textContent = txt;
    bolha.classList.add("tip-on");
    posicionar(el);
  }

  function esconder() {
    alvoAtual = null;
    if (bolha) bolha.classList.remove("tip-on");
  }

  function achar(no) {
    if (!no || !no.closest) return null;
    return no.closest("[data-tip], [title]");
  }

  document.addEventListener("mouseover", function (e) {
    var el = achar(e.target);
    if (!el) return;
    migrar(el);
    if (el !== alvoAtual) mostrar(el);
  }, true);

  document.addEventListener("mouseout", function (e) {
    if (alvoAtual && !alvoAtual.contains(e.relatedTarget)) esconder();
  }, true);

  // teclado: mesma informação pra quem navega por tab
  document.addEventListener("focusin", function (e) {
    var el = achar(e.target);
    if (el) { migrar(el); mostrar(el); }
  });
  document.addEventListener("focusout", esconder);

  // some quando a página rola ou o layout muda — a bolha é position:fixed
  window.addEventListener("scroll", esconder, true);
  window.addEventListener("resize", esconder);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") esconder();
  });
})();
