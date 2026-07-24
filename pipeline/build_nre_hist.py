#!/usr/bin/env python3
"""Agrega histórico 2021–2025 por NRE (a partir de data/enem_hist.sqlite).

Consome:
  - data/enem_hist.sqlite  (hist_resumo por MUN, uf='PR')
  - pr/data/nre_to_muns.json  (mapa NRE → [co_municipio])

Emite (para consumo do pr2 nível NRE):
  - pr2/data/nre_hist_resumo.json:
      { por_rede: { T|PUB|PRIV: { nre: [{ano, n_participantes, media_geral,
                                          media_lc/ch/cn/mt, media_red}, ...] } } }
    (5 anos, uma linha por ano por NRE. Média ponderada por n_participantes.)

Uso: python3 pipeline/build_nre_hist.py
"""
import json
import os
import sqlite3
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_HIST = os.path.join(BASE, "data", "enem_hist.sqlite")
NRE_TO_MUNS = os.path.join(BASE, "pr", "data", "nre_to_muns.json")
OUT = os.path.join(BASE, "pr2", "data", "nre_hist_resumo.json")

MEDIA_FIELDS = ("media_geral", "media_lc", "media_ch", "media_cn", "media_mt",
                "media_red", "media_comp1", "media_comp2", "media_comp3",
                "media_comp4", "media_comp5")
REDES = ("T", "PUB", "PRIV")
ANOS = (2021, 2022, 2023, 2024, 2025)


def main():
    with open(NRE_TO_MUNS, encoding="utf-8") as f:
        nre_to_muns = json.load(f)
    mun_to_nre = {}
    for nre, cds in nre_to_muns.items():
        for cd in cds:
            mun_to_nre[str(cd)] = nre

    con = sqlite3.connect(DB_HIST)
    con.row_factory = sqlite3.Row

    # (rede, nre, ano) → accumulator
    acc = defaultdict(lambda: {"n": 0, **{f: 0.0 for f in MEDIA_FIELDS}})
    n_faltando_nre = 0
    n_hist_rows = 0

    for rede in REDES:
        for row in con.execute(
            "SELECT ano, chave, n_participantes, "
            + ", ".join(MEDIA_FIELDS)
            + " FROM hist_resumo WHERE nivel='MUN' AND uf='PR' AND rede=?",
            (rede,),
        ):
            n_hist_rows += 1
            cd = str(row["chave"])
            nre = mun_to_nre.get(cd)
            if not nre:
                n_faltando_nre += 1
                continue
            n = row["n_participantes"] or 0
            if n <= 0:
                continue
            key = (rede, nre, row["ano"])
            bucket = acc[key]
            bucket["n"] += n
            for f in MEDIA_FIELDS:
                v = row[f]
                if v is not None:
                    bucket[f] += float(v) * n

    con.close()

    out = {"por_rede": {r: {} for r in REDES}}
    for (rede, nre, ano), bucket in acc.items():
        n = bucket["n"]
        if n <= 0:
            continue
        linha = {"ano": ano, "n_participantes": n}
        for f in MEDIA_FIELDS:
            linha[f] = round(bucket[f] / n, 1) if bucket[f] else None
        out["por_rede"][rede].setdefault(nre, []).append(linha)
    # ordena por ano
    for rede in REDES:
        for nre in out["por_rede"][rede]:
            out["por_rede"][rede][nre].sort(key=lambda x: x["ano"])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    # relatório
    n_nres_pub = len(out["por_rede"]["PUB"])
    tot_bytes = os.path.getsize(OUT)
    print(f"linhas hist_resumo processadas: {n_hist_rows:,}")
    print(f"linhas sem NRE mapeado: {n_faltando_nre:,}")
    print(f"NREs cobertos (PUB): {n_nres_pub}")
    print(f"arquivo: {OUT} ({tot_bytes/1024:.1f} KB)")


if __name__ == "__main__":
    main()
