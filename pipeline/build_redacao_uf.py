#!/usr/bin/env python3
"""Gera api/redacao/index.json só no nível UF, a partir do que já está publicado.

Fallback do pipeline/build_redacao.py do repo painelenem, que precisa dos
microdados e cobre também município e escola. Aqui dá pra fazer só o estado,
porque o hist_nota.red existe apenas no JSON da UF (0 de 398 municípios,
0 de 2.052 escolas).

O hist_nota é a interseção das seis áreas — as seis têm exatamente o mesmo
total — logo já é "quem fez os dois dias". O bucket 0 são os que zeraram.

Estimador: a nota de redação é múltiplo de 20 e os buckets têm 25 pontos, então
o centro erra. Uso a média dos múltiplos de 20 dentro de cada bucket.

Uso: python3 pipeline/build_redacao_uf.py
"""
import json
import argparse
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Parametrizado em 16/09 pra servir também o Mato Grosso (pipeline/deploy_mt.py).
# Sem argumento continua fazendo exatamente o que fazia: PR sobre pr2_deploy.
_ap = argparse.ArgumentParser()
_ap.add_argument("--uf", default="PR")
_ap.add_argument("--deploy", default=os.path.join(BASE, "pr2_deploy"))
_args = _ap.parse_args()
UF = _args.uf.upper()
ENT = os.path.join(_args.deploy, "api", "entidade", "UF", f"{UF}.json")
OUT_DIR = os.path.join(_args.deploy, "api", "redacao")


def estimador(k, passo=25, grade=20):
    vs = [v for v in range(k, k + passo) if v % grade == 0]
    return sum(vs) / len(vs) if vs else k + passo / 2


doc = json.load(open(ENT, encoding="utf-8"))
CHAVE = f"UF/{UF}"
out = {CHAVE: {}}
for rede in ("T", "PUB", "PRIV"):
    h = (doc.get(rede, {}).get("hist_nota") or {}).get("red")
    if not h:
        continue
    itens = sorted((int(k), v) for k, v in h.items() if v)
    n = sum(v for _, v in itens)
    n0 = dict(itens).get(0, 0)
    soma = sum(estimador(k) * v for k, v in itens)
    soma_sz = sum(estimador(k) * v for k, v in itens if k > 0)
    out[CHAVE][rede] = {
        "n": n, "n0": n0,
        "media": round(soma / n, 1),
        "media_sz": round(soma_sz / (n - n0), 1) if n > n0 else None,
    }
    print(f"  {rede:<5} n={n:>7,} zeraram={n0:>5,} "
          f"media={out[CHAVE][rede]['media']:>6} → "
          f"{out[CHAVE][rede]['media_sz']}")

os.makedirs(OUT_DIR, exist_ok=True)
caminho = os.path.join(OUT_DIR, "index.json")
json.dump(out, open(caminho, "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"\n✓ {caminho} ({os.path.getsize(caminho)} bytes)")
