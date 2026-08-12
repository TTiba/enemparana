# Estado atual — leia isto primeiro

Atualizado: **2026-08-12**

Arquivo curto e de manutenção obrigatória. Serve pra retomar o trabalho sem
reconstruir contexto de memória. Detalhe e histórico ficam no `status.md`
(370 linhas) e no `status.md` do `painelenem`.

> Regra: ao terminar uma tanda de trabalho, atualize as seções **Onde está
> cada coisa**, **Em aberto** e a data acima. Se um fato aqui contradiz o
> `status.md`, este arquivo é o mais novo — mas confirme antes de agir.

---

## Os dois painéis

| | Paraná | Nacional |
|---|---|---|
| repo | `TTiba/enemparana` | `TTiba/painelenem` |
| clone local | `~/Documents/enemparana` | `~/Documents/Microdados ENEM/plataforma` |
| source | `pr2/` | `web/` |
| build servido | `pr2_deploy/` (commitado) | `deploy/` (commitado) |
| produção | https://enemparana.netlify.app | https://microdadosenem.netlify.app |
| **como publica** | **os dois:** ligado ao git (produção = `main`) **e** `netlify deploy --prod --dir=pr2_deploy` manual | **push/merge na `main`** — Netlify ligado ao GitHub, deploy automático |

**Corrigido em 12/08 — este ponto estava errado aqui e no `CLAUDE.md`.**
Estava escrito que o Paraná "NÃO é ligado ao git"; está sim. O que
acontecia é que só o deploy manual vinha sendo usado, então a `main` ficou
parada em `f639294` (26/07) enquanto o ar seguia adiante pelos deploys
manuais. Consequência prática, que me fez errar um diagnóstico: **o card
"Production: main@sha" do painel do Netlify mostra o último deploy vindo do
git, não o que está no ar** — deploy manual publica em produção sem ficar
amarrado a commit nenhum. Para saber o que está em produção, abra o site.

Há também um Cloudflare Workers secundário (`enemparana.pages.dev`,
`wrangler.toml` → `directory = "./pr2_deploy"`, `CLOUDFLARE-SETUP.md`) —
auto-deploy a cada push em `main`; nunca confirmado funcionando. Mergear na
`main` dispara Netlify e Cloudflare juntos.

## O dado desce em cascata

```
microdados_enem_{ano}/DADOS/       (na máquina do Raphael, ~2 GB/ano, 5 anos)
  └─ build_all_years.py  →  plataforma/data/enem{ano}.sqlite
       └─ build_hist_db.py  →  data/enem_hist.sqlite
            ├─ exporta_netlify.py  →  plataforma/deploy/        (nacional)
            └─ pr2/deploy_pr2.py   →  plataforma/pr2_deploy/    (Paraná)
```

`deploy_pr2.py` lê `deploy/api/` e `data/enem2025.sqlite` — **o painel PR é
derivado do nacional**. Um rebuild corrige os dois. `pr2/` é editado no repo
`enemparana` e entra na plataforma por `rsync -a pr2/ .../plataforma/pr2/`
(sem `--delete`).

## Correção do D da TRI (o assunto principal)

`build_db.py` calculava a 3PL com o fator `D=1,7`. Os parâmetros do INEP já
vêm na métrica logística, então o fator é espúrio: o modelo subestimava o
acerto em ~2,5 pp, e o desvio varia com o nível da população (reordena
habilidades, não só desloca a régua). Três populações de 200 a 50 mil alunos
convergem em D ótimo 0,97–1,02.

Fórmula em `pipeline/build_db.py:217` (painelenem), sem o fator:

```sql
i.NU_PARAM_C + (1 - i.NU_PARAM_C) /
  (1 + exp(-i.NU_PARAM_A * ((r.NU_NOTA_{area} - 500)/100.0 - i.NU_PARAM_B)))
```

A agregação continua **aluno a aluno** (média das probabilidades
individuais, não a probabilidade no θ médio — Jensen).

Medição com `python3 pipeline/verifica_calibracao.py <dir>` (não precisa dos
microdados; compara `p` contra `p_esp` dentro do próprio deploy):

| | antes (D=1,7) | depois (D=1) |
|---|---|---|
| `deploy/` nacional | −2,54 pp | **+0,02 pp ✓** (BR·PUB 184,8 M exposições, −0,01 pp; 27 UFs dp 0,14) |
| `pr2_deploy/` Paraná | −2,04 pp | **✗ "sem dados suficientes pra avaliar"** |

## DECISÃO — o Paraná fica em D=1,7 até 2027

Tomada em 31/07/2026. As análises do ano foram fechadas em cima dos valores
publicados; mudar agora seria retrabalho para a equipe inteira. **O painel PR
não deve ser rebuildado nem republicado com D=1 neste ciclo.** O nacional
seguiu corrigido e verificado (+0,02 pp).

Consequência prática para qualquer trabalho novo no PR: **nada que exija rodar
o `build_db.py`**, porque ele recalcula o `p_esp` e traria o D=1 junto sem
pedir licença. Features novas têm que entrar por script separado que só escreva
no que precisa — foi assim que o `build_alternativas.py` foi feito.

## Escolas particulares removidas do painel (06/08)

Decisão do cliente: o painel PR não apresenta mais rede privada — nem
agregado, nem escola nomeada, nem por link direto. "Esconder o botão" não
bastava: havia três vazamentos (aba "Todas as redes" misturando privada no
agregado; filtro "Todas" do ranking listando privada por padrão,
independente das abas T/PUB/PRIV; e `?rede=T`/`?rede=PRIV` na URL sendo
honrado mesmo com o botão escondido). A remoção foi feita na origem do dado,
não só na tela:

- `escolas/{mun}.json` e `entidade/ESC/{inep}.json`: nunca mais incluem
  escola com `dependencia==4`. Testado com controle positivo: busca por
  "militar" (pública) encontra normal, busca por uma escola particular
  conhecida dá "Nenhuma escola encontrada" — o dado não existe, não é só
  filtro de tela.
- `historico/ESC/`: mesmo filtro na consulta SQL de
  `pipeline/build_historico_esc_pr.py` (`AND dependencia != 4`).
- `top_escolas_full/UF/PR.json` (ranking) e `top_escolas/{UF,MUN}/*.json`
  (mapa): particulares fora da lista `T`; chave `PRIV` removida. Ranking foi
  de 789 para 624 escolas.
- `pr2/filtros.js`: `REDES = new Set(["PUB"])` — único ponto que lê `rede`
  da URL em todas as páginas; qualquer outro valor cai no default. Fecha o
  vazamento por link mesmo com todos os botões escondidos.
- Botões "Todas as redes" e "Privadas" saíram de index/mapa/criticas;
  "Privada" saiu do filtro de dependência do ranking.

**Residual documentado, não tocado por decisão de escopo:** `entidade/UF/`,
`entidade/MUN/`, `historico/UF`, `historico/MUN`, `refs/PR.json`,
`data/nre_agg.json`, `data/hist_nota_pr.json` continuam com as chaves `T` e
`PRIV` — são agregados do estado/município, não escola nomeada, e o app
nunca os busca depois da remoção dos botões + filtros.js travado. Continuam
tecnicamente buscáveis batendo direto na URL do JSON. Se quiser blindagem
total até esse nível, é um trabalho separado (tirar/igualar essas chaves em
cada arquivo) — não fiz porque é maior, mais arriscado de testar sem
rebuild completo, e não expõe nome de escola nenhuma.

BR.json (referência nacional) não foi tocado — fora do escopo (não é
particular do Paraná).

## Redação ganhou aba própria — `redacao.html` (06/08)

A decisão de 02/08 (remover a redação de todo canto) **mudou**: em vez de
ficar fora do painel, ganhou página própria — `pr2/redacao.html` +
`pr2/redacao.js`, linkada no menu de todas as páginas com nav (index, mapa,
criticas, ranking_escolas). Conteúdo:

- **Dois números lado a lado**, cada um com o rótulo explícito no próprio
  cartão (`.kpi`, reaproveitado de `#kpis`): "Redação · oficial (Inep)" —
  presença no 1º dia, zero conta como nota — e "Redação · 2 dias, sem
  zeros" — só quem fez as duas provas e não zerou. Nenhum dos dois some ou
  fica sem legenda, ao contrário do que a versão de 31/07 fazia no painel
  geral.
- **Filtro NRE/município/escola**, igual ao do `index.html` (mesma cópia
  adaptada do padrão — este repo não compartilha módulo de filtro entre
  páginas, ver `habilidade.js`/`criticas.js`). Sem seletor de rede: só
  pública existe (ver decisão de escolas particulares acima).
- **Competências C1–C5**: valores oficiais, disponíveis em qualquer nível
  (UF/NRE/MUN/ESC já trazem `media_comp1..5`).
- **Ranking por redação**: cópia de `ranking_escolas.js` ordenada por
  `media_red`, consumindo o mesmo `api/top_escolas_full/UF/PR.json` (já sem
  particulares). Filtro por NRE e por dependência (sem "Privada", mesmo
  motivo).
- **O recorte "sem zeros" só existe hoje no nível UF** — `api/redacao/`
  (via `pipeline/build_redacao_uf.py`, que `deploy_pr2.py` agora chama a
  cada build, depois de copiar `entidade/UF/PR.json`) cobre só o estado.
  Ao filtrar por NRE/município/escola, o cartão degrada graciosamente:
  mostra "indisponível para esta seleção" em vez de número errado ou
  ausente sem explicação.

**Para cobrir município e escola no recorte sem zeros**, roda
`pipeline/build_redacao.py --deploy pr2_deploy --uf PR` (no `painelenem`,
precisa dos microdados) **depois** do `deploy_pr2.py`, nunca antes — o
`deploy_pr2.py` regenera `api/redacao/index.json` do zero a cada build
(só UF) e sobrescreveria a versão fina. Depois de rodar, o cartão passa a
funcionar em qualquer nível sem tocar no frontend.

Testado com Playwright: UF (543,1 oficial / 576,1 sem zeros, bate com os
números já registrados abaixo), município (oficial funciona, sem zeros
degrada), escola (oficial funciona), busca e ordenação do ranking. Zero
erro de JS; nav consistente nas 4 páginas.

### Correção 12/08 — duas afirmações sem lastro no card "Por que dois números"

Um usuário perguntou de onde saíam. Não saíam de lugar nenhum; foram
escritas por mim como se fossem propriedade medida do dado. **Removidas:**

1. *"— a mesma base que os relatórios oficiais usam"*. Afirmação sobre a
   metodologia de divulgação do INEP, sem nenhuma fonte consultada. Pior:
   provavelmente falsa. Nossa base filtra `CO_ESCOLA IS NOT NULL`, ou seja,
   só candidato com escola identificada — mais estreita que a base de
   divulgação do INEP, que não exige vínculo com escola.
2. *"(por fuga ao tema, anulação ou folha em branco)"*. Separar motivo de
   zero exige `TP_STATUS_REDACAO`, que o `build_db.py` lê para dentro da
   tabela (linha 108) e **nunca usa em cálculo** — está listado como aberto
   no item 4 de *Em aberto*. A lista ainda estava incompleta (o edital tem
   cópia, texto insuficiente, não atendimento ao tipo textual).

Ficou o que é medido: base = presentes no 1º dia (`n_lc = n_ch = n_red`,
54.062 na pública — os três batem exatamente) e zero entra como 0, não como
ausência (é o que produz os 21,5 pontos do recorte sem zeros).

**Resolvido no mesmo dia:** a palavra "oficial" saiu de toda a página, a
pedido — ela passava a ideia de que o INEP tinha calculado o número, quando
na verdade ele é calculado aqui a partir do microdado. O rótulo virou
**"1º dia, com zeros"**, que descreve a população e fica paralelo ao
"2 dias, sem zeros" do outro cartão. Trocado em 6 pontos: cartão
(`kpi-top`), cabeçalho da coluna do ranking, footnote do ranking, título do
parágrafo e mais duas menções no corpo do texto ("o número oficial" →
"o número do 1º dia, que é a leitura mais comum").

No `redacao.js`, `alvoOficial()` virou `alvoDia1()` e os comentários
acompanharam, pra não sobrar a palavra em lugar nenhum. Há um aviso no topo
do arquivo dizendo explicitamente pra não voltar a rotular como
"oficial (Inep)" — foi o que gerou a confusão.

Testado com Playwright: cartões em 543,1 e 576,1 (batem com os números já
registrados acima), 5 competências, 624 linhas no ranking, zero erro de JS.

**Segunda passada, no mesmo dia** — o usuário achou mais duas, que eu tinha
dado como limpas. Minha varredura buscou `oficial` e concluiu "nada no
HTML"; só que **"oficiais" não contém a substring "oficial"** (o 7º
caractere é `i`, não `l`). Verificar ausência com padrão estreito demais dá
falso negativo. Para varrer isto, use o radical: `grep -i "ofici\|divulg"`.

Removidas: o subtítulo da página (*"o número que o **Inep divulga**"* →
descrição da população) e o hint das competências (*"valores **oficiais
(Inep)**"* → *"média por competência · escala 0–200"*). As notas de cada
competência são atribuídas pelo INEP, mas a **média** é nossa.

**Critério, pra não errar de novo:** "oficial" descrevendo **insumo que o
INEP publica** está certo — gabarito, parâmetros TRI a/b/c, Matriz de
Referência, cadernos de prova, e o "Fonte: Microdados (INEP)" dos rodapés.
Está errado quando qualifica **agregado que nós calculamos**. Auditei as
outras páginas com esse critério: `criticas.html`, `entenda.html`,
`habilidade.html` e `index.html` usam a palavra só no sentido correto —
nada a mudar lá.

## Análise ganhou botão "Baixar PDF" (07/08)

`criticas.html` (página Análise) tem um botão **⬇ Baixar PDF** no card de
Filtros, ao lado do resumo. Não gera arquivo em JS — chama
`window.print()`; o navegador abre o diálogo nativo e o usuário escolhe
"Salvar como PDF" no destino. Zero dependência externa, e a tabela inteira
já está no DOM sem paginação/virtualização, então o que sai no PDF é
exatamente o filtro em tela (NRE/município/escola, área, anos ativos,
ordenação corrente).

`@media print` em `styles.css`: esconde nav/filtros interativos/botão do
PDF, tira o `overflow` do `.tbl-scroll`, poe a página em A4 paisagem,
repete o `<thead>` em cada página (`display: table-header-group`) e evita
quebrar uma linha no meio (`page-break-inside: avoid`). Um parágrafo
`.print-only` (`#crit-print-meta`, invisível na tela) mostra o resumo
completo do filtro + timestamp — só existe no papel, porque a tela já tem
o `#crit-alvo` (que o print, por sua vez, esconde pra não duplicar).

De caminho, `rotuloAlvo()` passou a mostrar o nome do município/escola em
vez do código/INEP cru (lê o texto já selecionado em `#sel-mun`/`#inp-esc`,
sem chamada nova) — bug pré-existente que ficava mais visível agora que o
nome vai pro cabeçalho do PDF.

Testado com Playwright gerando PDF de verdade (`page.pdf()`, A4 paisagem):
120 habilidades sem filtro vira 10 páginas, cabeçalho repete em todas,
nenhuma linha cortada no meio, última página termina limpa. Testado nos
três níveis (UF, município, escola) e com filtro de área/anos.

Só existe no `enemparana` — não replicado ainda no `painelenem` (painel
nacional). Se quiser lá também, é a mesma receita em `web/criticas.js` +
`web/styles.css`.

## PDF da Análise agora agrupa por área/competência (07/08)

Feedback direto: a tabela plana (120 linhas) "ficou mto longo" no PDF.
A tela continua **idêntica** — tabela plana, ordenável por qualquer coluna,
sem nenhuma mudança visual. Só o conteúdo impresso mudou.

`criticas.js`: extraí as células/linha (`cel`, `celEsp`, `celAno`,
`celDelta`, `linhaHtml`) e a ordenação (`ordenarLinhas`) pra funções de
topo de arquivo — antes viviam inline dentro do único `.map()` do
`render()`, duplicadas. `montarPrintAgrupado(linhas)` usa essas mesmas
funções: separa por área (`AREA_ORDER`, ou só a área filtrada), e dentro de
cada área por competência usando `window.COMPETENCIAS` (de
`competencias.js` — já estava carregado na página mas sem uso até agora).
Cada grupo de competência sai como uma mini-tabela própria, reusando o
`<thead>` real via `outerHTML` (mesmo cabeçalho, mesmas colunas).

HTML: novo `<div id="crit-print-agrupado" class="print-only">` dentro do
card da tabela, populado a cada `render()`. CSS: no `@media print`,
`#crit-tabela` (a plana) fica `display:none`, e o agrupado ganha estilo
próprio (título de área com borda colorida por área, subtítulo de
competência, `page-break-inside: avoid` nas mini-tabelas e
`page-break-after: avoid` nos títulos pra não sobrar cabeçalho órfão no
fim da página).

Testado com Playwright (`page.pdf()` real + render em PNG via pymupdf):
município com 120 habilidades → 15 páginas (mais que as 10 da versão
plana, porque cada competência não quebra no meio — algumas páginas
terminam com espaço em branco), 4 áreas e 30 competências aparecem, total
de linhas bate 120=120 (nada se perde no agrupamento). Testado também só
com área (MT): 1 título de área, 7 competências, 30 linhas. Sem erro de
JS.

Residual: o agrupamento aumenta a contagem de páginas em troca de
organização — é o trade-off esperado de não fragmentar uma competência
entre páginas. Não replicado no `painelenem` (mesma nota do item acima).

## Análise ganhou botão "Baixar Excel" (07/08)

Ao lado do "Baixar PDF" (renomeei a classe CSS `.btn-pdf` → `.btn-download`,
compartilhada pelos dois botões). Baixa a tabela plana — mesmo filtro,
mesma ordenação da tela — sem passar pelo `window.print()`.

Primeira versão gerava `.csv`; troquei por `.xlsx` de verdade a pedido
("o CSV pouca gente sabe trabalhar") — arquivo `xlsx_lite.js` (novo,
`pr2/`) monta o zip/OOXML na mão: zip em modo "store" (sem compressão, pra
não ter que reimplementar DEFLATE — CRC32 + estrutura de zip local/central
directory em ~90 linhas) + XML mínimo de planilha (uma aba, cabeçalho em
negrito, larguras de coluna fixas, primeira linha congelada). Zero
dependência externa, mesmo espírito do resto do site. Precisa estar na
lista `copiar` do `deploy_pr2.py` (adicionei).

Colunas de percentual saem como número puro (sem "%") pra continuar
somável/filtrável na planilha — a unidade fica só no cabeçalho da coluna
("2021 (%)", "Δ vs esperado (pp)"). Nome do arquivo usa o alvo do filtro
(`rotuloAlvo()`) fatiado em slug, ex.:
`analise_habilidades_curitiba_rede_publica.xlsx`. Reaproveita as mesmas
linhas computadas pelo `render()` (`ultimasLinhas`, guardada a cada
render) — nenhuma lógica de agregação duplicada.

Testado com Playwright (`page.waitForEvent('download')`) + `openpyxl` pra
validar de verdade a estrutura OOXML (não só que o zip abre): município
com 120 habilidades → planilha 121 linhas × 11 colunas, cabeçalho em
negrito, `A1:K121`, congelamento em `A2`, larguras aplicadas, sem warning
de style — abre limpo, sem diálogo de "reparo" do Excel.

Só existe no `enemparana` — não replicado no `painelenem` (mesma nota dos
itens de PDF acima).

## Em aberto

1. **`pr2_deploy` do rebuild ficou sem dado avaliável.** *Adiado* — deixou de
   ser urgente com a decisão acima, já que aquele rebuild não vai ao ar. Fica
   registrado para 2027: a mensagem é um `sys.exit` que só dispara quando
   nenhum item tem `p`, `p_esp` e `n` juntos, e não é limitação do verificador
   (a cópia pré-rebuild avalia normal). Diagnóstico:
   `python3 pipeline/diag_deploy.py deploy pr2_deploy`, mais
   `ls -l data/*.sqlite` e o fim do `rebuild-d1.log`.

1b. **Alternativas marcadas no carrossel** — frontend pronto e publicável
   (degrada para nada sem os dados). Falta rodar, na máquina com microdados:
   `python3 pipeline/build_alternativas.py --deploy pr2_deploy --uf PR`.
   Escreve só em `api/questoes/{ano}.json`; não toca em `p_esp`.
2. **`NU_PARAM_C` sem guarda.** A fórmula nova referencia `c`; em SQL
   `NULL + x = NULL`, então item sem `c` cadastrado agora rende `p_esp` nulo
   (a antiga nunca tocava em `c`). Conserto: `COALESCE(i.NU_PARAM_C, 0)` —
   vira 2PL no item sem `c`, melhor que perder o item. Não aplicado.
3. **Publicar o nacional.** Calibração conferida. Falta commitar o `deploy/`
   reconstruído, dar push e mergear o PR #2.
4. **Redação: três populações diferentes nos dados publicados.** Medido em
   31/07 no `pr2_deploy` (UF/PR, rede T):

   | fonte | n | zeros |
   |---|---|---|
   | `resumo.n_red` (base do `media_red` = 575,2) | 68.990 | inclui, sem contar |
   | `hist_nota` da entidade | 64.685 | 2.027 no bucket 0 |
   | `data/hist_nota_pr.json` | 66.134 | exclui (filtro `> 0`) |

   **RESOLVIDO em 01/08:** as três não são arbitrárias, são dias de prova.
   `n_lc = n_ch = n_red = 68.990` é **presença no dia 1**;
   `n_cn = n_mt = 64.794` é **presença no dia 2**; o `hist_nota` com 64.685
   é **quem foi nos dois dias** (99,83% do dia 2 — as seis áreas têm
   exatamente o mesmo total porque é a interseção). Não é bug: são recortes
   diferentes, e o painel mistura os dois sem rotular.

   O que sobra de fato a consertar: **o painel não diz qual recorte cada
   número usa**. `media_red` (575,2) é dia 1; qualquer média de CN/MT é dia 2.
   Rotular isso na UI vale mais que mudar o cálculo.

   Ainda em aberto: separar anulação de folha em branco exige
   `TP_STATUS_REDACAO`, que só está nos microdados — script separado, não
   pode rodar o `build_db.py` (ver a DECISÃO acima).

4b. **Estudo da redação sem os zeros** (31/07, a partir dos agregados):
   3,13% zeraram no estado — 3,80% na pública contra 0,80% na privada.
   Tirar os zeros levanta a média da pública em 21,5 pontos e a da privada
   em 5,6, então 16 dos 141,5 pontos de distância entre as redes são taxa de
   anulação, não escrita. A competência 5 é a maior distância (43 pontos,
   o dobro das outras). Entre os 32 NREs, 76 pontos de amplitude.
   Recorte **ambos os dias** (o `hist_nota`): 586,1 com zeros, 604,8 sem —
   ~11 pontos acima do recorte dia 1. Quem foi só no primeiro dia tira algo
   entre 370 e 460 (subtração com 15× de alavancagem, magnitude imprecisa).
5. **~150 MB de imagens de questão versionadas em git** nos dois repos.
   Vale decidir se saem para LFS ou ficam.
6. ~~**Linkar o Paraná ao git** pra poder publicar do celular.~~
   **FEITO** — já está ligado (produção = `main`). E em 12/08 a `main` foi
   posta em dia com o merge do branch `claude/enem-canal-bug-5g78e7`, então
   o risco de "republicar versão velha" que travava este item deixou de
   existir: `main` e produção passaram a ser a mesma coisa. Manter assim —
   se voltar a publicar só pelo manual, a divergência volta.

## PRs abertos

- `enemparana` #1 — título sem 2025, questões por habilidade, correções de
  front. Zero arquivo de dado alterado.
- `painelenem` #2 — replicação do PR v2 no nacional + correção do D no
  código. Zero arquivo de dado alterado (o dado vem do rebuild, à parte).

Nada foi mergeado na `main` de nenhum dos dois.

## Comandos que se usa toda hora

```bash
# rebuild completo D=1 dos dois painéis (backup automático antes)
cd ~/Documents/Microdados\ ENEM/plataforma
caffeinate -i bash pipeline/rebuild_d1.sh 2>&1 | tee rebuild-d1.log

# conferir calibração de um deploy
python3 pipeline/verifica_calibracao.py deploy
python3 pipeline/verifica_calibracao.py pr2_deploy

# por que um deploy ficou sem dado avaliável
python3 pipeline/diag_deploy.py deploy pr2_deploy

# levar edições de pr2/ do repo enemparana pra plataforma
rsync -a ~/Documents/enemparana/pr2/ ~/Documents/Microdados\ ENEM/plataforma/pr2/

# servir local
cd pr2_deploy && python3 -m http.server 9000
```

## Armadilhas já pisadas

- `rmtree` do rebuild apagava as questões (horas de PDF). `deploy_pr2.py` e
  `exporta_netlify.py` agora preservam com `os.rename` antes de limpar.
- `rebuild_d1.sh` usava `cp -al` e `du --apparent-size`, extensões GNU que
  não existem no BSD — abortava no macOS com `set -e`. Já portátil.
- Um `git add -A` num working tree sem o patch aplicado registrou a
  **deleção de 24 arquivos** (commit `f47484a`), restaurados em `7c10787`.
  Antes de mandar `git reset --hard`, confirmar o que há no working tree.
- Prévias `deploy_d1/` e `pr2_deploy_d1/` (gitignored) **não são
  publicáveis**: no nacional, 5.557 municípios e 29.290 escolas não têm
  `hist_nota` e ficam em D=1,7; no PR, só 2025 é corrigido. Servem pra
  inspeção visual, não pro ar.
