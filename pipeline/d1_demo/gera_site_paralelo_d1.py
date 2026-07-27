#!/usr/bin/env python3
"""Gera pr2_deploy_d1/ — cópia do site com o p_esp recalculado com D=1.

Demo da correção da constante da TRI (ver §Auditoria no status.md): o painel
publica p_esp calculado com a 3PL em D=1,7; a calibração contra o acerto
observado mostra que os parâmetros do INEP pedem D=1. Este script NÃO refaz o
pipeline — ele reprocessa os JSONs já publicados, recalculando p_esp item a
item a partir dos parâmetros oficiais (a, b, c) e da distribuição de notas da
seleção em buckets de 25 pontos (método validado contra os θ exatos da escola
Regente Feijó: 0,02 pp de erro agregado, 0,2 pp máx por item).

Escopo (dados pra comparação de Ponta Grossa):
  - entidade/UF/PR.json            (θ de data/hist_nota_pr.json, UF/PR)
  - entidade/MUN/4119905.json      (θ de hist_nota_pr.json, MUN/4119905)
  - entidade/ESC/41063325.json     (θ exatos da Feijó bucketizados,
                                    inglês/espanhol separados)
  - historico/{UF/PR,MUN/4119905,ESC/41063325}.json — só o bloco 2025.

Fora do escopo (mantém o valor antigo ou vira null):
  - Itens de língua estrangeira em UF/MUN: sem distribuição de θ por língua
    nesses níveis, p_esp vira null (a UI mostra "–") — melhor ausente que
    enviesado (na Feijó a dist. cheia erra até ±10 pp nesses itens).
  - Anos 2021-2024: parâmetros dos itens não estão neste repo.
  - Demais escolas e NREs.

Uso:  python3 pipeline/d1_demo/gera_site_paralelo_d1.py
      cd pr2_deploy_d1 && python3 -m http.server 9001
      (original em pr2_deploy na 9000 pra comparar lado a lado)
"""
import json
import math
import os
import shutil
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(AQUI))          # raiz do repo
DEPLOY = os.path.join(BASE, "pr2_deploy")
OUT = os.path.join(BASE, "pr2_deploy_d1")

PARAMS = json.load(open(os.path.join(AQUI, "params_itens_2025.json")))
FEIJO = json.load(open(os.path.join(AQUI, "feijo_buckets_2025.json")))
MUN_PG = "4119905"
ESC_FEIJO = "41063325"

BANNER = (
    '<div style="position:sticky;top:0;z-index:9999;background:#5b21b6;color:#fff;'
    'padding:8px 16px;font:600 13px system-ui;text-align:center">'
    "\U0001f9ea SITE PARALELO · p_esp recalculado com D=1 na 3PL · "
    "válido: PR / Ponta Grossa / Feijó, itens 2025 · "
    "itens EN·ES em UF/MUN ficam “–”</div>"
)


def p3pl(a, b, c, th):
    return c + (1 - c) / (1 + math.exp(-a * (th - b)))


def pesp_bucket(buckets, a, b, c):
    """Média da 3PL(D=1) sobre a distribuição de notas em buckets de 25."""
    tot = sum(buckets.values())
    if not tot:
        return None
    s = sum(n * p3pl(a, b, c, (int(k) + 12.5 - 500) / 100)
            for k, n in buckets.items())
    return round(s / tot, 3)


def corrigir_lista(rows, dists, n_area):
    """Recalcula p_esp de uma lista de itens [co,n,p,p_esp,hab,b,lingua?].

    dists: dict lingua→buckets; chave None = distribuição da área inteira.
    n_area: nº de alunos da área (itens com n < 90% disso são LEM/parciais).
    Devolve (corrigidos, anulados, intactos).
    """
    cor = anu = intact = 0
    for arr in rows:
        co, n, p, p_esp = arr[0], arr[1], arr[2], arr[3]
        lingua = arr[6] if len(arr) > 6 else None
        prm = PARAMS.get(str(co))
        if p_esp is None or prm is None:
            intact += 1
            continue
        parcial = n_area and n < 0.9 * n_area
        chave = lingua if parcial else None
        bk = dists.get(chave)
        if bk is None:            # parcial sem distribuição da língua → null
            arr[3] = None
            anu += 1
            continue
        arr[3] = pesp_bucket(bk, *prm)
        cor += 1
    return cor, anu, intact


def dists_de_hist(hist_nota, rede, chave):
    """Distribuições por área a partir do hist_nota_pr.json (sem língua)."""
    bloco = hist_nota["por_rede"][rede].get(chave)
    if not bloco:
        return None
    return {area: {None: bloco[area.lower()]} for area in ("CN", "CH", "LC", "MT")}


def dists_feijo():
    base = {area: {None: FEIJO[area]} for area in ("CN", "CH", "LC", "MT")}
    base["LC"][0] = FEIJO["LC_EN"]   # tp_lingua 0 = inglês
    base["LC"][1] = FEIJO["LC_ES"]   # tp_lingua 1 = espanhol
    return base


def n_area_de(dists):
    return {area: sum(d[None].values()) for area, d in dists.items()}


def patch_entidade(rel, dists_por_rede):
    caminho = os.path.join(OUT, "api", "entidade", rel)
    d = json.load(open(caminho, encoding="utf-8"))
    redes = list(d) if "T" in d else [None]      # ESC não tem camada de rede
    tot = [0, 0, 0]
    for rede in redes:
        bloco = d[rede] if rede else d
        dists = dists_por_rede(rede or "T")
        if not dists:
            continue
        nA = n_area_de(dists)
        for area, rows in bloco["itens"].items():
            r = corrigir_lista(rows, dists[area], nA[area])
            tot = [a + b for a, b in zip(tot, r)]
    os.remove(caminho)                            # quebra o hardlink
    json.dump(d, open(caminho, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"  entidade/{rel}: {tot[0]} corrigidos · {tot[1]} anulados (LEM) · {tot[2]} intactos")


def patch_historico(rel, dists_por_rede):
    caminho = os.path.join(OUT, "api", "historico", rel)
    if not os.path.exists(caminho):
        print(f"  historico/{rel}: ausente, pulando")
        return
    d = json.load(open(caminho, encoding="utf-8"))
    tot = [0, 0, 0]
    for rede, bloco in d.items():
        if rede not in ("T", "PUB", "PRIV") or not isinstance(bloco, dict):
            continue
        dists = dists_por_rede(rede)
        lst2025 = bloco.get("por_ano", {}).get("2025")
        if not dists or not lst2025:
            continue
        nA = n_area_de(dists)
        for area, rows in lst2025.items():
            r = corrigir_lista(rows, dists[area], nA[area])
            tot = [a + b for a, b in zip(tot, r)]
    os.remove(caminho)
    json.dump(d, open(caminho, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"  historico/{rel} (2025): {tot[0]} corrigidos · {tot[1]} anulados · {tot[2]} intactos")


def main():
    if not os.path.isdir(DEPLOY):
        sys.exit(f"pr2_deploy/ não encontrado em {DEPLOY}")
    print(f"Clonando {DEPLOY} → {OUT} (hardlinks)…")
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(DEPLOY, OUT, copy_function=os.link)

    hist_nota = json.load(open(os.path.join(DEPLOY, "data", "hist_nota_pr.json"),
                               encoding="utf-8"))

    print("Recalculando p_esp com D=1…")
    patch_entidade(os.path.join("UF", "PR.json"),
                   lambda rede: dists_de_hist(hist_nota, rede, "UF/PR"))
    patch_entidade(os.path.join("MUN", f"{MUN_PG}.json"),
                   lambda rede: dists_de_hist(hist_nota, rede, f"MUN/{MUN_PG}"))
    patch_entidade(os.path.join("ESC", f"{ESC_FEIJO}.json"),
                   lambda rede: dists_feijo())
    patch_historico(os.path.join("UF", "PR.json"),
                    lambda rede: dists_de_hist(hist_nota, rede, "UF/PR"))
    patch_historico(os.path.join("MUN", f"{MUN_PG}.json"),
                    lambda rede: dists_de_hist(hist_nota, rede, f"MUN/{MUN_PG}"))
    patch_historico(os.path.join("ESC", f"{ESC_FEIJO}.json"),
                    lambda rede: dists_feijo())

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

    print(f"\n✓ pronto — original: cd pr2_deploy    && python3 -m http.server 9000")
    print(f"           corrigido: cd pr2_deploy_d1 && python3 -m http.server 9001")


if __name__ == "__main__":
    main()
