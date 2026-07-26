#!/usr/bin/env python3
"""Emite histórico item-a-item por escola (nível ESC) para todas as escolas
do PR. Cobre 2024 e 2025 (anos em que o INEP passou a expor CO_ESCOLA).

O pipeline nacional (`pipeline/exporta_netlify.py`) NÃO emite historico/ESC/
porque geraria ~2 milhões de arquivos. Aqui filtramos só as ~2.085 escolas
do PR e emitimos em `pr2_deploy/api/historico/ESC/{inep}.json`.

Fonte: data/enem_hist.sqlite (hist_item + itens_meta_all)
Escolas do PR: data/enem2025.sqlite (tabela escolas)

Formato de saída, compatível com pr2/criticas.js:
  { T: { por_ano: { "2024": {CN: [[item, n, p, p_esp, hab, b, lingua], ...],
                              CH:[], LC:[], MT:[]},
                    "2025": {...} } },
    PUB: {...idem...},   # duplicado; escola pertence a uma rede só
    PRIV: {...idem...} }

Uso: python3 pipeline/build_historico_esc_pr.py
"""
import json
import os
import sqlite3
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_HIST = os.path.join(BASE, "data", "enem_hist.sqlite")
DB_2025 = os.path.join(BASE, "data", "enem2025.sqlite")
OUT_DIR = os.path.join(BASE, "pr2_deploy", "api", "historico", "ESC")

ANOS = ("2024", "2025")


def main():
    # 1) INEPs das escolas do PR
    con25 = sqlite3.connect(DB_2025)
    ineps_pr = {str(r[0]) for r in con25.execute(
        "SELECT chave FROM escolas WHERE uf='PR'")}
    con25.close()
    print(f"escolas PR: {len(ineps_pr):,}", flush=True)

    # 2) itens_meta_all — indexa por CO_ITEM
    con_h = sqlite3.connect(DB_HIST)
    con_h.row_factory = sqlite3.Row
    meta = {}
    for r in con_h.execute("SELECT CO_ITEM, area, habilidade_inep, param_b, tp_lingua FROM itens_meta_all"):
        meta[r["CO_ITEM"]] = (r["area"], r["habilidade_inep"], r["param_b"], r["tp_lingua"])

    # 3) hist_item filtrado por escolas PR — puxa em blocos
    # estrutura: {inep: {ano: {area: [7-tuple, ...]}}}
    dados = defaultdict(lambda: {a: {ar: [] for ar in ("LC","CH","CN","MT")} for a in ANOS})

    q = con_h.execute("""
        SELECT ano, chave, CO_ITEM, n, p_acerto, p_esp
          FROM hist_item
         WHERE nivel='ESC' AND ano IN (2024, 2025)
    """)
    n_lidos = 0
    for ano, chave, co_item, n, p_acerto, p_esp in q:
        n_lidos += 1
        chave = str(chave)
        if chave not in ineps_pr:
            continue
        m = meta.get(co_item)
        if not m:
            continue
        area, hab, b, ling = m
        if area not in ("LC","CH","CN","MT"):
            continue
        # 7-tupla no formato esperado: [item, n, p, p_esp, hab, b, lingua]
        tup = [co_item, n,
               round(p_acerto, 3) if p_acerto is not None else None,
               round(p_esp, 3) if p_esp is not None else None,
               hab,
               round(b, 3) if b is not None else None,
               ling]
        dados[chave][str(ano)][area].append(tup)
    con_h.close()
    print(f"linhas hist_item lidas: {n_lidos:,}", flush=True)
    print(f"escolas com dados: {len(dados):,}", flush=True)

    # 4) escreve um JSON por escola em pr2_deploy/api/historico/ESC/
    os.makedirs(OUT_DIR, exist_ok=True)
    # limpa arquivos antigos
    for f in os.listdir(OUT_DIR):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT_DIR, f))

    n_arq = 0
    for inep, por_ano in dados.items():
        # escola tem uma rede só; duplicamos por rede pra compatibilidade
        # com criticas.js (que lê hist[rede].por_ano)
        payload = {"T":    {"por_ano": por_ano},
                   "PUB":  {"por_ano": por_ano},
                   "PRIV": {"por_ano": por_ano}}
        with open(os.path.join(OUT_DIR, f"{inep}.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        n_arq += 1

    tot_kb = sum(os.path.getsize(os.path.join(OUT_DIR, f))
                 for f in os.listdir(OUT_DIR)) / 1024
    print(f"✓ {n_arq:,} arquivos em {OUT_DIR} ({tot_kb:,.0f} KB total)", flush=True)


if __name__ == "__main__":
    main()
