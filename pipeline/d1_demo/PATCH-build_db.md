# Patch: remover o fator D=1,7 da 3PL no pipeline nacional

**Alvo:** repo `plataforma` (painelenem) — não está neste repositório, então
este patch foi escrito sem poder rodar. Siga o roteiro e valide com o
verificador do passo 4 antes de publicar.

## 1. Por quê

O `p_esp` (esperado pela TRI) é calculado com a logística de 3 parâmetros
aplicando a constante **D = 1,7**. Esse fator é uma *conversão de métrica*
entre o modelo de ogiva normal e o logístico — só se aplica a parâmetros
estimados na métrica normal. Os `a` publicados pelo INEP já vêm na métrica
logística, então o fator sobra e entorta a curva.

Evidência (auditoria de 27/07, detalhes no `status.md`): as notas TRI foram
calculadas pelo próprio INEP a partir dessas respostas e desses parâmetros,
então o modelo precisa reproduzir o acerto observado.

| população | alunos | erro com D=1 | erro com D=1,7 | D ótimo |
|---|---|---|---|---|
| Feijó (1 escola) | 200 | −0,14 pp | −2,88 pp | 0,98 |
| Ponta Grossa · PUB | 1.422 | −0,20 pp | −2,95 pp | 0,97 |
| Paraná · PUB | 50.328 | **+0,09 pp** | −2,41 pp | **1,02** |

Efeito na UI: a coluna "Δ esperado" fica inflada ~+2 a +3 pp, escondendo
déficits reais. Como o viés **cresce quanto mais fraca a população**
(−3,0 pp na rede pública contra −1,4 pp em todas as redes), ele também
distorce a comparação entre escolas — o oposto do que um painel de
priorização precisa.

## 2. Onde mexer

O cálculo vive no pipeline que gera `deploy/api/` (provavelmente
`build_db.py` ou o script de export). Localize:

```bash
cd ~/Documents/Microdados\ ENEM/plataforma
grep -rn "1\.7\|1\.702\|1,7" pipeline/*.py | grep -iv "versão\|version"
grep -rn "p_esp\|def p3pl\|exp(-" pipeline/*.py
```

A linha tem esta forma (nomes podem variar):

```python
# ANTES
p = c + (1 - c) / (1 + math.exp(-1.7 * a * (theta - b)))
```

```python
# DEPOIS
# Os parâmetros a publicados pelo INEP já estão na métrica logística; o
# fator D=1,7 (conversão ogiva normal → logística) não se aplica aqui.
# Calibração contra o acerto observado: erro +0,09 pp com D=1 contra
# -2,41 pp com D=1,7 (rede pública do PR, 50.328 alunos).
p = c + (1 - c) / (1 + math.exp(-a * (theta - b)))
```

Se estiver vetorizado em numpy, mesma coisa:

```python
# ANTES:  p = c + (1 - c) / (1 + np.exp(-1.7 * a * (theta - b)))
# DEPOIS: p = c + (1 - c) / (1 + np.exp(-a * (theta - b)))
```

**Não mude mais nada.** A agregação aluno a aluno (calcular Pij de cada aluno
e depois tirar a média) está correta e é o que dá o número certo — trocar por
"probabilidade no θ médio" introduziria um erro de 2,3 pp por desigualdade de
Jensen. Só o `1.7` sai.

⚠ Confira se o mesmo fator não aparece em mais de um lugar (export de itens,
histórico, refs). O `grep` do passo 2 lista todos.

## 3. Regerar

```bash
cd ~/Documents/Microdados\ ENEM/plataforma
python3 pipeline/exporta_netlify.py     # regera deploy/api/
python3 pr2/deploy_pr2.py               # regera pr2_deploy/
```

## 4. Validar (obrigatório antes de publicar)

```bash
cd ~/Documents/enemparana
rsync -a --delete ~/Documents/Microdados\ ENEM/plataforma/pr2_deploy/ pr2_deploy/
python3 pipeline/d1_demo/verifica_calibracao.py pr2_deploy
```

Esperado:

```
✓ CALIBRADO — erro médio +0,4 pp. O modelo reproduz o observado.
```

Se ainda aparecer `✗ DESCALIBRADO` com erro perto de −2 pp, o fator não foi
removido de todos os pontos do pipeline. Rode de novo o `grep` do passo 2.

Referência dos valores esperados: `pr2_deploy_d1/`, gerado por
`pipeline/d1_demo/gera_site_paralelo_d1.py`, já tem o resultado correto pro
PR, os municípios e as escolas em 2025 — dá pra comparar item a item.

## 5. Ressalva conhecida (não é causada por este patch)

O 3PL superestima a **rede privada** em ~+1,9 pp sob qualquer valor de D (o D
ótimo dela estoura 2,5, o que não faz sentido). Isso se sustenta com 14.452
alunos no estado, então não é ruído amostral — é desajuste de modelo,
consistente com a ausência de parâmetro de descuido (o 3PL não tem assíntota
superior menor que 1, e o efeito cresce com θ). O patch não piora nem resolve
isso; vale documentar como limitação no `entenda.html`.
