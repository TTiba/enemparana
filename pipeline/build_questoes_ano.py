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
                                "cobertura": f"{inter}/{len(cos)}", "inter": inter}

    # 2021/2022 têm DOIS conjuntos azuis que passam no filtro (impresso e
    # digital/reaplicação). Fica um por (dia, área): o de maior cobertura.
    # Se as ordenações divergirem, aborta — aí só um deles casa com o PDF.
    por_chave = {}
    for prova, info in regulares.items():
        por_chave.setdefault((info["dia"], info["area"]), []).append((prova, info))
    finais = {}
    for chave, cands in por_chave.items():
        cands.sort(key=lambda x: (-x[1]["inter"], int(x[0])))
        eleito = cands[0]
        mapa_e = {(r["CO_POSICAO"], r["TP_LINGUA"]): r["CO_ITEM"]
                  for r in eleito[1]["rows"]}
        for prova, info in cands[1:]:
            mapa_o = {(r["CO_POSICAO"], r["TP_LINGUA"]): r["CO_ITEM"]
                      for r in info["rows"]}
            dif = sum(1 for k, v in mapa_e.items() if k in mapa_o and mapa_o[k] != v)
            if dif:
                sys.exit(f"provas {eleito[0]} e {prova} ({chave}) têm ordenações "
                         f"diferentes ({dif} posições) — preciso saber qual casa "
                         f"com o PDF; rode de novo indicando a prova")
            print(f"  (ignorando CO_PROVA {prova}, duplicata de {eleito[0]} em {chave[1]})")
        finais[eleito[0]] = eleito[1]
    return finais


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


def linhas_de(pg):
    """(x0, y0, x1, y1, texto) por LINHA — âncoras por bloco falham quando o
    extrator funde 'Questão N' no meio de um bloco de conteúdo (2021 D2:
    a Q159 ficava com 7pt de altura porque a âncora da Q160 era o topo de um
    bloco que começava no conteúdo da 159)."""
    for blk in pg.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            txt = "".join(sp["text"] for sp in ln.get("spans", []))
            if txt.strip():
                x0, y0, x1, y1 = ln["bbox"]
                yield x0, y0, x1, y1, txt


def geometria_de(doc):
    """Faixa útil da página, medida no próprio PDF — as margens variam de ano
    pra ano (2024: conteúdo a partir de x=32/y≈85; 2025: x=22,7/y≈76), e
    constantes fixas fatiavam a 1ª linha da coluna e a borda esquerda.

    topo  = menor y das âncoras 'QUESTÃO N' (conteúdo nunca começa acima)
    base  = topo do rodapé ('… DIA … CADERNO …' no pé da página)
    x_lo/x_hi = extremos dos blocos de texto do miolo.
    """
    ancs_y, foot_y, xs0, xs1 = [], [], [], []
    for pg in doc:
        h = pg.rect.height
        for x0, y0, x1, y1, txt in linhas_de(pg):
            t = sem_acento(txt.upper())
            if "DIA" in t and "CADERNO" in t and y0 > h * 0.85:
                foot_y.append(y0)
                continue
            if len(txt.strip()) < 3:
                continue
            if re.search(r"QUESTAO\s+\d", t):
                ancs_y.append(y0)
                xs0.append(x0)
            xs0.append(x0)
            xs1.append(x1)
    return {
        "topo": (min(ancs_y) - 3) if ancs_y else 80,
        "base": (min(foot_y) - 4) if foot_y else 745,
        "x_lo": max(0.0, (sorted(xs0)[len(xs0) // 100] if xs0 else 26) - 4),
        "x_hi": (sorted(xs1)[-1 - len(xs1) // 100] if xs1 else 545) + 4,
    }


def layout_de(doc, geo):
    """{pagina: 1|2} — nº de colunas, detectado pelos blocos de texto que
    cruzam o meio da página (o ENEM mistura: capa e algumas páginas de prova,
    sobretudo no 2º dia, são de coluna única)."""
    out = {}
    for i, pg in enumerate(doc):
        meio = pg.rect.width / 2
        cruzam = sum(1 for x0, y0, x1, y1, txt in linhas_de(pg)
                     if geo["topo"] < y0 and y1 < geo["base"]
                     and x0 < meio - 30 and x1 > meio + 30 and len(txt.strip()) > 40)
        out[i + 1] = 1 if cruzam >= 2 else 2
    return out


def ancoras_do_pdf(doc, layout, geo):
    ancs = []
    for i, pg in enumerate(doc):
        meio = pg.rect.width / 2
        for x0, y0, x1, y1, txt in linhas_de(pg):
            t = sem_acento(txt.upper())
            col = 0 if (layout[i + 1] == 1 or x0 < meio) else 1
            topo = col == 0 and y0 < geo["topo"] + 45
            for m in re.finditer(r"QUESTOES\s+(\d{1,3})\s+A\s+(\d{1,3})", t):
                ancs.append(Anc(int(m.group(1)), int(m.group(2)), i + 1, col, y0, topo, "blk"))
            for m in re.finditer(r"QUESTAO\s+(\d{1,3})", t):
                ancs.append(Anc(int(m.group(1)), int(m.group(1)), i + 1, col, y0, topo, "ind"))
            # seções que encerram o fluxo de questões sem serem questões —
            # sem isso a última questão de LC engolia a Proposta de Redação
            if re.search(r"PROPOSTA DE REDACAO|INSTRUCOES PARA A REDACAO|"
                         r"FOLHA DE RASCUNHO|RASCUNHO DA REDACAO", t):
                ancs.append(Anc(9999, 9999, i + 1, col, y0, topo, "fim"))
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
        for a in inds:
            # o fim é a PRÓXIMA âncora de qualquer tipo em ordem de leitura:
            # a questão seguinte, o texto-base do grupo seguinte (senão a
            # última questão antes de um bloco engoliria o texto dos vizinhos)
            # ou o início da seção de redação/rascunho
            fim = next((b for b in fluxo if b.pos > a.pos
                        and not (b.tipo == "blk" and b.qa <= a.qa <= b.qb)),
                       None) or seq_limites[lingua]
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


def _segmentos(doc, layout, geo, ini_pos, fim_pos):
    """Retângulos (pag, col, y0, y1) do trecho ini→fim em ordem de leitura.
    Em página de coluna única não existe col 1: avança direto de página."""
    segs = []
    pag, col, y = ini_pos
    while (pag, col) != (fim_pos[0], fim_pos[1]):
        segs.append((pag, col, y, geo["base"]))
        if col == 0 and layout.get(pag, 2) == 2:
            col = 1
        else:
            pag += 1; col = 0
        y = geo["topo"]
        if pag > fim_pos[0]:            # salvaguarda contra andar além do fim
            break
    if fim_pos[2] - 4 > y and (pag, col) == (fim_pos[0], fim_pos[1]):
        segs.append((pag, col, y, fim_pos[2] - 4))
    return segs


def _render_segs(doc, layout, geo, segs):
    tiras = []
    for pag, col, y0, y1 in segs:
        pg = doc[pag - 1]
        meio = pg.rect.width / 2
        # ±3pt do meio: fora da divisória central de microtexto ("ENEM2024…")
        if layout.get(pag, 2) == 1:
            clip = pymupdf.Rect(geo["x_lo"], y0, geo["x_hi"], y1)
        else:
            clip = pymupdf.Rect(geo["x_lo"] if col == 0 else meio + 3, y0,
                                meio - 2 if col == 0 else geo["x_hi"], y1)
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


def recorte_da_questao(doc, layout, geo, ent):
    """Imagem da questão: texto-base compartilhado (se houver) + corpo."""
    ini, fim, blk = ent["ini"], ent["fim"], ent["blk"]
    ult_col = 0 if layout.get(ini.pag, 2) == 1 else 1
    fim_pos = fim.pos if fim is not None else (ini.pag, ult_col, geo["base"])
    partes = []
    if blk is not None and blk.pos < ini.pos:
        partes += _segmentos(doc, layout, geo, blk.pos, ini.pos)
    partes += _segmentos(doc, layout, geo, ini.pos, fim_pos)
    return _render_segs(doc, layout, geo, partes)


def render_pagina(doc, p, destino):
    pg = doc[p - 1]
    zoom = LARGURA_WEBP / pg.rect.width
    pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
    Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB") \
         .save(destino, "WEBP", quality=QUALIDADE_WEBP)


# ------------------------------------------------------------------ pipeline
def processar_dia(pdf_path, provas_do_dia, ano, dia_num, deploy, itens_out):
    doc = pymupdf.open(pdf_path)
    geo = geometria_de(doc)
    print(f"  geometria: y {geo['topo']:.0f}-{geo['base']:.0f} · "
          f"x {geo['x_lo']:.0f}-{geo['x_hi']:.0f}")
    layout = layout_de(doc, geo)
    n1col = [p for p, n in layout.items() if n == 1 and p > 1]
    if n1col:
        print(f"  páginas de coluna única: {n1col}")
    fluxos = montar_fluxos(ancoras_do_pdf(doc, layout, geo))
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
            rec = recorte_da_questao(doc, layout, geo, ent)
            if rec is not None:
                rel_rec = f"{rel_dir}/rec_d{dia_num}_q{pos:03d}{sufixo}.webp"
                rec.save(os.path.join(deploy, rel_rec), "WEBP", quality=QUALIDADE_WEBP)
                registro["recorte"] = rel_rec
                n_rec += 1
            itens_out[str(int(r["CO_ITEM"]))] = registro
            n_map += 1

    for p in sorted(usadas):
        # sempre re-renderiza: garante que página e recorte venham da MESMA
        # edição do PDF (misturar com imagens antigas de outra fonte descarta
        # a garantia de paginação idêntica)
        render_pagina(doc, p, os.path.join(deploy, rel_dir, f"dia_{dia_num}_pag_{p:02d}.webp"))
    print(f"  dia {dia_num}: {n_map} itens mapeados · {n_sem} sem âncora · "
          f"{n_rec} recortes · {len(usadas)} páginas")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--csv", help="ITENS_PROVA_{ano}.csv; se omitido, usa as "
                    "posições já existentes em api/questoes/{ano}.json")
    ap.add_argument("--pdf-d1")
    ap.add_argument("--pdf-d2")
    ap.add_argument("--deploy", default="pr2_deploy")
    args = ap.parse_args()
    if not args.pdf_d1 and not args.pdf_d2:
        sys.exit("informe --pdf-d1 e/ou --pdf-d2")

    if args.csv:
        print(f"Localizando cadernos regulares AZUL de {args.ano}…")
        regulares = achar_provas_regulares(args.csv, args.deploy, args.ano)
        for prova, info in sorted(regulares.items()):
            print(f"  CO_PROVA {prova}: {info['area']} ({info['dia']}) · "
                  f"cobertura no painel {info['cobertura']}")
    else:
        base = os.path.join(args.deploy, "api", "questoes", f"{args.ano}.json")
        if not os.path.exists(base):
            sys.exit(f"sem --csv preciso de {base} com as posições já mapeadas")
        print(f"Posições vindas de {base} (sem CSV)…")
        antigos = json.load(open(base, encoding="utf-8"))["itens"]
        regulares = {}
        for co, v in antigos.items():
            chave = (v["dia"], v["area"])
            reg = regulares.setdefault(chave, {"area": v["area"], "dia": v["dia"], "rows": []})
            reg["rows"].append({"CO_POSICAO": v["co_posicao"], "SG_AREA": v["area"],
                                "CO_ITEM": co,
                                "TP_LINGUA": "" if v.get("tp_lingua") is None
                                             else str(v["tp_lingua"])})
        regulares = {f"{d}/{a}": r for (d, a), r in regulares.items()}

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
