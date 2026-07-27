# Painel ENEM · Paraná v2 (`enemparana`)

Status do repositório em 2026-07-26. Este arquivo dá contexto completo pra uma
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

## URLs em produção

- **Primário (Netlify):** https://enemparana.netlify.app · deploy manual
  via `netlify deploy --prod --dir=pr2_deploy` (do repo `enemparana`).
- **Secundário (Cloudflare Workers):** https://enemparana.pages.dev
  *(em configuração — ver §"Cloudflare setup" e `CLOUDFLARE-SETUP.md`)*
- **Fonte GitHub:** https://github.com/TTiba/enemparana (auto-deploy do
  Cloudflare a cada push em `main`).

## Estrutura

```
enemparana/
├── pr2/               ← source (HTMLs, JS, CSS, assets NRE)
├── pr2_deploy/        ← site estático pronto pro Netlify/Cloudflare (o que é servido)
├── pipeline/
│   ├── build_nre_hist.py            ← hist_resumo 2021-2025 por NRE (KPIs)
│   ├── build_hist_nota_pr.py        ← histograma de nota por NRE/MUN (do CSV bruto)
│   └── build_historico_esc_pr.py    ← histórico item-a-item por escola PR (2024+2025)
├── server_pr2.py      ← server local (porta 8093) — API dinâmica + fallback estático
├── netlify.toml       ← publish = pr2_deploy (com robots noindex)
├── wrangler.toml      ← Cloudflare Workers com [assets] directory = pr2_deploy
├── DEPLOY.md          ← guia geral de deploy (Netlify + Cloudflare)
├── CLOUDFLARE-SETUP.md ← tutorial passo-a-passo Cloudflare Pages/Workers
└── status.md          ← este arquivo
```

## Como rodar localmente

**Modo estático** (idêntico ao que roda em produção):
```bash
cd pr2_deploy && python3 -m http.server 9000
# abrir http://localhost:9000
```

**Modo dinâmico** (para iterar no source sem re-gerar pr2_deploy):
- Requer o repo `plataforma/` (painelenem) ao lado, com `data/enem2025.sqlite`
  e `deploy/api/` pré-gerados. Não faz parte deste repo.
- `cd plataforma && python3 server_pr2.py 8093`

## Como rebuild o `pr2_deploy/`

Este repo **não** rebuild sozinho — depende do repo painelenem que já gerou
`deploy/api/` com os JSONs por entidade. Fluxo completo:

```bash
# 1. no repo plataforma/ (painelenem):
cd ~/Documents/Microdados\ ENEM/plataforma

# 1a. só se o banco mudou:
python3 pipeline/exporta_netlify.py       # gera deploy/api/ (~50s, ~800 MB)

# 1b. só se hist NRE ou hist nota mudaram (raro):
python3 pipeline/build_nre_hist.py        # nre_hist_resumo.json (~127 KB)
.venv/bin/python pipeline/build_hist_nota_pr.py  # hist_nota_pr.json (~712 KB)

# 1c. SEMPRE — regera pr2_deploy/ do zero + histórico por escola:
python3 pr2/deploy_pr2.py                 # ~1 min · gera 5.691 arquivos, 141 MB
                                          # (chama build_historico_esc_pr.py ao final)

# 2. no repo enemparana/:
cd ~/Documents/enemparana
rsync -a --delete ~/Documents/Microdados\ ENEM/plataforma/pr2/       pr2/
rsync -a --delete ~/Documents/Microdados\ ENEM/plataforma/pr2_deploy/ pr2_deploy/
git add -A && git commit -m "..." && git push   # dispara Cloudflare

# 3. deploy manual no Netlify:
netlify deploy --prod --dir=pr2_deploy   # ~1 min de upload incremental
```

## Cloudflare setup — em andamento (2026-07-26)

Cloudflare Pages foi absorvido pelo Workers no dashboard novo. Adicionamos
`wrangler.toml` no root do repo com `[assets] directory = "./pr2_deploy"`,
que faz o Workers servir o diretório como site estático puro (sem código
Worker). Instruções detalhadas em `CLOUDFLARE-SETUP.md`.

**Estado atual:** commit `798248e` com wrangler.toml pushado; setup no
dashboard Cloudflare inconcluso — retomar depois amanhã.

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

## Correções recentes (24-27/07)

- **Questões da habilidade não apareciam** (27/07): ao clicar num chip de
  habilidade, `habilidade.html` abria sem a seção "Questões desta habilidade"
  (imagens WebP das provas oficiais) — e sem nenhuma mensagem explicando.
  Causa: `deploy_pr2.py` nunca copiou `api/questoes/{ano}.json` nem as imagens
  referenciadas por ele, então o `fetch` dava 404 e `habilidade.js` retornava
  cedo deixando o card `hidden`. Fix em duas partes: (a) `deploy_pr2.py` agora
  copia `api/questoes/2025.json` e cada arquivo listado em `imgs[]`, resolvendo
  os caminhos contra a raiz do deploy nacional e preservando a mesma estrutura
  dentro de `pr2_deploy/`; (b) `habilidade.js` deixa de falhar em silêncio —
  o card sempre aparece, com nota explícita quando os dados faltam, e os
  rótulos de `b`/`% BR` não imprimem mais `NaN` quando vêm nulos.
  **⚠ Exige rebuild — ver §TODOs.**

- **hist_nota_pr.json faltando no deploy** (25/07): `deploy_pr2.py` não estava
  copiando o arquivo. Fix: adicionado à lista de assets. Commit `95e1e98`.
- **Cor delta 0pp em vermelho** (25/07): quando Δ arredonda pra zero, célula
  fica cinza neutro (var(--ink-06)) e o texto é "0 pp" sem sinal. Commit `95e1e98`.
- **Análise ESC mostrava PR silenciosamente** (26/07): página `criticas.html`
  caía pra dados do Paraná quando escola era selecionada. Bug de fallback em
  `criticas.js`. Fix: novo pipeline `build_historico_esc_pr.py` gera
  `api/historico/ESC/{inep}.json` pras 2.085 escolas PR (2024+2025); JS agora
  puxa isso. Anos 2021-2023 continuam vazios (CO_ESCOLA só passou a ser
  publicado pelo INEP em 2024). Commit `d6054a4`.
- **Painel · coluna Dificuldade** (26/07): removido rótulo "fácil/média/difícil",
  mantido só o valor de b. Cor por classe mantida via CSS. Commit `2bafe99`.
- **Painel · precisão do %** (26/07): adicionado tooltip com 1 casa decimal em
  cada célula de % acerto pra evitar confusão com arredondamento (ex.: 12,5%
  aparece como 13%). Commit `ad0f2a6`. **⚠ Ver §TODOs.**

## Auditoria de cálculo (27/07) — planilha Feijó como gabarito

Pente-fino da lógica de cálculo usando a escola Regente Feijó (INEP 41063325,
Ponta Grossa) reconstruída direto dos microdados numa planilha independente.

**Bate 100%** (item a item, 180 itens válidos): universo de itens (o filtro de
caderno majoritário coincide com o critério de abandono da planilha), `n` por
item, `p` observado, `param_b`, médias por área, `media_red` (com redações
zeradas incluídas), agregação por habilidade (média ponderada por n — mesma
lógica de criticas.js/habilidade.js) e agregação NRE (ponderada por n ✓).
`media_geral` = média das 5 notas dos alunos com presença completa (504,64 ✓).

**Divergência encontrada — constante D da TRI**: o `p_esp` do painel é a média
sobre os alunos da 3PL com **D=1,7** (`c+(1-c)/(1+e^(-1,7·a(θ-b)))`); replica
com erro máx. 0,0005 (= arredondamento). Teste de calibração contra o acerto
observado da escola: **D=1 acerta** (viés −0,13 pp; por área ±0,9 pp) e
**D=1,7 subestima sistematicamente** (viés −2,9 pp; −1,4 a −3,8 pp por área).
Ou seja, os parâmetros publicados pelo INEP já estão na métrica logística e
devem ser usados **sem** o fator 1,7. Consequência: a coluna "Δ esperado" está
inflada ~+2,9 pp em média — em MT da Feijó chega a trocar o sinal (painel diz
+1,4 pp acima do esperado; o correto é −0,9 pp abaixo). Fix é no `build_db.py`
/pipeline do repo plataforma (cálculo de p_esp), fora deste repo.

**Confirmação em escala (27/07)** — repetido em Ponta Grossa inteira e no PR,
reconstruindo a distribuição de θ a partir de `hist_nota_pr.json` (buckets de
25 pts; método validado contra os θ exatos da Feijó: erro de 0,02 pp no
agregado). Viés do esperado vs acerto observado:

| população | alunos | θ médio | D=1 | D=1,7 (hoje) | D ótimo |
|---|---|---|---|---|---|
| Feijó (ESC) | 200 | −0,02 | −0,14 pp | −2,88 pp | 0,98 |
| Ponta Grossa · PUB | 1.422 | −0,02 | −0,20 pp | −2,95 pp | 0,97 |
| Ponta Grossa · T | 2.284 | +0,28 | +0,52 pp | −1,42 pp | 1,12 |
| Paraná · PUB | 50.328 | +0,09 | +0,09 pp | −2,41 pp | 1,02 |
| Paraná · T | 64.780 | +0,25 | +0,49 pp | −1,58 pp | 1,11 |
| Paraná · PRIV | 14.452 | +0,80 | +1,90 pp | +1,35 pp | >2,5 |

Três populações públicas independentes de 200 a 50.328 alunos convergem em
D ≈ 1,0. **O viés do D=1,7 é θ-dependente** (−3,0 pp na rede pública, −1,4 pp
em todas as redes): não é offset constante, distorce a *comparação* entre
escolas/redes, favorecendo artificialmente as mais fracas — o oposto do que um
painel de priorização precisa. Em Ponta Grossa, 29 itens (PUB) e 46 itens (T)
de ~180 **trocam de sinal** no "Δ esperado" com a correção.

**Ressalva separada — rede privada**: o 3PL superestima os privados em ~+1,9 pp
em qualquer D (o ótimo estoura 2,5). Não é causado nem resolvido pela correção
do D; é desajuste de modelo, consistente com ausência de parâmetro de descuido
(o 3PL não tem assíntota superior < 1, e o efeito cresce com θ). Vale documentar
como limitação conhecida.

**Demo lado a lado (27/07)** — `pipeline/d1_demo/gera_site_paralelo_d1.py`
gera `pr2_deploy_d1/` (gitignored): cópia do site com `p_esp` recalculado em
D=1 a partir dos parâmetros oficiais dos itens 2025
(`params_itens_2025.json`) e das distribuições de nota em buckets
(`hist_nota_pr.json` pra UF/PR e Ponta Grossa; buckets exatos da Feijó com
inglês/espanhol separados em `feijo_buckets_2025.json`). Rodar:
`python3 pipeline/d1_demo/gera_site_paralelo_d1.py`, depois servir
`pr2_deploy` na 9000 e `pr2_deploy_d1` na 9001. Limites do demo: itens 2025
das entidades PR/PG/Feijó; itens EN·ES em UF/MUN ficam "–" (sem distribuição
de θ por língua nesses níveis); anos 2021-2024 mantêm o valor antigo.

**Menores**: (a) `agregarItensNRE` (app.js:237-256) usa `r.n` como denominador
de `p` mas só soma `p*n` quando `p != null` — se algum município vier com n>0
e p null, subestima; usar denominador próprio como já faz com `p_esp`;
(b) `fundirLEM` pondera `p_br`/`p_uf` pelo n da seleção (mix de idioma da
escola, não do BR) — padronização direta, defensável, mas convém documentar.

## Pontos de atenção

- **hist_nota MUN não existe no banco nacional** (só BR/UF). Por isso o
  `build_hist_nota_pr.py` varre o CSV bruto RESULTADOS_2025.csv gerando
  histogramas específicos do PR em `pr2/data/hist_nota_pr.json` (~712 KB).
- **Historico item-a-item por escola** (2024+2025): não é emitido pelo
  pipeline nacional (2 milhões de arquivos). Foi gerado só pras escolas PR
  em `pr2_deploy/api/historico/ESC/*.json` (2.058 arquivos, 72 MB).
- **Escolas pré-2024 não têm CO_ESCOLA** no INEP — histórico por escola
  cobre apenas 2024-2025.
- **Filtro caderno majoritário (n ≥ 25% do máximo)** aplicado em itens
  do 2º dia pra descartar cadernos de reaplicação/adaptados.
- **Deploy é não-listado**: `X-Robots-Tag: noindex, nofollow` em todas as
  respostas + `robots.txt` disallow-all.

## TODOs abertos

- [ ] **Publicar as questões da habilidade** (27/07): a correção do
  `deploy_pr2.py` está commitada, mas as imagens WebP moram no repo
  `plataforma/` (`deploy/questoes_img/…`) e só entram no `pr2_deploy/` num
  rebuild. Fluxo: `python3 pr2/deploy_pr2.py` no `plataforma/` (conferir na
  saída a linha "N imagens de questões copiadas"; se disser "questoes/ ausente
  no deploy nacional", rodar antes o pipeline de questões de lá) → `rsync` das
  duas pastas → commit/push → `netlify deploy --prod --dir=pr2_deploy`.
  O `pr2_deploy/` deste repo ainda **não** tem as imagens.
- [ ] **Tooltip mouseover no painel inicial não funciona** (26/07): adicionei
  `<span title="…">` nas colunas de % acerto (Feijó H9 exibe 13% mas tooltip
  deveria mostrar 12,5%). Não aparece ao passar o mouse. Investigar: (a) se
  o `<span>` foi renderizado de fato no DOM, (b) se algum CSS `pointer-events:
  none` está bloqueando, (c) se o browser respeita tooltip nativo em elementos
  dentro de células flex/grid. Ver `pr2/app.js:574-576` e `685-689`.
- [ ] Configurar site Cloudflare terminando o setup no dashboard (repo já tem
  `wrangler.toml`; falta clicar Deploy).
- [ ] Considerar filtro NRE na página de priorização.
- [ ] Rodar `build_hist_nota_pr.py` para os outros anos (2021-2024) se
  quiser histogramas históricos por NRE/MUN.
- [ ] Página `criticas.html`: quando escola selecionada, colunas 2021-2023
  ficam com "—". Adicionar aviso explícito na UI ("escola só tem histórico
  desde 2024 no INEP") pra deixar claro pro usuário que não é bug.

## Referência

- Painel Nacional (produção): https://microdadosenem.netlify.app
- Repo Nacional: https://github.com/TTiba/painelenem
- Repo Paraná v2: https://github.com/TTiba/enemparana
- Netlify docs: https://docs.netlify.com/cli/get-started/
- Cloudflare Workers docs: https://developers.cloudflare.com/workers/static-assets/
- Guias internos: [DEPLOY.md](./DEPLOY.md) · [CLOUDFLARE-SETUP.md](./CLOUDFLARE-SETUP.md)
