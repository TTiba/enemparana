#!/usr/bin/env python3
"""Empacota o mt/ como build estático (variante Mato Grosso).

Irmão do pr2/deploy_pr2.py, com três diferenças estruturais:

1. **Sem camada regional.** O Paraná tem NREs (Núcleos Regionais de Educação)
   e o painel inteiro é construído em cima disso. Mato Grosso não tem
   equivalente no dado do ENEM, então aqui é Estado → Município → Escola, e o
   mapa abre direto nos municípios, sem drill-down. Nenhum `nre_*.json` é
   gerado; o front detecta a ausência e esconde o seletor (`SEM_REGIONAL`).

2. **Não depende do sqlite.** O deploy_pr2.py lista as escolas do estado
   consultando `data/enem2025.sqlite`. Aqui a lista sai dos próprios
   `escolas/{cd}.json` do deploy nacional — mesma informação, sem precisar do
   banco, o que deixa o script rodável fora da máquina com os microdados.

3. **`historico/ESC/` depende do sqlite.** O deploy nacional não publica esse
   nível (só BR, MUN e UF). Este script tenta gerá-lo chamando
   `build_historico_esc_uf.py --uf MT`, que precisa do `data/enem_hist.sqlite`
   e do `data/enem2025.sqlite`; fora da máquina com os microdados isso falha
   de propósito e o script segue, avisando no fim. Sem esse nível, a Análise
   com uma escola selecionada cai no estado (o `criticas.js` diz isso na tela
   desde 16/09, mas o número continua sendo o do estado).

Uso:
    python3 pipeline/deploy_mt.py [--nacional CAMINHO] [--sem-imagens]

    --nacional     raiz do repo painelenem (default: ../painelenem ou
                   /home/user/painelenem)
    --sem-imagens  pula as ~150 MB de WebP das provas. A seção "Questões desta
                   habilidade" fica vazia, o resto funciona igual.

Saída: mt_deploy/
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

UF = "MT"
UF_NOME = "Mato Grosso"

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "mt")
OUT = os.path.join(BASE, "mt_deploy")


def log(msg):
    print(msg, flush=True)


def acha_nacional(arg):
    for c in filter(None, [arg,
                           os.path.join(os.path.dirname(BASE), "painelenem"),
                           "/home/user/painelenem"]):
        if os.path.isdir(os.path.join(c, "deploy", "api")):
            return c
    sys.exit("! repo painelenem não encontrado — passe --nacional CAMINHO")


ap = argparse.ArgumentParser()
ap.add_argument("--nacional")
ap.add_argument("--sem-imagens", action="store_true")
args = ap.parse_args()

NAC = acha_nacional(args.nacional)
DEPLOY_ORIG = os.path.join(NAC, "deploy")
API_ORIG = os.path.join(DEPLOY_ORIG, "api")
log(f"Painel nacional: {NAC}")

# ---------------------------------------------------------------- limpar out
# Mesma proteção do deploy_pr2.py: as imagens das provas levam horas pra
# regerar, então são preservadas por rename em vez de apagadas.
GUARDA = OUT + ".questoes_tmp"
if os.path.exists(GUARDA):
    shutil.rmtree(GUARDA)
preservados = []
for rel in ("questoes", os.path.join("api", "questoes")):
    orig = os.path.join(OUT, rel)
    if os.path.isdir(orig):
        dest = os.path.join(GUARDA, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.rename(orig, dest)
        preservados.append(rel)
if preservados:
    log(f"Questões preservadas do rmtree: {', '.join(preservados)}")

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

for rel in preservados:
    dest = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    os.rename(os.path.join(GUARDA, rel), dest)
if os.path.exists(GUARDA):
    shutil.rmtree(GUARDA)

# ---------------------------------------------------------------- front
log("Copiando front mt/…")
copiar = [
    "index.html", "mapa.html", "criticas.html", "escola.html",
    "ranking_escolas.html", "habilidade.html", "entenda.html", "redacao.html",
    "app.js", "mapa.js", "criticas.js", "escola.js",
    "ranking_escolas.js", "habilidade.js", "habilidades.js", "redacao.js",
    "competencias.js", "charts.js", "filtros.js", "tooltip.js", "xlsx_lite.js",
    "styles.css", "styles_mt.css",
]
for f in copiar:
    src = os.path.join(SRC, f)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT, f))
    else:
        log(f"  ! ausente: {f}")

for extra in ():   # MT nao usa guia/ (as capturas sao do painel do PR)
    s = os.path.join(SRC, extra)
    if os.path.isdir(s):
        shutil.copytree(s, os.path.join(OUT, extra), dirs_exist_ok=True)
        log(f"  {extra}/: {len(os.listdir(s))} arquivos")


def inject_static(caminho):
    html = open(caminho, encoding="utf-8").read()
    if "API_STATIC" in html:
        return
    marker = "<script>window.LOCK_UF"
    if marker in html:
        html = html.replace(marker, '<script>window.API_STATIC = 1;</script>\n' + marker, 1)
    open(caminho, "w", encoding="utf-8").write(html)


for pag in ("index.html", "mapa.html", "criticas.html", "escola.html",
            "ranking_escolas.html", "habilidade.html", "entenda.html",
            "redacao.html"):
    p = os.path.join(OUT, pag)
    if os.path.exists(p):
        inject_static(p)

# ---------------------------------------------------------------- data
log("Copiando data/ (malha de municípios)…")
data_out = os.path.join(OUT, "data")
os.makedirs(data_out)
geo = os.path.join(SRC, "data", f"mun_{UF.lower()}.geojson")
if os.path.exists(geo):
    shutil.copy(geo, data_out)
else:
    log(f"  ! mun_{UF.lower()}.geojson ausente — o mapa não desenha")

# ---------------------------------------------------------------- api
log(f"Filtrando /api/ pra {UF}…")
api_out = os.path.join(OUT, "api")
# exist_ok: o restore do GUARDA acima já recria api/questoes/, então a
# partir do 2º rebuild api/ existe antes desta linha.
os.makedirs(api_out, exist_ok=True)

with open(os.path.join(API_ORIG, "ufs.json"), encoding="utf-8") as f:
    ufs = json.load(f)
with open(os.path.join(api_out, "ufs.json"), "w", encoding="utf-8") as f:
    json.dump({rede: [u for u in lst if u["chave"] == UF]
               for rede, lst in ufs.items()}, f,
              ensure_ascii=False, separators=(",", ":"))

os.makedirs(os.path.join(api_out, "municipios"))
shutil.copy(os.path.join(API_ORIG, "municipios", f"{UF}.json"),
            os.path.join(api_out, "municipios", f"{UF}.json"))
with open(os.path.join(api_out, "municipios", f"{UF}.json"), encoding="utf-8") as f:
    muns = {m["chave"] for lst in json.load(f).values() for m in lst}
log(f"  {len(muns)} municípios de {UF}")

# escolas/{cd}.json — sem as particulares, como no painel do Paraná (o front
# está travado em rede pública; ver filtros.js). A lista de INEPs sai daqui,
# o que dispensa o sqlite.
os.makedirs(os.path.join(api_out, "escolas"))
inep_uf, privadas = set(), set()
n_arq = 0
for cd in muns:
    src = os.path.join(API_ORIG, "escolas", f"{cd}.json")
    if not os.path.exists(src):
        continue
    with open(src, encoding="utf-8") as f:
        lst = json.load(f)
    privadas.update(e["chave"] for e in lst if e.get("dependencia") == 4)
    pub = [e for e in lst if e.get("dependencia") != 4]
    inep_uf.update(e["chave"] for e in pub)
    with open(os.path.join(api_out, "escolas", f"{cd}.json"), "w", encoding="utf-8") as f:
        json.dump(pub, f, ensure_ascii=False, separators=(",", ":"))
    n_arq += 1
log(f"  {n_arq} arquivos de escolas · {len(inep_uf)} escolas públicas "
    f"({len(privadas)} privadas excluídas)")

# entidade/
for sub in ("UF", "BR", "MUN", "ESC"):
    os.makedirs(os.path.join(api_out, "entidade", sub), exist_ok=True)
shutil.copy(os.path.join(API_ORIG, "entidade", "UF", f"{UF}.json"),
            os.path.join(api_out, "entidade", "UF", f"{UF}.json"))
shutil.copy(os.path.join(API_ORIG, "entidade", "BR", "BR.json"),
            os.path.join(api_out, "entidade", "BR", "BR.json"))
for cd in muns:
    src = os.path.join(API_ORIG, "entidade", "MUN", f"{cd}.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(api_out, "entidade", "MUN", f"{cd}.json"))
n_ent = 0
for inep in inep_uf:
    src = os.path.join(API_ORIG, "entidade", "ESC", f"{inep}.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(api_out, "entidade", "ESC", f"{inep}.json"))
        n_ent += 1
log(f"  {n_ent} JSONs de entidade/ESC")

os.makedirs(os.path.join(api_out, "refs"))
for chave in (UF, "BR"):
    src = os.path.join(API_ORIG, "refs", f"{chave}.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(api_out, "refs", f"{chave}.json"))

# historico/ — UF, BR e MUN. ESC não existe no deploy nacional (ver docstring).
log("Copiando historico/…")
hist_orig = os.path.join(API_ORIG, "historico")
sem_hist_esc = True
if os.path.exists(hist_orig):
    for sub in ("UF", "BR", "MUN"):
        os.makedirs(os.path.join(api_out, "historico", sub), exist_ok=True)
    for src, rel in [
        (os.path.join(hist_orig, "UF", f"{UF}.json"), f"UF/{UF}.json"),
        (os.path.join(hist_orig, "BR", "BR.json"), "BR/BR.json"),
    ]:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "historico", rel))
    n = 0
    for cd in muns:
        src = os.path.join(hist_orig, "MUN", f"{cd}.json")
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "historico", "MUN", f"{cd}.json"))
            n += 1
    log(f"  {n} arquivos historico/MUN")
    if os.path.isdir(os.path.join(hist_orig, "ESC")) and \
       os.listdir(os.path.join(hist_orig, "ESC")):
        os.makedirs(os.path.join(api_out, "historico", "ESC"), exist_ok=True)
        n = 0
        for inep in inep_uf:
            src = os.path.join(hist_orig, "ESC", f"{inep}.json")
            if os.path.exists(src):
                shutil.copy(src, os.path.join(api_out, "historico", "ESC", f"{inep}.json"))
                n += 1
        log(f"  {n} arquivos historico/ESC")
        sem_hist_esc = n == 0

# historico/ESC/ — o nacional não publica esse nível, então geramos aqui a
# partir do enem_hist.sqlite, do mesmo jeito que o deploy_pr2.py faz pro PR.
# Sem os microdados na máquina isso falha, e é esperado: o AVISO no fim
# explica o que fica errado enquanto não rodar.
if sem_hist_esc:
    script_esc = os.path.join(BASE, "pipeline", "build_historico_esc_uf.py")
    if os.path.exists(script_esc):
        log(f"Gerando historico/ESC/ (2024+2025 por escola de {UF})…")
        r = subprocess.run(
            ["python3", script_esc, "--uf", UF, "--deploy", OUT],
            capture_output=True, text=True)
        if r.returncode != 0:
            motivo = (r.stderr or r.stdout).strip().splitlines()
            log("  ! não gerou: " + (motivo[-1] if motivo else "erro sem mensagem"))
        else:
            for linha in r.stdout.strip().splitlines()[-2:]:
                log("  " + linha)
            esc_dir = os.path.join(api_out, "historico", "ESC")
            sem_hist_esc = not (os.path.isdir(esc_dir) and os.listdir(esc_dir))

# refs_hist/
log("Copiando refs_hist/…")
rh = os.path.join(API_ORIG, "refs_hist")
if os.path.exists(rh):
    for ano in os.listdir(rh):
        d = os.path.join(rh, ano)
        if not os.path.isdir(d):
            continue
        os.makedirs(os.path.join(api_out, "refs_hist", ano, "UF"), exist_ok=True)
        for src, rel in [(os.path.join(d, "BR.json"), f"{ano}/BR.json"),
                         (os.path.join(d, "UF", f"{UF}.json"), f"{ano}/UF/{UF}.json")]:
            if os.path.exists(src):
                shutil.copy(src, os.path.join(api_out, "refs_hist", rel))


def sem_privadas_top(caminho):
    with open(caminho, encoding="utf-8") as f:
        d = json.load(f)
    d.pop("PRIV", None)
    if "T" in d:
        d["T"] = [e for e in d["T"] if e.get("dependencia") != 4]
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))


log("Copiando top_escolas/…")
te = os.path.join(API_ORIG, "top_escolas")
if os.path.exists(te):
    for sub in ("UF", "BR", "MUN"):
        os.makedirs(os.path.join(api_out, "top_escolas", sub), exist_ok=True)
    for src, rel in [(os.path.join(te, "UF", f"{UF}.json"), f"UF/{UF}.json"),
                     (os.path.join(te, "BR", "BR.json"), "BR/BR.json"),
                     (os.path.join(te, "BR.json"), "BR.json")]:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "top_escolas", rel))
    alvo = os.path.join(api_out, "top_escolas", "UF", f"{UF}.json")
    if os.path.exists(alvo):
        sem_privadas_top(alvo)
    n = 0
    for cd in muns:
        src = os.path.join(te, "MUN", f"{cd}.json")
        if os.path.exists(src):
            dst = os.path.join(api_out, "top_escolas", "MUN", f"{cd}.json")
            shutil.copy(src, dst)
            sem_privadas_top(dst)
            n += 1
    log(f"  {n} arquivos top_escolas/MUN")

log("Copiando top_escolas_full/ (base do ranking)…")
tef = os.path.join(API_ORIG, "top_escolas_full")
n_rank = 0
if os.path.exists(tef):
    os.makedirs(os.path.join(api_out, "top_escolas_full", "UF"), exist_ok=True)
    for src, rel in [(os.path.join(tef, "UF", f"{UF}.json"), f"UF/{UF}.json"),
                     (os.path.join(tef, "BR.json"), "BR.json")]:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "top_escolas_full", rel))
    alvo = os.path.join(api_out, "top_escolas_full", "UF", f"{UF}.json")
    if os.path.exists(alvo):
        with open(alvo, encoding="utf-8") as f:
            lst = json.load(f)
        lst = [e for e in lst if e.get("dependencia") != 4]
        n_rank = len(lst)
        with open(alvo, "w", encoding="utf-8") as f:
            json.dump(lst, f, ensure_ascii=False, separators=(",", ":"))
log(f"  {n_rank} escolas no ranking (≥30 alunos no 1º dia, sem privadas)")

log("Copiando habilidades/…")
hb = os.path.join(API_ORIG, "habilidades")
if os.path.exists(hb):
    shutil.copytree(hb, os.path.join(api_out, "habilidades"))

# questoes/ + imagens
ANOS = ("2021", "2022", "2023", "2024", "2025")
log("Copiando questoes/" + ("" if args.sem_imagens else " + imagens das provas") + "…")
# As questões são item-a-item do caderno AZUL — dado NACIONAL, idêntico pra
# qualquer UF. O deploy nacional hoje só publica 2025; 2021-2024 foram gerados
# localmente por pipeline/build_questoes_ano.py direto dentro do pr2_deploy/.
# Por isso a busca é em duas bases, nessa ordem.
BASES_Q = [b for b in (DEPLOY_ORIG, os.path.join(BASE, "pr2_deploy"))
           if os.path.isdir(os.path.join(b, "api", "questoes"))]
if BASES_Q:
    os.makedirs(os.path.join(api_out, "questoes"), exist_ok=True)
    n_img = n_falta = 0
    achados, faltando = [], []
    for ano in ANOS:
        base_q = next((b for b in BASES_Q
                       if os.path.exists(os.path.join(b, "api", "questoes", f"{ano}.json"))),
                      None)
        if base_q is None:
            faltando.append(ano)
            continue
        achados.append(ano)
        src = os.path.join(base_q, "api", "questoes", f"{ano}.json")
        shutil.copy(src, os.path.join(api_out, "questoes", f"{ano}.json"))
        if args.sem_imagens:
            continue
        with open(src, encoding="utf-8") as f:
            quest = json.load(f)
        for it in (quest.get("itens") or {}).values():
            # `recorte` (a miniatura da questão usada na coluna "Questão" da
            # Análise) fica FORA de `imgs` — copiar só `imgs` deixa 404.
            refs = list(it.get("imgs") or [])
            if it.get("recorte"):
                refs.append(it["recorte"])
            for rel in refs:
                rel = os.path.normpath(rel.lstrip("/"))
                if rel.startswith(".."):
                    continue
                img_src = os.path.join(base_q, rel)
                if not os.path.exists(img_src):
                    n_falta += 1
                    continue
                img_dst = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(img_dst), exist_ok=True)
                shutil.copy(img_src, img_dst)
                n_img += 1
    log(f"  anos com questões: {', '.join(achados) or 'nenhum'}")
    if faltando:
        log(f"  ! sem questoes/{{ano}}.json: {', '.join(faltando)} — a coluna "
            "\"Questão\" da Análise fica vazia nesses anos")
    if not args.sem_imagens:
        log(f"  {n_img} imagens" + (f" · {n_falta} ausentes" if n_falta else ""))

# redacao/ — recorte "2 dias, sem zeros", nível UF
log("Gerando api/redacao/…")
script = os.path.join(BASE, "pipeline", "build_redacao_uf.py")
r = subprocess.run(["python3", script, "--uf", UF, "--deploy", OUT],
                   capture_output=True, text=True)
if r.returncode != 0:
    log("  ! build_redacao_uf.py falhou:")
    log(r.stderr.strip()[:500])
else:
    for linha in r.stdout.strip().splitlines()[-2:]:
        log("  " + linha)

# ---------------------------------------------------------------- extras
with open(os.path.join(OUT, "robots.txt"), "w") as f:
    f.write("User-agent: *\nDisallow: /\n")
with open(os.path.join(OUT, "netlify.toml"), "w", encoding="utf-8") as f:
    f.write('[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n'
            '  [headers.values]\n    X-Robots-Tag = "noindex, nofollow"\n')

total = n_arq = 0
for raiz, _, arquivos in os.walk(OUT):
    for a in arquivos:
        total += os.path.getsize(os.path.join(raiz, a))
        n_arq += 1
log(f"\n✓ Deploy {UF} pronto — {n_arq:,} arquivos · {total/1e6:.1f} MB em {OUT}")
log(f"  local: cd {OUT} && python3 -m http.server 9001")

if sem_hist_esc:
    log("\n! AVISO — sem historico/ESC/: a página Análise com uma ESCOLA")
    log("  selecionada não tem série própria e cai no estado. A tela avisa")
    log("  isso em destaque, mas o número continua sendo o do estado.")
    log("  Para resolver, na máquina com os microdados:")
    log(f"    python3 pipeline/build_historico_esc_uf.py --uf {UF} --deploy {OUT}")
    log("  (precisa de data/enem_hist.sqlite e data/enem2025.sqlite)")
