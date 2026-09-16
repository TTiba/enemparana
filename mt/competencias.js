/* Matriz de Referência ENEM — mapa competência → habilidades.
 *
 * Fonte: Matriz_Referencia_ENEM.pdf (INEP). Estrutura estável desde 2009.
 * Cada área tem N competências que agrupam de 3 a 5 habilidades.
 */
window.COMPETENCIAS = {
  LC: [
    { n: 1, titulo: "Tecnologias da comunicação",       hs: [1, 2, 3, 4] },
    { n: 2, titulo: "Línguas estrangeiras modernas",    hs: [5, 6, 7, 8] },
    { n: 3, titulo: "Linguagem corporal",               hs: [9, 10, 11] },
    { n: 4, titulo: "Arte como cultura e estética",     hs: [12, 13, 14] },
    { n: 5, titulo: "Análise linguística e literatura", hs: [15, 16, 17] },
    { n: 6, titulo: "Textos: progressão e organização", hs: [18, 19, 20] },
    { n: 7, titulo: "Argumentação",                     hs: [21, 22, 23, 24] },
    { n: 8, titulo: "Norma padrão da língua portuguesa",hs: [25, 26, 27] },
    { n: 9, titulo: "Tecnologias em contextos comunicativos", hs: [28, 29, 30] },
  ],
  CH: [
    { n: 1, titulo: "Elementos culturais e identidades",       hs: [1, 2, 3, 4, 5] },
    { n: 2, titulo: "Espaços geográficos",                     hs: [6, 7, 8, 9, 10] },
    { n: 3, titulo: "Instituições sociais e políticas",        hs: [11, 12, 13, 14, 15] },
    { n: 4, titulo: "Técnicas, tecnologias e produção",        hs: [16, 17, 18, 19, 20] },
    { n: 5, titulo: "Cidadania e democracia",                  hs: [21, 22, 23, 24, 25] },
    { n: 6, titulo: "Sociedade, natureza e meio ambiente",     hs: [26, 27, 28, 29, 30] },
  ],
  CN: [
    { n: 1, titulo: "Ciências como construções humanas",       hs: [1, 2, 3, 4] },
    { n: 2, titulo: "Tecnologias associadas às ciências",      hs: [5, 6, 7] },
    { n: 3, titulo: "Impactos ambientais e produção",          hs: [8, 9, 10, 11, 12] },
    { n: 4, titulo: "Interações organismo × ambiente",         hs: [13, 14, 15, 16] },
    { n: 5, titulo: "Métodos e procedimentos das ciências",    hs: [17, 18, 19] },
    { n: 6, titulo: "Física em situações-problema",            hs: [20, 21, 22, 23] },
    { n: 7, titulo: "Química em situações-problema",           hs: [24, 25, 26, 27] },
    { n: 8, titulo: "Biologia em situações-problema",          hs: [28, 29, 30] },
  ],
  MT: [
    { n: 1, titulo: "Números e operações",                     hs: [1, 2, 3, 4, 5] },
    { n: 2, titulo: "Geometria e espaço",                      hs: [6, 7, 8, 9] },
    { n: 3, titulo: "Grandezas e medidas",                     hs: [10, 11, 12, 13, 14] },
    { n: 4, titulo: "Variação de grandezas",                   hs: [15, 16, 17, 18] },
    { n: 5, titulo: "Modelagem algébrica",                     hs: [19, 20, 21, 22, 23] },
    { n: 6, titulo: "Gráficos e tabelas",                      hs: [24, 25, 26] },
    { n: 7, titulo: "Estatística e probabilidade",             hs: [27, 28, 29, 30] },
  ],
};

/* Lookup rápido: habilidade → { comp_num, comp_titulo } */
window.HAB_TO_COMP = (() => {
  const map = { LC: {}, CH: {}, CN: {}, MT: {} };
  for (const area of Object.keys(window.COMPETENCIAS)) {
    for (const c of window.COMPETENCIAS[area]) {
      for (const h of c.hs) map[area][h] = { n: c.n, titulo: c.titulo };
    }
  }
  return map;
})();
