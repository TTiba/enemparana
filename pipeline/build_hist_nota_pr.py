#!/usr/bin/env python3
"""Gera histograma de nota (buckets de 25 pontos) por NRE e por município do PR.

O banco enem2025.sqlite só tem agg_hist_nota para BR e UF; a v2 PR precisa
das distribuições no nível NRE e MUN pra reproduzir o painel do mapa.
Este script varre o CSV bruto RESULTADOS_2025.csv com DuckDB filtrando
SG_UF_ESC='PR' e agrupa por (nivel, chave, rede, campo, bucket).

Fonte: ../microdados_enem_2025/DADOS/RESULTADOS_2025.csv (INEP, ~2 GB)
Chave NRE: pr/data/nre_to_muns.json (cross-ref cd_municipio → NRE)
Saída:  pr2/data/hist_nota_pr.json  (~1–3 MB estimado)

Estrutura:
  { por_rede: { T|PUB|PRIV: {
      "UF/PR":                { geral: {"50":..., ...}, lc:..., ... },
      "NRE/UMUARAMA":         { ... },
      "MUN/4128005":          { ... },
      ...
    }}}
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(os.path.dirname(BASE), "microdados_enem_2025", "DADOS",
                   "RESULTADOS_2025.csv")
NRE_TO_MUNS = os.path.join(BASE, "pr", "data", "nre_to_muns.json")
OUT = os.path.join(BASE, "pr2", "data", "hist_nota_pr.json")

BUCKET = 25   # granularidade do histograma (pontos)
# aliases (na tabela `p` já renomeados) → nome curto exposto no JSON
CAMPOS = ("geral", "lc", "ch", "cn", "mt", "red")
# nome da coluna na tabela `p`: mesmo do alias, com "media_geral" para geral


def main():
    try:
        import duckdb
    except ImportError:
        print("duckdb não instalado no ambiente atual — rode via .venv/bin/python", file=sys.stderr)
        sys.exit(1)

    with open(NRE_TO_MUNS, encoding="utf-8") as f:
        nre_to_muns = json.load(f)
    mun_to_nre = {}
    for nre, cds in nre_to_muns.items():
        for cd in cds:
            mun_to_nre[str(cd)] = nre

    con = duckdb.connect()
    # cria view do CSV
    con.execute(f"""
        CREATE VIEW r AS SELECT * FROM read_csv_auto('{CSV}',
            delim=';', header=true, encoding='latin-1',
            sample_size=-1)
    """)

    # Filtra escolas PR + concluintes com escola. Rede: 1/2/3=PUB, 4=PRIV, T=todos.
    # media_geral = média das 5 notas (LC+CH+CN+MT+RED)/5 — mesmo padrão do
    # build_db.py nacional.
    con.execute("""
        CREATE TABLE p AS
        SELECT CAST(CO_MUNICIPIO_ESC AS VARCHAR) AS mun,
               CASE WHEN TP_DEPENDENCIA_ADM_ESC = 4 THEN 'PRIV'
                    WHEN TP_DEPENDENCIA_ADM_ESC IN (1,2,3) THEN 'PUB'
                    ELSE NULL END AS rede,
               NU_NOTA_LC AS lc, NU_NOTA_CH AS ch,
               NU_NOTA_CN AS cn, NU_NOTA_MT AS mt,
               NU_NOTA_REDACAO AS red,
               (COALESCE(NU_NOTA_LC,0) + COALESCE(NU_NOTA_CH,0)
                + COALESCE(NU_NOTA_CN,0) + COALESCE(NU_NOTA_MT,0)
                + COALESCE(NU_NOTA_REDACAO,0)) / NULLIF(
                    (CASE WHEN NU_NOTA_LC IS NOT NULL THEN 1 ELSE 0 END)
                  + (CASE WHEN NU_NOTA_CH IS NOT NULL THEN 1 ELSE 0 END)
                  + (CASE WHEN NU_NOTA_CN IS NOT NULL THEN 1 ELSE 0 END)
                  + (CASE WHEN NU_NOTA_MT IS NOT NULL THEN 1 ELSE 0 END)
                  + (CASE WHEN NU_NOTA_REDACAO IS NOT NULL THEN 1 ELSE 0 END)
                , 0) AS media_geral
        FROM r
        WHERE SG_UF_ESC = 'PR' AND CO_ESCOLA IS NOT NULL
    """)
    n_total = con.execute("SELECT COUNT(*) FROM p").fetchone()[0]
    print(f"registros PR: {n_total:,}", flush=True)

    def bucket_expr(col):
        return f"CAST(FLOOR({col} / {BUCKET}) * {BUCKET} AS INTEGER)"

    def hist_por_chave(campo_sql, alias):
        """
        Retorna dict { rede: { chave: { bucket: n } } }
        para nivel MUN. Depois agregamos NRE/UF em Python.
        Rede 'T' incluída (todas as redes).
        """
        rows_pub_priv = con.execute(f"""
            SELECT rede, mun, {bucket_expr(campo_sql)} AS b, COUNT(*) AS n
              FROM p WHERE rede IS NOT NULL AND {campo_sql} IS NOT NULL
                 AND {campo_sql} > 0
             GROUP BY rede, mun, b
        """).fetchall()
        rows_t = con.execute(f"""
            SELECT 'T' AS rede, mun, {bucket_expr(campo_sql)} AS b, COUNT(*) AS n
              FROM p WHERE {campo_sql} IS NOT NULL AND {campo_sql} > 0
             GROUP BY mun, b
        """).fetchall()
        by_rede = {"T": {}, "PUB": {}, "PRIV": {}}
        for rede, mun, b, n in rows_pub_priv + rows_t:
            d = by_rede.setdefault(rede, {}).setdefault(mun, {})
            d[b] = d.get(b, 0) + n
        return by_rede

    resultado = {"por_rede": {"T": {}, "PUB": {}, "PRIV": {}}}

    for alias in CAMPOS:
        col = "media_geral" if alias == "geral" else alias
        print(f"histograma: {alias}", flush=True)
        por_mun_rede = hist_por_chave(col, alias)

        for rede in ("T", "PUB", "PRIV"):
            por_mun = por_mun_rede.get(rede, {})
            # UF/PR — soma todos os munis PR
            uf = {}
            for mun, buckets in por_mun.items():
                for b, n in buckets.items():
                    uf[b] = uf.get(b, 0) + n
            resultado["por_rede"][rede].setdefault("UF/PR", {})[alias] = \
                {str(b): n for b, n in sorted(uf.items())}

            # NRE — agrega munis do NRE
            nre_bucks = {}
            for mun, buckets in por_mun.items():
                nre = mun_to_nre.get(mun)
                if not nre:
                    continue
                d = nre_bucks.setdefault(nre, {})
                for b, n in buckets.items():
                    d[b] = d.get(b, 0) + n
            for nre, buckets in nre_bucks.items():
                resultado["por_rede"][rede].setdefault(f"NRE/{nre}", {})[alias] = \
                    {str(b): n for b, n in sorted(buckets.items())}

            # MUN — direto
            for mun, buckets in por_mun.items():
                resultado["por_rede"][rede].setdefault(f"MUN/{mun}", {})[alias] = \
                    {str(b): n for b, n in sorted(buckets.items())}

    con.close()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, separators=(",", ":"))
    tamanho = os.path.getsize(OUT)
    print(f"✓ {OUT} ({tamanho/1024:.1f} KB)", flush=True)


if __name__ == "__main__":
    main()
