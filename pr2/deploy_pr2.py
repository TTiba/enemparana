#!/usr/bin/env python3
"""Empacota o pr2/ como build estático pra Netlify (variante Paraná v2).

Difere de pr/deploy_netlify.py por incluir todo o material que a v2 herda
do web/ nacional: série histórica 2021–2025 (historico/, refs_hist/),
habilidades cross-year (habilidades/) e ranking completo de escolas
(top_escolas/, top_escolas_full/). Deploy é não-listado (X-Robots-Tag).

Saída: plataforma/pr2_deploy/  (~30–40 MB estimado)
"""
import json
import os
import shutil
import sqlite3
import subprocess

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PR2 = os.path.join(BASE, "pr2")
DEPLOY_ORIG = os.path.join(BASE, "deploy")
API_ORIG = os.path.join(DEPLOY_ORIG, "api")
OUT = os.path.join(BASE, "pr2_deploy")
DB = os.path.join(BASE, "data", "enem2025.sqlite")


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- limpar out
# As questões (api/questoes/*.json + questoes/{ano}/*.webp) vêm do deploy
# nacional e levam horas de PDF pra regerar. Preservamos com rename —
# instantâneo, mesmo com ~150 MB — pra que o rmtree não as destrua caso o
# deploy nacional ainda não as tenha.
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
log("Copiando front pr2/…")
copiar = [
    "index.html", "mapa.html", "criticas.html", "ranking_escolas.html",
    "priorizacao.html", "habilidade.html", "entenda.html", "redacao.html",
    "app.js", "mapa.js", "criticas.js", "ranking_escolas.js",
    "priorizacao.js", "habilidade.js", "habilidades.js", "redacao.js",
    "competencias.js", "charts.js", "filtros.js", "tooltip.js",
    "styles.css", "styles_pr.css", "brasao_pr.webp",
]
for f in copiar:
    src = os.path.join(PR2, f)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT, f))
    else:
        log(f"  ! ausente: {f}")


def inject_static(caminho):
    html = open(caminho, encoding="utf-8").read()
    if "API_STATIC" in html:
        return   # já está estático
    marker = "<script>window.LOCK_UF"
    if marker in html:
        html = html.replace(marker,
            '<script>window.API_STATIC = 1;</script>\n' + marker, 1)
    elif 'href="styles.css"' in html:
        html = html.replace('<link rel="stylesheet" href="styles.css">',
            '<link rel="stylesheet" href="styles.css">\n'
            '<script>window.API_STATIC = 1;</script>', 1)
    open(caminho, "w", encoding="utf-8").write(html)


for pag in ("index.html", "mapa.html", "criticas.html", "ranking_escolas.html",
            "priorizacao.html", "habilidade.html", "entenda.html", "redacao.html"):
    p = os.path.join(OUT, pag)
    if os.path.exists(p):
        inject_static(p)

# ---------------------------------------------------------------- data
log("Copiando data/ (NREs + priorização + hist NRE)…")
data_out = os.path.join(OUT, "data")
os.makedirs(data_out)
for f in ("nre_pr.geojson", "mun_pr.geojson", "nre_agg.json",
          "mun_to_cel.json", "nre_to_muns.json",
          "nre_hist_resumo.json", "hist_nota_pr.json",
          "priorizacao_habilidades_pr_estado.json",
          "priorizacao_habilidades_pr_estado.csv"):
    src = os.path.join(PR2, "data", f)
    if os.path.exists(src):
        shutil.copy(src, data_out)
    else:
        log(f"  ! data/ ausente: {f}")

# ---------------------------------------------------------------- api filtrada
log("Filtrando /api/ pra PR…")
api_out = os.path.join(OUT, "api")
os.makedirs(api_out)

# ufs.json → só PR
with open(os.path.join(API_ORIG, "ufs.json"), encoding="utf-8") as f:
    ufs = json.load(f)
ufs_pr = {rede: [u for u in lst if u["chave"] == "PR"]
          for rede, lst in ufs.items()}
with open(os.path.join(api_out, "ufs.json"), "w", encoding="utf-8") as f:
    json.dump(ufs_pr, f, ensure_ascii=False, separators=(",", ":"))

# municipios/PR.json
os.makedirs(os.path.join(api_out, "municipios"))
shutil.copy(os.path.join(API_ORIG, "municipios", "PR.json"),
            os.path.join(api_out, "municipios", "PR.json"))

with open(os.path.join(api_out, "municipios", "PR.json"), encoding="utf-8") as f:
    muns_pr = {m["chave"] for lst in json.load(f).values() for m in lst}
log(f"  {len(muns_pr)} municípios do PR")

# escolas/{cd_mun}.json — sem as particulares (decisão: painel PR não
# apresenta rede privada; ver ESTADO.md). Filtramos aqui em vez de só
# escondida no front porque o dado tem que sumir, não só o botão — senão
# ?rede=T ou um código INEP direto na URL continuariam expondo a escola.
os.makedirs(os.path.join(api_out, "escolas"))
n_esc_arq = 0
privadas_inep = set()
for cd in muns_pr:
    src = os.path.join(API_ORIG, "escolas", f"{cd}.json")
    if not os.path.exists(src):
        continue
    with open(src, encoding="utf-8") as f:
        lst = json.load(f)
    privadas_inep.update(e["chave"] for e in lst if e.get("dependencia") == 4)
    lst_pub = [e for e in lst if e.get("dependencia") != 4]
    with open(os.path.join(api_out, "escolas", f"{cd}.json"), "w", encoding="utf-8") as f:
        json.dump(lst_pub, f, ensure_ascii=False, separators=(",", ":"))
    n_esc_arq += 1
log(f"  {n_esc_arq} arquivos de escolas por município "
    f"({len(privadas_inep)} escolas privadas excluídas)")

# entidade/UF/PR.json + BR/BR.json (referência)
os.makedirs(os.path.join(api_out, "entidade", "UF"))
os.makedirs(os.path.join(api_out, "entidade", "BR"))
shutil.copy(os.path.join(API_ORIG, "entidade", "UF", "PR.json"),
            os.path.join(api_out, "entidade", "UF", "PR.json"))
shutil.copy(os.path.join(API_ORIG, "entidade", "BR", "BR.json"),
            os.path.join(api_out, "entidade", "BR", "BR.json"))

# api/redacao/index.json — recorte "2 dias, sem zeros" no nível UF, a partir
# do hist_nota que acabou de ser copiado (pipeline/build_redacao_uf.py). Só
# cobre o estado; município e escola vêm de pipeline/build_redacao.py (no
# painelenem), que precisa dos microdados e roda à parte — se você já
# rodou aquele script, RODE-O DE NOVO DEPOIS deste deploy, senão este passo
# aqui sobrescreve o arquivo com a versão só-UF.
log("Gerando api/redacao/ (recorte de redação sem zeros, nível UF)…")
r = subprocess.run(["python3", os.path.join(BASE, "pipeline", "build_redacao_uf.py")],
                    capture_output=True, text=True)
if r.returncode != 0:
    log("  ! build_redacao_uf.py falhou:")
    log(r.stderr)
else:
    for linha in r.stdout.strip().splitlines()[-2:]:
        log("  " + linha)

# entidade/MUN/{cd}.json (só PR)
os.makedirs(os.path.join(api_out, "entidade", "MUN"))
for cd in muns_pr:
    src = os.path.join(API_ORIG, "entidade", "MUN", f"{cd}.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(api_out, "entidade", "MUN", f"{cd}.json"))

# entidade/ESC/{inep}.json — INEPs PR do sqlite
log("  descobrindo INEPs das escolas PR…")
con = sqlite3.connect(DB)
inep_pr = [r[0] for r in con.execute("SELECT chave FROM escolas WHERE uf='PR'")]
con.close()
log(f"  {len(inep_pr)} escolas do PR no banco")

os.makedirs(os.path.join(api_out, "entidade", "ESC"))
n_esc_ent = 0
for inep in inep_pr:
    if inep in privadas_inep:
        continue
    src = os.path.join(API_ORIG, "entidade", "ESC", f"{inep}.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(api_out, "entidade", "ESC", f"{inep}.json"))
        n_esc_ent += 1
log(f"  {n_esc_ent} JSONs de entidade/ESC copiados (privadas excluídas)")

# refs/PR.json + BR.json
os.makedirs(os.path.join(api_out, "refs"))
for chave in ("PR", "BR"):
    src = os.path.join(API_ORIG, "refs", f"{chave}.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(api_out, "refs", f"{chave}.json"))

# ===== extensões da v2 pr2 =====

# historico/UF/PR.json + BR/BR.json + MUN/{cd}.json
log("Copiando historico/ (UF/PR, BR/BR, MUN/{cd})…")
if os.path.exists(os.path.join(API_ORIG, "historico")):
    os.makedirs(os.path.join(api_out, "historico", "UF"), exist_ok=True)
    os.makedirs(os.path.join(api_out, "historico", "BR"), exist_ok=True)
    os.makedirs(os.path.join(api_out, "historico", "MUN"), exist_ok=True)
    for src, rel in [
        (os.path.join(API_ORIG, "historico", "UF", "PR.json"), "UF/PR.json"),
        (os.path.join(API_ORIG, "historico", "BR", "BR.json"), "BR/BR.json"),
    ]:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "historico", rel))
    n_hist_mun = 0
    for cd in muns_pr:
        src = os.path.join(API_ORIG, "historico", "MUN", f"{cd}.json")
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "historico", "MUN", f"{cd}.json"))
            n_hist_mun += 1
    log(f"  {n_hist_mun} arquivos historico/MUN")
else:
    log("  historico/ ausente no deploy nacional — pulando")

# refs_hist/{ano}/BR.json + UF/PR.json
log("Copiando refs_hist/ (BR, UF/PR)…")
rh_orig = os.path.join(API_ORIG, "refs_hist")
if os.path.exists(rh_orig):
    for ano in os.listdir(rh_orig):
        ano_dir = os.path.join(rh_orig, ano)
        if not os.path.isdir(ano_dir):
            continue
        os.makedirs(os.path.join(api_out, "refs_hist", ano, "UF"), exist_ok=True)
        br = os.path.join(ano_dir, "BR.json")
        pr = os.path.join(ano_dir, "UF", "PR.json")
        if os.path.exists(br):
            shutil.copy(br, os.path.join(api_out, "refs_hist", ano, "BR.json"))
        if os.path.exists(pr):
            shutil.copy(pr, os.path.join(api_out, "refs_hist", ano, "UF", "PR.json"))
else:
    log("  refs_hist/ ausente — pulando")

# top_escolas/UF/PR.json + BR/BR.json + MUN/{cd}.json
# PR.json e MUN/{cd}.json são recortes desta UF: sem a chave PRIV, e a lista
# "T" (todas as redes juntas) sem as escolas privadas. BR.json fica intacto —
# é referência nacional, fora do escopo da decisão de retirar as particulares
# do PR.
log("Copiando top_escolas/…")


def sem_privadas_top(caminho):
    with open(caminho, encoding="utf-8") as f:
        d = json.load(f)
    d.pop("PRIV", None)
    if "T" in d:
        d["T"] = [e for e in d["T"] if e.get("dependencia") != 4]
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))


te_orig = os.path.join(API_ORIG, "top_escolas")
if os.path.exists(te_orig):
    os.makedirs(os.path.join(api_out, "top_escolas", "UF"), exist_ok=True)
    os.makedirs(os.path.join(api_out, "top_escolas", "BR"), exist_ok=True)
    os.makedirs(os.path.join(api_out, "top_escolas", "MUN"), exist_ok=True)
    for src, rel in [
        (os.path.join(te_orig, "UF", "PR.json"), "UF/PR.json"),
        (os.path.join(te_orig, "BR", "BR.json"), "BR/BR.json"),
        (os.path.join(te_orig, "BR.json"),       "BR.json"),
    ]:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "top_escolas", rel))
    sem_privadas_top(os.path.join(api_out, "top_escolas", "UF", "PR.json"))
    n_te_mun = 0
    for cd in muns_pr:
        src = os.path.join(te_orig, "MUN", f"{cd}.json")
        if os.path.exists(src):
            dst = os.path.join(api_out, "top_escolas", "MUN", f"{cd}.json")
            shutil.copy(src, dst)
            sem_privadas_top(dst)
            n_te_mun += 1
    log(f"  {n_te_mun} arquivos top_escolas/MUN (sem PRIV, T sem particulares)")

# top_escolas_full/UF/PR.json + BR.json
log("Copiando top_escolas_full/…")
tef_orig = os.path.join(API_ORIG, "top_escolas_full")
if os.path.exists(tef_orig):
    os.makedirs(os.path.join(api_out, "top_escolas_full", "UF"), exist_ok=True)
    for src, rel in [
        (os.path.join(tef_orig, "UF", "PR.json"), "UF/PR.json"),
        (os.path.join(tef_orig, "BR.json"),       "BR.json"),
    ]:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(api_out, "top_escolas_full", rel))
    # PR.json é lista plana (todas as redes juntas) — mesma exclusão do
    # ranking. BR.json não é tocado, mesmo motivo do top_escolas/ acima.
    pr_full = os.path.join(api_out, "top_escolas_full", "UF", "PR.json")
    if os.path.exists(pr_full):
        with open(pr_full, encoding="utf-8") as f:
            lst = json.load(f)
        lst = [e for e in lst if e.get("dependencia") != 4]
        with open(pr_full, "w", encoding="utf-8") as f:
            json.dump(lst, f, ensure_ascii=False, separators=(",", ":"))

# habilidades/ (BR-wide, copiado como está)
log("Copiando habilidades/ (BR-wide)…")
hb_orig = os.path.join(API_ORIG, "habilidades")
if os.path.exists(hb_orig):
    shutil.copytree(hb_orig, os.path.join(api_out, "habilidades"))

# questoes/{ano}.json + as imagens WebP das provas que elas referenciam.
# Sem isso a seção "Questões desta habilidade" de habilidade.html não aparece.
# habilidade.js só consome 2025 hoje; a lista explícita evita arrastar as
# imagens de anos que nenhuma tela exibe.
ANOS_QUESTOES = ("2021", "2022", "2023", "2024", "2025")
log("Copiando questoes/ + imagens das provas…")
q_orig = os.path.join(API_ORIG, "questoes")
if os.path.exists(q_orig):
    os.makedirs(os.path.join(api_out, "questoes"), exist_ok=True)
    n_img, n_falta = 0, 0
    for ano in ANOS_QUESTOES:
        src = os.path.join(q_orig, f"{ano}.json")
        if not os.path.exists(src):
            log(f"  ! questoes/{ano}.json ausente no deploy nacional")
            continue
        shutil.copy(src, os.path.join(api_out, "questoes", f"{ano}.json"))
        with open(src, encoding="utf-8") as f:
            quest = json.load(f)
        # imgs[] guarda caminhos relativos à raiz do site nacional (deploy/),
        # não à raiz de api/ — replicamos o mesmo caminho dentro de pr2_deploy
        # pra não precisar reescrever o JSON nem hardcodar o nome do diretório.
        for q in (quest.get("itens") or {}).values():
            for rel in q.get("imgs") or []:
                rel = os.path.normpath(rel.lstrip("/"))
                if rel.startswith(".."):
                    continue
                img_src = os.path.join(DEPLOY_ORIG, rel)
                if not os.path.exists(img_src):
                    n_falta += 1
                    continue
                img_dst = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(img_dst), exist_ok=True)
                shutil.copy(img_src, img_dst)
                n_img += 1
    log(f"  {n_img} imagens de questões copiadas"
        + (f" · {n_falta} ausentes no deploy nacional" if n_falta else ""))
else:
    log("  ! questoes/ ausente no deploy nacional — rode o pipeline de "
        "questões lá antes; a seção 'Questões desta habilidade' fica vazia")

# historico/ESC/{inep}.json — chama script que agrega hist_item por escola PR
log("Gerando historico/ESC/ (2024+2025 por escola do PR)…")
script_esc = os.path.join(BASE, "pipeline", "build_historico_esc_pr.py")
r = subprocess.run(["python3", script_esc], capture_output=True, text=True)
if r.returncode != 0:
    log("  ! build_historico_esc_pr.py falhou:")
    log(r.stderr)
else:
    for linha in r.stdout.strip().splitlines()[-2:]:
        log("  " + linha)

# ---------------------------------------------------------------- robots + toml
with open(os.path.join(OUT, "robots.txt"), "w") as f:
    f.write("User-agent: *\nDisallow: /\n")

with open(os.path.join(OUT, "netlify.toml"), "w", encoding="utf-8") as f:
    f.write('[build]\n  publish = "."\n\n'
            '[[headers]]\n'
            '  for = "/*"\n'
            '  [headers.values]\n'
            '    X-Robots-Tag = "noindex, nofollow"\n')

# ---------------------------------------------------------------- resumo
total, n_arq = 0, 0
for raiz, _, arquivos in os.walk(OUT):
    for a in arquivos:
        p = os.path.join(raiz, a)
        total += os.path.getsize(p)
        n_arq += 1
log(f"\n✓ Deploy PR v2 pronto — {n_arq:,} arquivos · {total/1e6:.1f} MB em {OUT}")
log(f"  local:   cd {OUT} && python3 -m http.server 9000")
log(f"  Netlify: cd {OUT} && netlify deploy --prod")
