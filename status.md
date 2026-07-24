# Painel ENEM · Paraná v2 (`enemparana`)

Status do repositório em 2026-07-24. Este arquivo dá contexto completo pra uma
nova sessão de trabalho.

## O que é

Variante especializada do [Painel ENEM Nacional](https://microdadosenem.netlify.app)
focada no Paraná. Herda **todas** as features do painel nacional (série
histórica 2021–2025, sparklines, ranking de escolas, análise de habilidades)
e adiciona uma camada NRE (Núcleo Regional de Educação) em todas as features.

- **Rede default**: pública (permite alternar pra privada ou todas).
- **Locked em UF=PR**: não permite trocar de estado.
- **32 NREs**, **399 municípios**, **~2.085 escolas do PR**.
- **Mapa NRE→Município**: nível 1 mostra os 32 NREs; clique num NRE abre os
  municípios daquele NRE; clique num município mostra detalhes.

## Estrutura

```
enemparana/
├── pr2/               ← source (HTMLs, JS, CSS, assets NRE)
├── pr2_deploy/        ← site estático pronto pro Netlify (o que é servido)
├── pipeline/
│   ├── build_nre_hist.py       ← agrega hist_resumo 2021-2025 por NRE
│   └── build_hist_nota_pr.py   ← gera histograma de nota por NRE/MUN do CSV bruto
├── server_pr2.py      ← server local (porta 8093) — API dinâmica + fallback estático
├── netlify.toml       ← publish = pr2_deploy (com robots noindex)
└── status.md          ← este arquivo
```

## Como rodar localmente

**Modo estático** (idêntico ao Netlify):
```bash
cd pr2_deploy && python3 -m http.server 9000
# abrir http://localhost:9000
```

**Modo dinâmico** (para iterar no source sem re-gerar pr2_deploy):
- Requer o repo `plataforma/` (painelenem) ao lado, com `data/enem2025.sqlite`
  e `deploy/api/` pré-gerados. Não faz parte deste repo.

## Como rebuild o `pr2_deploy/`

Este repo **não** rebuild sozinho — depende do repo painelenem que já gerou
`deploy/api/` com os JSONs por entidade. Fluxo:

```bash
# no repo plataforma/ (painelenem):
python3 pipeline/exporta_netlify.py       # gera deploy/api/ (nacional)
python3 pipeline/build_nre_hist.py        # gera pr2/data/nre_hist_resumo.json
.venv/bin/python pipeline/build_hist_nota_pr.py   # gera pr2/data/hist_nota_pr.json
python3 pr2/deploy_pr2.py                 # gera pr2_deploy/
# depois copiar pr2/ e pr2_deploy/ para cá e commit
```

`pr2/deploy_pr2.py` filtra `deploy/api/*` do painelenem pra manter só o
subset PR + copia todos os assets NRE e o front do pr2/.

## Faseamento da v2 (histórico)

- **Fase A** — Bootstrap: cópia integral do web/ nacional pra pr2/, lock UF=PR,
  rede default PUB, filtros.js isolado, server_pr2.py na porta 8093.
- **Fase B** — Dropdown NRE em index + cascata NRE→município + api() intercept.
- **Fase C** — Mapa reescrito com drill-down NRE→MUN + rótulos das cidades.
- **Fase D** — Filtro NRE em criticas + ranking + histórico NRE (pipeline
  `build_nre_hist.py` agrega hist_resumo 2021-2025 dos munis por NRE).
- **Fase E** — Página priorização herdada do pr/ atual.
- **Fase F** — Script `deploy_pr2.py` gera `pr2_deploy/` estendendo o pr/
  original com `historico/`, `refs_hist/`, `top_escolas*/`, `habilidades/`.
- **Bônus** — Agregação client-side de itens no nível NRE (competências e
  tabela de itens funcionam com média ponderada dos munis) + top escolas
  agregado no painel do mapa + histograma de nota por NRE/MUN.

## Pontos de atenção

- **hist_nota MUN não existe no banco nacional** (só BR/UF). Por isso o
  `build_hist_nota_pr.py` varre o CSV bruto RESULTADOS_2025.csv gerando
  histogramas específicos do PR em `pr2/data/hist_nota_pr.json` (~712 KB).
- **Escolas pré-2024 não têm CO_ESCOLA** no INEP — histórico por escola
  cobre apenas 2024-2025.
- **Filtro caderno majoritário (n ≥ 25% do máximo)** aplicado em itens
  do 2º dia pra descartar cadernos de reaplicação/adaptados.
- **Deploy é não-listado**: `X-Robots-Tag: noindex, nofollow` em todas as
  respostas + `robots.txt` disallow-all.

## TODOs abertos

- [ ] **Corrigir carregamento do histograma na porta 9000** — usuário relatou
  em 24/07 que hist_nota não aparece no static; funciona no dinâmico (8093).
  Provável causa: paths relativos vs cache do navegador.
- [ ] Configurar site Netlify apontando pra este repo (ainda não feito).
- [ ] Considerar filtro NRE na página de priorização.
- [ ] Rodar `build_hist_nota_pr.py` para os outros anos (2021-2024) se
  quiser histogramas históricos por NRE/MUN.

## Referência

- Repo do painel nacional: https://github.com/TTiba/painelenem
- Painel nacional em produção: https://microdadosenem.netlify.app
