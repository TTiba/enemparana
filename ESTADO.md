# Estado atual — leia isto primeiro

Atualizado: **2026-07-31**

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
| **como publica** | **`netlify deploy --prod --dir=pr2_deploy`** — manual, **NÃO** ligado ao git | **push/merge na `main`** — Netlify ligado ao GitHub, deploy automático |

Isto já foi confundido duas vezes. O Paraná é manual; o nacional é
automático. Há também um Cloudflare Workers secundário
(`enemparana.pages.dev`, `wrangler.toml`, `CLOUDFLARE-SETUP.md`) marcado como
**em configuração** — auto-deploy a cada push em `main`; nunca confirmado
funcionando.

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
4. **Redação zerada.** `build_hist_nota_pr.py` filtra `> 0`, excluindo quem
   zerou a redação do histograma — mas `media_geral` os inclui.
   Inconsistência conhecida, nunca decidida.
5. **~150 MB de imagens de questão versionadas em git** nos dois repos.
   Vale decidir se saem para LFS ou ficam.
6. **Linkar o Paraná ao git** pra poder publicar do celular. Só depois de
   mergear o PR #1 — a `main` está 21 commits atrás e linkar agora
   republicaria a versão velha.

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
