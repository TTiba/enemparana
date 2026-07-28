#!/usr/bin/env python3
"""Gera api/questoes/{ano}.json + imagens a partir do caderno oficial AZUL.

Produz, pra cada item do caderno:
  - a(s) página(s) inteira(s) em WebP (compatível com o formato do 2025), e
  - o RECORTE da questão: só a região dela, com as colunas costuradas
    verticalmente e o texto-base compartilhado ("QUESTÕES N A M") incluído.

Entradas:
  --ano       ex.: 2024
  --csv       ITENS_PROVA_{ano}.csv dos microdados (latin-1, ';')
  --pdf-d1    PDF do caderno impresso do 1º dia (LC+CH, questões 1-90)
  --pdf-d2    PDF do 2º dia (CN+MT, questões 91-180) — opcional
  --deploy    raiz do site (default: pr2_deploy)

Como acha o caderno certo: cruza os CO_ITEM de cada prova AZUL do CSV com os
CO_ITEM que o painel já usa em api/habilidades/ pro ano — a prova regular é a
que tem interseção ~total (o painel foi construído com o caderno majoritário).

Mapeamento: âncoras "QUESTÃO N" e blocos "QUESTÕES N A M" localizados por
posição, em ordem de leitura de 2 colunas. Inglês e espanhol repetem a
numeração 1-5: a 1ª ocorrência de cada uma em ordem de leitura é inglês (não
dá pra procurar o cabeçalho 'ESPANHOL' — a palavra já aparece nas instruções
da capa).

Requisitos: pip install pymupdf pillow

Uso (2024, só dia 1 — CN/MT entram quando houver o PDF do dia 2):
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
from PIL import Image, ImageOps

LARGURA_WEBP = 1150          # mesma largura dos WebP de página do 2025
QUALIDADE_WEBP = 80
ZOOM_RECORTE = 3.0           # coluna ~254pt → ~760px de largura
TOPO_COLUNA_PT = 120         # âncora acima disso na 1ª coluna = topo de página
CONTEUDO_TOPO = 85           # faixa útil da página (fora cabeçalho/rodapé)
CONTEUDO_BASE = 745


def sem_acento(s):
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()


# --------------------------------------------------------------- CSV / painel
def achar_provas_regulares(csv_path, deploy, ano):
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


# ------------------------------------------------------------------- âncoras
class Anc:
    """Âncora posicional: início de questão ('ind') ou de bloco compartilhado
    ('blk', questões qa..qb)."""
    __slots__ = ("qa", "qb", "pag", "col", "y", "topo", "tipo")

    def __init__(self, qa, qb, pag, col, y, topo, tipo):
        self.qa, self.qb, self.pag, self.col = qa, qb, pag, col
        self.y, self.topo, self.tipo = y, topo, tipo

    @property
    def pos(self):
        return (self.pag, self.col, self.y)


def layout_de(doc):
    """{pagina: 1|2} — nº de colunas, detectado pelos blocos de texto que
    cruzam o meio da página (o ENEM mistura: capa e algumas páginas de prova,
    sobretudo no 2º dia, são de coluna única)."""
    out = {}
    for i, pg in enumerate(doc):
        meio = pg.rect.width / 2
        cruzam = sum(1 for x0, y0, x1, y1, txt, *_ in pg.get_text("blocks")
                     if CONTEUDO_TOPO < y0 and y1 < CONTEUDO_BASE
                     and x0 < meio - 30 and x1 > meio + 30 and len(txt.strip()) > 40)
        out[i + 1] = 1 if cruzam >= 2 else 2
    return out


def ancoras_do_pdf(doc, layout):
    ancs = []
    for i, pg in enumerate(doc):
        meio = pg.rect.width / 2
        for x0, y0, x1, y1, txt, *_ in pg.get_text("blocks"):
            t = sem_acento(txt.upper())
            col = 0 if (layout[i + 1] == 1 or x0 < meio) else 1
            topo = col == 0 and y0 < TOPO_COLUNA_PT
            for m in re.finditer(r"QUESTOES\s+(\d{1,3})\s+A\s+(\d{1,3})", t):
                ancs.append(Anc(int(m.group(1)), int(m.group(2)), i + 1, col, y0, topo, "blk"))
            for m in re.finditer(r"QUESTAO\s+(\d{1,3})", t):
                ancs.append(Anc(int(m.group(1)), int(m.group(1)), i + 1, col, y0, topo, "ind"))
    ancs.sort(key=lambda a: a.pos)
    return ancs


def montar_fluxos(ancs):
    """Separa as âncoras em 3 fluxos de leitura: inglês, espanhol e comum.

    LEM: as questões 1-5 aparecem duas vezes; a 1ª ocorrência é inglês.
    Devolve {(q, lingua|None): {'ini': Anc, 'fim': Anc|None, 'blk': Anc|None}}
    onde fim é a âncora que delimita o fim da questão e blk é o início do
    texto-base compartilhado, quando houver.
    """
    en_vistos, fluxo_en, fluxo_es, fluxo_com = set(), [], [], []
    for a in ancs:
        if a.qa <= 5 and a.qb <= 5:
            if a.tipo == "ind":
                destino = fluxo_en if a.qa not in en_vistos else fluxo_es
                if a.qa not in en_vistos:
                    en_vistos.add(a.qa)
            else:   # bloco dentro do LEM: mesma regra pela 1ª questão dele
                destino = fluxo_en if a.qa not in en_vistos else fluxo_es
            destino.append(a)
        else:
            fluxo_com.append(a)

    out = {}
    prim = lambda fl: fl[0] if fl else None
    seq_limites = {0: prim(fluxo_es) or prim(fluxo_com), 1: prim(fluxo_com), None: None}
    for lingua, fluxo in ((0, fluxo_en), (1, fluxo_es), (None, fluxo_com)):
        inds = [a for a in fluxo if a.tipo == "ind"]
        blks = [a for a in fluxo if a.tipo == "blk"]
        for i, a in enumerate(inds):
            fim = inds[i + 1] if i + 1 < len(inds) else seq_limites[lingua]
            blk = next((b for b in blks if b.qa <= a.qa <= b.qb), None)
            out[(a.qa, lingua)] = {"ini": a, "fim": fim, "blk": blk}
    return out


def paginas_de(ent):
    ini, fim = ent["ini"], ent["fim"]
    p0 = (ent["blk"] or ini).pag
    if fim is None:
        return list(range(p0, ini.pag + 1))
    p1 = fim.pag
    if p1 > ini.pag and fim.topo:
        p1 -= 1
    return list(range(p0, max(p0, p1) + 1))


# ------------------------------------------------------------------- imagens
def _trim(img, margem=8):
    """Apara bordas brancas, preservando uma margem."""
    cinza = ImageOps.grayscale(img)
    bbox = cinza.point(lambda v: 0 if v > 246 else 255).getbbox()
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - margem); y0 = max(0, y0 - margem)
    x1 = min(img.width, x1 + margem); y1 = min(img.height, y1 + margem)
    return img.crop((x0, y0, x1, y1))


def _segmentos(doc, layout, ini_pos, fim_pos):
    """Retângulos (pag, col, y0, y1) do trecho ini→fim em ordem de leitura.
    Em página de coluna única não existe col 1: avança direto de página."""
    segs = []
    pag, col, y = ini_pos
    while (pag, col) != (fim_pos[0], fim_pos[1]):
        segs.append((pag, col, y, CONTEUDO_BASE))
        if col == 0 and layout.get(pag, 2) == 2:
            col = 1
        else:
            pag += 1; col = 0
        y = CONTEUDO_TOPO
        if pag > fim_pos[0]:            # salvaguarda contra andar além do fim
            break
    if fim_pos[2] - 4 > y and (pag, col) == (fim_pos[0], fim_pos[1]):
        segs.append((pag, col, y, fim_pos[2] - 4))
    return segs


def _render_segs(doc, layout, segs):
    tiras = []
    for pag, col, y0, y1 in segs:
        pg = doc[pag - 1]
        meio = pg.rect.width / 2
        if layout.get(pag, 2) == 1:
            clip = pymupdf.Rect(26, y0, pg.rect.width - 22, y1)
        else:
            clip = pymupdf.Rect(26 if col == 0 else meio, y0,
                                meio if col == 0 else pg.rect.width - 22, y1)
        if clip.height < 8:
            continue
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(ZOOM_RECORTE, ZOOM_RECORTE), clip=clip)
        img = _trim(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"))
        if img is not None and img.height > 14:
            tiras.append(img)
    if not tiras:
        return None
    larg = max(t.width for t in tiras)
    alt = sum(t.height for t in tiras) + 14 * (len(tiras) - 1)
    folha = Image.new("RGB", (larg, alt), "white")
    y = 0
    for t in tiras:
        folha.paste(t, (0, y))
        y += t.height + 14
    return folha


def recorte_da_questao(doc, layout, ent):
    """Imagem da questão: texto-base compartilhado (se houver) + corpo."""
    ini, fim, blk = ent["ini"], ent["fim"], ent["blk"]
    ult_col = 0 if layout.get(ini.pag, 2) == 1 else 1
    fim_pos = fim.pos if fim is not None else (ini.pag, ult_col, CONTEUDO_BASE)
    partes = []
    if blk is not None and blk.pos < ini.pos:
        partes += _segmentos(doc, layout, blk.pos, ini.pos)
    partes += _segmentos(doc, layout, ini.pos, fim_pos)
    return _render_segs(doc, layout, partes)


def render_pagina(doc, p, destino):
    pg = doc[p - 1]
    zoom = LARGURA_WEBP / pg.rect.width
    pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
    Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB") \
         .save(destino, "WEBP", quality=QUALIDADE_WEBP)


# ------------------------------------------------------------------ pipeline
def processar_dia(pdf_path, provas_do_dia, ano, dia_num, deploy, itens_out):
    doc = pymupdf.open(pdf_path)
    layout = layout_de(doc)
    n1col = [p for p, n in layout.items() if n == 1 and p > 1]
    if n1col:
        print(f"  páginas de coluna única: {n1col}")
    fluxos = montar_fluxos(ancoras_do_pdf(doc, layout))
    rel_dir = f"questoes/{ano}"
    os.makedirs(os.path.join(deploy, rel_dir), exist_ok=True)

    usadas, n_map, n_sem, n_rec = set(), 0, 0, 0
    for prova in provas_do_dia:
        for r in prova["rows"]:
            pos = int(r["CO_POSICAO"])
            lingua = int(float(r["TP_LINGUA"])) if r["TP_LINGUA"] not in ("", None) else None
            ent = fluxos.get((pos, lingua))
            if not ent:
                n_sem += 1
                continue
            pags = paginas_de(ent)
            usadas.update(pags)
            registro = {"dia": f"DIA_{dia_num}", "area": r["SG_AREA"], "pags": pags,
                        "imgs": [f"{rel_dir}/dia_{dia_num}_pag_{p:02d}.webp" for p in pags],
                        "co_posicao": pos}
            if lingua is not None:
                registro["tp_lingua"] = lingua
            sufixo = {0: "_en", 1: "_es", None: ""}[lingua]
            rec = recorte_da_questao(doc, layout, ent)
            if rec is not None:
                rel_rec = f"{rel_dir}/rec_d{dia_num}_q{pos:03d}{sufixo}.webp"
                rec.save(os.path.join(deploy, rel_rec), "WEBP", quality=QUALIDADE_WEBP)
                registro["recorte"] = rel_rec
                n_rec += 1
            itens_out[str(int(r["CO_ITEM"]))] = registro
            n_map += 1

    for p in sorted(usadas):
        destino = os.path.join(deploy, rel_dir, f"dia_{dia_num}_pag_{p:02d}.webp")
        if not os.path.exists(destino):
            render_pagina(doc, p, destino)
    print(f"  dia {dia_num}: {n_map} itens mapeados · {n_sem} sem âncora · "
          f"{n_rec} recortes · {len(usadas)} páginas")


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
        processar_dia(args.pdf_d1,
                      [v for v in regulares.values() if v["dia"] == "DIA_1"],
                      args.ano, 1, args.deploy, itens)
    if args.pdf_d2:
        processar_dia(args.pdf_d2,
                      [v for v in regulares.values() if v["dia"] == "DIA_2"],
                      args.ano, 2, args.deploy, itens)

    os.makedirs(os.path.dirname(saida), exist_ok=True)
    json.dump({"ano": args.ano, "itens": itens},
              open(saida, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"✓ {saida} — {len(itens)} itens")


if __name__ == "__main__":
    main()
