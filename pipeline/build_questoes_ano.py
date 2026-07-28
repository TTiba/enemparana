#!/usr/bin/env python3
"""Gera api/questoes/{ano}.json + imagens WebP a partir do caderno oficial.

Reproduz para outros anos o que o pipeline nacional gerou pro 2025: cada
página do caderno AZUL vira um WebP e cada item do caderno é mapeado pra(s)
página(s) onde a questão aparece.

Entradas:
  --ano       ex.: 2024
  --csv       ITENS_PROVA_{ano}.csv dos microdados (latin-1, ';')
  --pdf-d1    PDF do caderno impresso do 1º dia (LC+CH, questões 1-90)
  --pdf-d2    PDF do 2º dia (CN+MT, questões 91-180) — opcional
  --deploy    raiz do site (default: pr2_deploy)

Como acha o caderno certo: cruza os CO_ITEM de cada prova AZUL do CSV com os
CO_ITEM que o painel já usa em api/habilidades/ pro ano — a prova regular é a
que tem interseção total (o painel foi construído com o caderno majoritário).

Mapeamento questão→página: âncoras "QUESTÃO N" (e blocos "QUESTÕES N A M")
localizadas por posição no PDF, em ordem de leitura de 2 colunas. A questão
vai da sua âncora até a âncora seguinte; se a seguinte começa no topo da 1ª
coluna de outra página, a anterior termina na página anterior. Inglês e
espanhol repetem a numeração 1-5 — desambiguados pelo cabeçalho da seção.

Requisitos: pip install pymupdf pillow

Uso (2024, só dia 1 — CN/MT ficam pra quando houver o PDF do dia 2):
  python3 pipeline/build_questoes_ano.py --ano 2024 \\
      --csv ITENS_PROVA_2024.csv --pdf-d1 2024_PV_impresso_D1_CD1.pdf
"""
import argparse
import csv
import glob
import io
import json
import os
import re
import sys
import unicodedata

import pymupdf
from PIL import Image

LARGURA_WEBP = 1150          # mesma largura dos WebP de 2025
QUALIDADE_WEBP = 80
TOPO_COLUNA_PT = 120         # âncora acima disso na 1ª coluna = topo de página


def sem_acento(s):
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()


def achar_provas_regulares(csv_path, deploy, ano):
    """{CO_PROVA: {'area','dia',itens:{pos:...}}} das provas AZUL regulares."""
    rows = list(csv.DictReader(open(csv_path, encoding="latin-1"), delimiter=";"))
    painel = set()
    for f in glob.glob(os.path.join(deploy, "api", "habilidades", "*", "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        for it in d.get("por_ano", {}).get(str(ano), {}).get("itens", []):
            painel.add(int(it["CO_ITEM"]))
    if not painel:
        sys.exit(f"painel não tem itens de {ano} em api/habilidades/")

    por_prova = {}
    for r in rows:
        if r["TX_COR"].upper() != "AZUL":
            continue
        por_prova.setdefault(r["CO_PROVA"], []).append(r)

    regulares = {}
    for prova, its in por_prova.items():
        cos = {int(r["CO_ITEM"]) for r in its}
        inter = len(cos & painel)
        if inter >= 0.9 * len(cos):
            area = its[0]["SG_AREA"]
            dia = "DIA_1" if area in ("LC", "CH") else "DIA_2"
            regulares[prova] = {"area": area, "dia": dia, "rows": its,
                                "cobertura": f"{inter}/{len(cos)}"}
    return regulares


def ancoras_do_pdf(pdf_path):
    """[(questao, pagina_1based, coluna, y, eh_topo)] em ordem de leitura.

    Inclui blocos "QUESTÕES N A M": as questões N..M ganham âncora na posição
    do bloco (texto compartilhado conta como parte de todas elas).
    """
    doc = pymupdf.open(pdf_path)
    ancs = []
    for i, pg in enumerate(doc):
        meio = pg.rect.width / 2
        for x0, y0, x1, y1, txt, *_ in pg.get_text("blocks"):
            t = sem_acento(txt.upper())
            col = 0 if x0 < meio else 1
            topo = col == 0 and y0 < TOPO_COLUNA_PT
            for m in re.finditer(r"QUESTOES\s+(\d{1,3})\s+A\s+(\d{1,3})", t):
                for q in range(int(m.group(1)), int(m.group(2)) + 1):
                    ancs.append((q, i + 1, col, y0, topo))
            for m in re.finditer(r"QUESTAO\s+(\d{1,3})", t):
                ancs.append((int(m.group(1)), i + 1, col, y0, topo))
    ancs.sort(key=lambda a: (a[1], a[2], a[3]))
    return doc, ancs


def separar_linguas(ancs, doc):
    """Divide as âncoras das questões 1-5 em inglês (0) e espanhol (1).

    O caderno imprime o bloco de inglês inteiro antes do de espanhol e repete
    a numeração 1-5, então em ordem de leitura a 1ª ocorrência de cada questão
    é a de inglês e a 2ª é a de espanhol. (Não dá pra dividir procurando o
    cabeçalho 'ESPANHOL': a palavra já aparece nas instruções da capa —
    "opção espanhol" — antes do bloco de inglês.)
    """
    en, es = {}, {}
    for a in ancs:
        q = a[0]
        if q > 5:
            continue
        destino = en if q not in en else es
        destino.setdefault(q, []).append(a)
    return en, es


def paginas_da_questao(minha, proxima):
    """Páginas [início..fim] da questão dada sua âncora e a âncora seguinte."""
    ini = minha[1]
    if proxima is None:
        return [ini]
    fim = proxima[1]
    if fim > ini and proxima[4]:      # próxima começa no topo → não invade
        fim -= 1
    return list(range(ini, max(ini, fim) + 1))


def mapear(ancs, doc):
    """{(questao, tp_lingua|None): [paginas]} pra um caderno de um dia."""
    en, es = separar_linguas(ancs, doc)
    comuns = [a for a in ancs if a[0] > 5]
    # remove duplicatas de âncora da mesma questão comum (bloco + individual):
    # fica a primeira em ordem de leitura
    vistos, fluxo = set(), []
    for a in comuns:
        if a[0] not in vistos:
            vistos.add(a[0])
            fluxo.append(a)
    out = {}
    # comuns: a âncora seguinte no fluxo delimita
    for i, a in enumerate(fluxo):
        out[(a[0], None)] = paginas_da_questao(a, fluxo[i + 1] if i + 1 < len(fluxo) else None)
    # línguas: cada bloco é delimitado internamente; o fim do inglês é a 1ª
    # âncora do espanhol EM ORDEM DE LEITURA, e o fim do espanhol é a 1ª comum
    ordem = lambda a: (a[1], a[2], a[3])
    prim_es = min((a[0] for a in es.values()), key=ordem, default=None) if es else None
    prim_comum = fluxo[0] if fluxo else None
    for lingua, bloco, fim_externo in ((0, en, prim_es or prim_comum),
                                        (1, es, prim_comum)):
        seq = sorted(bloco.items())
        for i, (q, ancs_q) in enumerate(seq):
            minha = ancs_q[0]
            prox = seq[i + 1][1][0] if i + 1 < len(seq) else fim_externo
            out[(q, lingua)] = paginas_da_questao(minha, prox)
    return out


def render_paginas(doc, paginas, ano, dia, deploy):
    rel_dir = f"questoes/{ano}"
    os.makedirs(os.path.join(deploy, rel_dir), exist_ok=True)
    rels = {}
    for p in sorted(paginas):
        rel = f"{rel_dir}/dia_{dia}_pag_{p:02d}.webp"
        destino = os.path.join(deploy, rel)
        rels[p] = rel
        if os.path.exists(destino):
            continue
        pg = doc[p - 1]
        zoom = LARGURA_WEBP / pg.rect.width
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        img.save(destino, "WEBP", quality=QUALIDADE_WEBP)
    return rels


def processar_dia(pdf_path, provas_do_dia, ano, dia_num, deploy, itens_out):
    doc, ancs = ancoras_do_pdf(pdf_path)
    mapa = mapear(ancs, doc)
    usadas = set()
    n_map = n_sem = 0
    for prova in provas_do_dia:
        for r in prova["rows"]:
            pos = int(r["CO_POSICAO"])
            lingua = None
            if r["TP_LINGUA"] not in ("", None):
                lingua = int(float(r["TP_LINGUA"]))
            pags = mapa.get((pos, lingua))
            if not pags:
                n_sem += 1
                continue
            usadas.update(pags)
            ent = {"dia": f"DIA_{dia_num}", "area": r["SG_AREA"], "pags": pags,
                   "imgs": [], "co_posicao": pos}
            if lingua is not None:
                ent["tp_lingua"] = lingua
            itens_out[str(int(r["CO_ITEM"]))] = ent
            n_map += 1
    rels = render_paginas(doc, usadas, ano, dia_num, deploy)
    for ent in itens_out.values():
        if ent["dia"] == f"DIA_{dia_num}" and not ent["imgs"]:
            ent["imgs"] = [rels[p] for p in ent["pags"]]
    print(f"  dia {dia_num}: {n_map} itens mapeados · {n_sem} sem âncora · "
          f"{len(usadas)} páginas renderizadas")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--pdf-d1")
    ap.add_argument("--pdf-d2")
    ap.add_argument("--deploy", default="pr2_deploy")
    args = ap.parse_args()
    if not args.pdf_d1 and not args.pdf_d2:
        sys.exit("informe --pdf-d1 e/ou --pdf-d2")

    print(f"Localizando cadernos regulares AZUL de {args.ano}…")
    regulares = achar_provas_regulares(args.csv, args.deploy, args.ano)
    for prova, info in sorted(regulares.items()):
        print(f"  CO_PROVA {prova}: {info['area']} ({info['dia']}) · "
              f"cobertura no painel {info['cobertura']}")

    saida = os.path.join(args.deploy, "api", "questoes", f"{args.ano}.json")
    itens = {}
    if os.path.exists(saida):   # incremental: dia 2 pode vir depois
        itens = json.load(open(saida, encoding="utf-8")).get("itens", {})
        print(f"  (mesclando com {len(itens)} itens já existentes)")

    if args.pdf_d1:
        d1 = [v for v in regulares.values() if v["dia"] == "DIA_1"]
        processar_dia(args.pdf_d1, d1, args.ano, 1, args.deploy, itens)
    if args.pdf_d2:
        d2 = [v for v in regulares.values() if v["dia"] == "DIA_2"]
        processar_dia(args.pdf_d2, d2, args.ano, 2, args.deploy, itens)

    os.makedirs(os.path.dirname(saida), exist_ok=True)
    json.dump({"ano": args.ano, "itens": itens},
              open(saida, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"✓ {saida} — {len(itens)} itens")


if __name__ == "__main__":
    main()
