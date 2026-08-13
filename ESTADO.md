# Estado atual — leia isto primeiro

Atualizado: **2026-08-13**

Arquivo curto e de manutenção obrigatória. Serve pra retomar o trabalho sem
reconstruir contexto de memória. Detalhe e histórico ficam no `status.md`
e no `status.md` do `painelenem`.

> Regra: ao terminar uma tanda de trabalho, atualize as seções **Onde está
> cada coisa**, **Em aberto** e a data acima. Se um fato aqui contradiz o
> `status.md`, este arquivo é o mais novo — mas confirme antes de agir.

---

## Os dois painéis

| | Paraná | Nacional |
|---|---|---|
| repo | `TTiba/enemparana` | `TTiba/painelenem` |
| clone local | `~/dev/enemparana` | `~/Documents/Microdados ENEM/plataforma` *(não conferido)* |
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

## Onde está cada coisa

Fonte do painel PR em `pr2/`; o build servido é `pr2_deploy/` (commitado —
editar `pr2/` **e** copiar para `pr2_deploy/`, senão o site não muda).

| página | arquivos | observação |
|---|---|---|
| Painel | `index.html` / `app.js` | KPIs, evolução, habilidades |
| Mapa | `mapa.html` / `mapa.js` | único que usa d3/topojson |
| Sua Escola | `escola.html` / `escola.js` | radares + distribuição; **sem ranking** |
| Análise | `criticas.html` / `criticas.js` | heatmap hab.×ano + downloads PDF/Excel |
| Redação | `redacao.html` / `redacao.js` | dois recortes, competências, ranking |
| Habilidade | `habilidade.html` / `habilidade.js` | drill-down de um item |
| Entenda | `entenda.html` | metodologia |

Módulos compartilhados: `filtros.js` (persistência de filtro entre páginas —
**único ponto que lê `rede` da URL**, travado em `PUB`), `habilidades.js`,
`competencias.js` (Matriz de Referência; usado pelo agrupamento do PDF),
`charts.js`, `tooltip.js`, `xlsx_lite.js` (gerador de `.xlsx`, sem
dependência externa), `styles.css` + `styles_pr.css`.

Scripts que **não** passam pelo `build_db.py` (portanto seguros sob a
decisão do D=1,7): `pipeline/build_historico_esc_pr.py`,
`build_redacao_uf.py`, `build_hist_nota_pr.py`, `build_nre_hist.py`,
`build_questoes_ano.py`, `build_alternativas.py`.

Arquivos novos e onde precisam ser registrados: qualquer `.js`/`.html` novo
em `pr2/` tem que entrar na lista `copiar` do `pr2/deploy_pr2.py`, senão
some no próximo rebuild.

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

## O que mudou na semana de 06–12/08

Narrativa completa, com o porquê de cada decisão, em `status.md`
§"Tanda 06–12/08". Aqui só o estado corrente e o que continua valendo.

**Escolas particulares fora do painel** (pedido do cliente, 06/08). Removidas
na origem do dado, não na tela: `escolas/`, `entidade/ESC/`,
`historico/ESC/`, `top_escolas*`. Ranking foi de 789 para 624 escolas.
`pr2/filtros.js` trava `REDES` em `PUB` — fecha o vazamento por
`?rede=T`/`?rede=PRIV` na URL em todas as páginas de uma vez.

> **Residual vivo, decisão de escopo:** `entidade/UF/`, `entidade/MUN/`,
> `historico/UF`, `historico/MUN`, `refs/PR.json`, `data/nre_agg.json` e
> `data/hist_nota_pr.json` ainda têm as chaves `T` e `PRIV`. São agregados
> de estado/município, não escola nomeada, e o app não os busca mais — mas
> continuam acessíveis batendo direto na URL do JSON. Blindar até esse nível
> é trabalho à parte. `BR.json` não foi tocado (é referência nacional).

**Redação em página própria** (06/08): `redacao.html` + `redacao.js`, dois
recortes lado a lado, competências C1–C5 e ranking por `media_red`. O
recorte "sem zeros" **só existe em nível UF**; abaixo disso a página degrada
com aviso explícito. Como cobrir os demais níveis: item 7 de *Em aberto*.

**Downloads na Análise** (07/08): "Baixar PDF" (`window.print()` + `@media
print`, agrupado por área e competência via `competencias.js`) e "Baixar
Excel" (`.xlsx` de verdade, via `pr2/xlsx_lite.js`, sem dependência
externa). A tabela em tela não mudou — só o impresso é agrupado.

**Auditoria de atribuição ao INEP** (12/08): saíram do `redacao.html` quatro
afirmações que davam a entender que o INEP calculou ou divulgou nossos
agregados. Os números não mudaram, só os rótulos: os cartões agora são
"1º dia, com zeros" e "2 dias, sem zeros".

> **Critério, pra não errar de novo:** "oficial" descrevendo **insumo que o
> INEP publica** está certo — gabarito, parâmetros TRI a/b/c, Matriz de
> Referência, cadernos de prova, "Fonte: Microdados (INEP)". Está errado
> quando qualifica **agregado que nós calculamos**. As outras páginas foram
> auditadas com esse critério e estão corretas.

> **Ao varrer isso, use o radical:** `grep -i "ofici\|divulg"`. Buscar
> `oficial` dá falso negativo — **"oficiais" não contém "oficial"** (7º
> caractere é `i`, não `l`). Foi assim que dei a página por limpa e deixei
> duas passarem.

## Ranking virou "Sua Escola" — `escola.html` (13/08)

A página de ranking foi **refeita do zero** a pedido. `ranking_escolas.html`
e `ranking_escolas.js` foram **apagados**; entraram `pr2/escola.html` +
`pr2/escola.js`. O menu agora diz "Sua Escola" em todas as páginas.

- **A tabela de classificação saiu inteira.** Consequência: os links "Ver
  todas as N escolas →" do `mapa.js` (painel de top-escolas, em NRE e UF)
  ficaram sem destino e foram removidos — o top-10 do mapa continua.
  O ranking **por redação** do `redacao.html` **não** foi tocado.
- **Dois radares lado a lado**, comparando escola × município × NRE ×
  Paraná: um com as 4 áreas do conhecimento, outro com as 5 competências da
  redação (recorte 1º dia, com zeros). **Legenda clicável** liga/desliga
  série; nunca deixa o gráfico vazio (bloqueia desligar a última).
  Em níveis acima da escola as séries inexistentes somem da legenda em vez
  de aparecer achatadas em zero.
- **`Charts.radar()` e `Charts.histograma()`** são novos em `charts.js`,
  SVG à mão como o resto (sem lib externa).
- **Contagem de alunos por área** + a diferença 1º/2º dia rotulada como
  abandono entre as provas.
- **Distribuição por faixa de nota** por área, de `data/hist_nota_pr.json`.

> **Duas ressalvas honestas nessa página, ambas visíveis na tela:**
>
> 1. **Não existe distribuição por escola.** O `hist_nota_pr.json` cobre
>    UF, NRE e MUN — não ESC. Então o histograma mostra o nível mais fino
>    disponível e **marca a média da escola dentro dele** ("onde minha
>    escola cai nessa distribuição"). O `escopoHist()` já prefere
>    `ESC/{inep}` se existir: se um dia o `build_hist_nota_pr.py` passar a
>    emitir esse nível, a página usa sozinha, sem mudar o frontend.
> 2. **O histograma exclui quem tirou zero** (`build_hist_nota_pr.py` filtra
>    `nota > 0`). Medido: nas quatro áreas isso descarta 0,03–0,22% dos
>    alunos, irrelevante; **na redação descarta 4,97%**, que são os zeros.
>    Como o `media_red` da escola **inclui** zeros, marcar essa média sobre
>    um histograma sem zeros compararia populações diferentes — por isso a
>    **redação mostra a distribuição mas não recebe a marca**, e diz o
>    porquê na legenda.

Sobre o radar: a escala **não começa em zero** (numa régua 0–1000 as
diferenças de 30–80 pontos somem). Por isso os anéis são **rotulados com o
valor** e há nota na página — sem isso o gráfico exagera diferença, que é a
crítica clássica ao radar de base deslocada.

Testado com Playwright nos quatro níveis (UF, NRE, MUN, ESC), com toggle da
legenda e "Limpar": zero erro de JS.

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
7. **Redação sem zeros por município/escola.** Hoje só existe em nível UF; o
   frontend já está pronto e degrada com aviso enquanto não houver dado.
   Falta rodar, na máquina com microdados:
   `python3 pipeline/build_redacao.py --deploy pr2_deploy --uf PR`,
   **depois** do `deploy_pr2.py` (ele regenera o `index.json` só com UF e
   sobrescreveria a versão fina).
8. **Estratificação: integrais, parceiras e cívico-militares.** *Bloqueado
   por dado que não existe.* Conferido: os microdados do ENEM **não** trazem
   essa classificação. Depende de a SEED mandar a lista de INEPs por
   categoria; com ela, é um `join` e nada mais.
9. **`TP_STATUS_REDACAO` é lido e nunca usado** (`build_db.py:108`). É o que
   permitiria separar motivo de zero (fuga ao tema × folha em branco ×
   anulação) — hoje o painel não afirma nada sobre isso, justamente por
   falta desse cálculo. Tem que ser script separado: rodar o `build_db.py`
   traz o D=1 junto, contra a decisão de 31/07.
10. **PDF/Excel e a página de Redação só existem no Paraná.** Não foram
    replicados no `painelenem`. Se quiser lá, é a mesma receita em
    `web/criticas.js` + `web/styles.css` (mais o `xlsx_lite.js`).

## PRs

- `enemparana` **#1 — FECHADO em 12/08**. Não foi fechado pelo botão de
  merge: publiquei com fast-forward direto (`git push origin
  claude/enem-canal-bug-5g78e7:main`) e o GitHub fechou o PR sozinho ao ver
  os commits na `main`. A `main` saiu de `f639294` (26/07) e recebeu 43
  commits de uma vez.
- `painelenem` #2 — replicação do PR v2 no nacional + correção do D no
  código. Zero arquivo de dado alterado (o dado vem do rebuild, à parte).
  **Continua aberto**, mas não foi verificado nesta sessão — o acesso do
  ambiente estava limitado ao repo `enemparana`. Confirme antes de agir.

O branch de trabalho segue sendo `claude/enem-canal-bug-5g78e7`, agora no
mesmo commit da `main`.

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
rsync -a ~/dev/enemparana/pr2/ ~/Documents/Microdados\ ENEM/plataforma/pr2/

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
