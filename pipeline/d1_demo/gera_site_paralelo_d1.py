#!/usr/bin/env python3
"""Gera pr2_deploy_d1/ — cópia do site com o p_esp recalculado com D=1.

Demo da correção da constante da TRI (ver §Auditoria no status.md): o painel
publica p_esp calculado com a 3PL em D=1,7; a calibração contra o acerto
observado mostra que os parâmetros do INEP pedem D=1. Este script NÃO refaz o
pipeline — ele reprocessa os JSONs já publicados, recalculando p_esp item a
item a partir dos parâmetros oficiais (a, b, c) e da distribuição de notas da
seleção em buckets de 25 pontos.

COBERTURA (itens de 2025)
  UF/PR e os 399 municípios ... distribuição de θ exata (hist_nota_pr.json),
                                por rede (T/PUB/PRIV).
  32 NREs .................... automático: o painel agrega os municípios no
                                cliente (app.js:agregarItensNRE).
  ~2.052 escolas ............. distribuição do próprio município (na rede da
                                escola) deslocada pra bater com a média da
                                escola em cada área. Aproximação validada
                                contra os θ exatos da Feijó: erro médio
                                0,10 pp, máx 0,42 pp (contra 0,55/1,53 pp se
                                usasse o município sem deslocar).
  Feijó (41063325) ........... θ exatos da planilha, com inglês/espanhol
                                separados — único caso sem aproximação.

FORA DE ESCOPO (mantém o valor antigo ou vira null)
  - Itens de língua estrangeira fora da Feijó (identificados por tp_lingua,
    não por heurística de n): sem distribuição de θ por língua, p_esp vira
    null e a UI mostra "–". Na Feijó a distribuição cheia de LC erra até
    ±10 pp nesses itens, então ausente é melhor que enviesado.
  - **Anos 2021-2024**: só o bloco 2025 é corrigido, nos dois níveis
    (entidade e historico). A página de Análise, que agrega vários anos,
    mistura 2025 corrigido com 2021-2024 em D=1,7 — o que só se resolve
    de verdade no pipeline do plataforma (ver PATCH-build_db.md).

Uso:  python3 pipeline/d1_demo/gera_site_paralelo_d1.py
      cd pr2_deploy_d1 && python3 -m http.server 9001
      (original em pr2_deploy na 9000 pra comparar lado a lado)
"""
import glob
import json
import math
import os
import shutil
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(AQUI))          # raiz do repo
DEPLOY = os.path.join(BASE, "pr2_deploy")
OUT = os.path.join(BASE, "pr2_deploy_d1")

PARAMS = json.load(open(os.path.join(AQUI, "params_itens_2025.json")))
FEIJO = json.load(open(os.path.join(AQUI, "feijo_buckets_2025.json")))
ESC_FEIJO = "41063325"
AREAS = ("CN", "CH", "LC", "MT")

BANNER = (
    '<div style="position:sticky;top:0;z-index:9999;background:#5b21b6;color:#fff;'
    'padding:8px 16px;font:600 13px system-ui;text-align:center">'
    "\U0001f9ea SITE PARALELO · p_esp recalculado com D=1 na 3PL · "
    "PR, NREs, municípios e escolas · itens 2025 · "
    "escolas usam θ aproximado (exceto Feijó) · itens EN·ES ficam “–”</div>"
)


def p3pl(a, b, c, th):
    return c + (1 - c) / (1 + math.exp(-a * (th - b)))


def grade(buckets):
    """buckets {nota_base: n} → [(theta, peso_normalizado)] pronto pra somar."""
    tot = sum(buckets.values())
    if not tot:
        return None
    return [((int(k) + 12.5 - 500) / 100, n / tot) for k, n in buckets.items()]


def media_de(buckets):
    tot = sum(buckets.values())
    return sum(n * (int(k) + 12.5) for k, n in buckets.items()) / tot if tot else None


def pesp(pontos, a, b, c, shift=0.0):
    """Média da 3PL(D=1) sobre a grade. Deslocar θ em s == deslocar b em -s."""
    bb = b - shift
    return round(sum(w * p3pl(a, bb, c, t) for t, w in pontos), 3)


def corrigir(rows, grades, shift, grades_lingua=None):
    """Recalcula p_esp de [co, n, p, p_esp, hab, b, lingua?] in-place.

    grades: grade da área. grades_lingua: {tp_lingua: grade} quando houver.

    Itens de língua estrangeira (tp_lingua 0=inglês, 1=espanhol) são expostos
    só a parte dos alunos, então precisam da distribuição de θ daquele
    subgrupo; sem ela, p_esp vira None e a UI mostra "–".

    O tp_lingua é o teste exato. Antes eu inferia "exposição parcial" por
    n < 90% do total da área, o que quebrava em município pequeno: lá a
    exposição se fragmenta entre cadernos (ex.: Rio Bonito do Iguaçu, 30
    alunos, itens com n=14), e itens comuns eram anulados sem motivo.
    """
    cor = anu = 0
    for arr in rows:
        prm = PARAMS.get(str(arr[0]))
        if arr[3] is None or prm is None:
            continue
        lingua = arr[6] if len(arr) > 6 else None
        if lingua is not None:
            g = (grades_lingua or {}).get(lingua)
            if g is None:
                arr[3] = None
                anu += 1
                continue
            arr[3] = pesp(g, *prm)
        else:
            arr[3] = pesp(grades, *prm, shift=shift)
        cor += 1
    return cor, anu


def escrever(caminho, obj):
    os.remove(caminho)                                  # quebra o hardlink
    json.dump(obj, open(caminho, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))


def blocos_de_itens(doc):
    """Gera (rede, dict_area→rows) de um entidade/*.json ou historico/*.json."""
    for rede in ("T", "PUB", "PRIV"):
        bloco = doc.get(rede)
        if not isinstance(bloco, dict):
            continue
        if "itens" in bloco:                            # entidade
            yield rede, bloco["itens"]
        lst = bloco.get("por_ano", {}).get("2025")      # historico
        if lst:
            yield rede, lst


def patch_por_rede(caminho, grades_por_rede):
    """entidade/ e historico/ de UF e MUN — grade exata, sem deslocamento."""
    if not os.path.exists(caminho):
        return 0, 0
    doc = json.load(open(caminho, encoding="utf-8"))
    tot = [0, 0]
    for rede, itens in blocos_de_itens(doc):
        g = grades_por_rede.get(rede)
        if not g:
            continue
        for area, rows in itens.items():
            if area not in g:
                continue
            r = corrigir(rows, g[area][0], 0.0)
            tot = [x + y for x, y in zip(tot, r)]
    escrever(caminho, doc)
    return tot


def patch_escola(caminho, grades_mun, medias_esc, grades_lingua=None):
    """entidade/ESC e historico/ESC — grade do município deslocada."""
    if not os.path.exists(caminho):
        return 0, 0
    doc = json.load(open(caminho, encoding="utf-8"))
    tot = [0, 0]
    # entidade/ESC não tem camada de rede; historico/ESC tem (duplicada)
    alvos = list(blocos_de_itens(doc)) or [(None, doc.get("itens", {}))]
    for _, itens in alvos:
        for area, rows in itens.items():
            g = grades_mun.get(area)
            if not g:
                continue
            pontos, _n_mun, media_mun = g
            m_esc = medias_esc.get(area)
            shift = ((m_esc - media_mun) / 100) if m_esc is not None else 0.0
            r = corrigir(rows, pontos, shift, grades_lingua)
            tot = [x + y for x, y in zip(tot, r)]
    escrever(caminho, doc)
    return tot


def main():
    if not os.path.isdir(DEPLOY):
        sys.exit(f"pr2_deploy/ não encontrado em {DEPLOY}")
    t0 = time.time()
    print(f"Clonando {DEPLOY} → {OUT} (hardlinks)…")
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(DEPLOY, OUT, copy_function=os.link)

    hist = json.load(open(os.path.join(DEPLOY, "data", "hist_nota_pr.json"),
                          encoding="utf-8"))["por_rede"]

    def grades_de(chave):
        """{rede: {area: (grade, n, media)}} pra uma chave do hist_nota."""
        out = {}
        for rede in ("T", "PUB", "PRIV"):
            bloco = hist.get(rede, {}).get(chave)
            if not bloco:
                continue
            por_area = {}
            for area in AREAS:
                bk = bloco.get(area.lower())
                g = grade(bk) if bk else None
                if g:
                    por_area[area] = (g, sum(bk.values()), media_de(bk))
            if por_area:
                out[rede] = {a: (g, n) for a, (g, n, _) in por_area.items()}
                out[rede + "_full"] = por_area
        return out

    # ---------------------------------------------------------------- UF/PR
    print("Corrigindo UF/PR…")
    g_pr = grades_de("UF/PR")
    tot = [0, 0]
    for rel in (("entidade", "UF", "PR.json"), ("historico", "UF", "PR.json")):
        r = patch_por_rede(os.path.join(OUT, "api", *rel), g_pr)
        tot = [x + y for x, y in zip(tot, r)]
    print(f"  {tot[0]} itens corrigidos · {tot[1]} anulados (LEM)")

    # ------------------------------------------------------------ municípios
    print("Corrigindo municípios…")
    muns = [k.split("/")[1] for k in hist["T"] if k.startswith("MUN/")]
    grades_mun_cache = {}
    tot = [0, 0]
    for cd in muns:
        g = grades_de(f"MUN/{cd}")
        grades_mun_cache[cd] = g
        for rel in (("entidade", "MUN", f"{cd}.json"),
                    ("historico", "MUN", f"{cd}.json")):
            r = patch_por_rede(os.path.join(OUT, "api", *rel), g)
            tot = [x + y for x, y in zip(tot, r)]
    print(f"  {len(muns)} municípios · {tot[0]} itens corrigidos · {tot[1]} anulados")
    print("  (os 32 NREs saem corrigidos por agregação no cliente)")

    # ---------------------------------------------------------------- escolas
    print("Corrigindo escolas…")
    tot = [0, 0]
    n_esc = n_sem_mun = 0
    for caminho in sorted(glob.glob(os.path.join(OUT, "api", "entidade", "ESC", "*.json"))):
        inep = os.path.basename(caminho)[:-5]
        doc = json.load(open(caminho, encoding="utf-8"))
        alvo = doc.get("resumo", {}).get("alvo", {})
        esc = alvo.get("escola", {})
        cd = str(esc.get("co_municipio") or "")
        rede = "PRIV" if esc.get("dependencia") == 4 else "PUB"
        g = grades_mun_cache.get(cd, {}).get(rede + "_full")
        if not g:
            n_sem_mun += 1
            continue
        medias = {a: alvo.get(f"media_{a.lower()}") for a in AREAS}
        gl = None
        if inep == ESC_FEIJO:                            # único com θ exato
            g = {a: (grade(FEIJO[a]), sum(FEIJO[a].values()), media_de(FEIJO[a]))
                 for a in AREAS}
            medias = {a: media_de(FEIJO[a]) for a in AREAS}   # shift = 0
            gl = {0: grade(FEIJO["LC_EN"]), 1: grade(FEIJO["LC_ES"])}
        for rel in (("entidade", "ESC", f"{inep}.json"),
                    ("historico", "ESC", f"{inep}.json")):
            r = patch_escola(os.path.join(OUT, "api", *rel), g, medias, gl)
            tot = [x + y for x, y in zip(tot, r)]
        n_esc += 1
    print(f"  {n_esc} escolas · {tot[0]} itens corrigidos · {tot[1]} anulados"
          + (f" · {n_sem_mun} sem distribuição do município" if n_sem_mun else ""))

    # ---------------------------------------------------------------- banner
    print("Injetando banner nas páginas…")
    for f in os.listdir(OUT):
        if not f.endswith(".html"):
            continue
        caminho = os.path.join(OUT, f)
        html = open(caminho, encoding="utf-8").read()
        if "SITE PARALELO" in html:
            continue
        html = html.replace("<body>", "<body>\n" + BANNER, 1)
        html = html.replace("<title>", "<title>[D=1] ", 1)
        os.remove(caminho)
        open(caminho, "w", encoding="utf-8").write(html)

    print(f"\n✓ pronto em {time.time()-t0:.0f}s")
    print("  original:  cd pr2_deploy    && python3 -m http.server 9000")
    print("  corrigido: cd pr2_deploy_d1 && python3 -m http.server 9001")


if __name__ == "__main__":
    main()
