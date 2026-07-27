#!/usr/bin/env python3
"""Confere se o p_esp de um deploy está calibrado (teste do D da TRI).

Ideia: as notas TRI (θ) foram calculadas pelo INEP a partir das mesmas
respostas e dos mesmos parâmetros de item. Então a probabilidade média
prevista pelo modelo TEM que reproduzir o acerto observado. Se não reproduz,
a fórmula está errada — e o desvio típico do erro D=1,7 é de -2 a -3 pp.

Não precisa dos microdados: compara, dentro do próprio deploy, o p (acerto
observado) contra o p_esp (esperado) que o pipeline gravou.

Uso:
    python3 pipeline/d1_demo/verifica_calibracao.py [dir_do_deploy]

    # antes e depois da correção:
    python3 pipeline/d1_demo/verifica_calibracao.py pr2_deploy
    python3 pipeline/d1_demo/verifica_calibracao.py pr2_deploy_d1

Leitura do resultado:
    |erro| < 1,0 pp  → calibrado (D=1 correto)
    erro < -2,0 pp   → 3PL provavelmente ainda com o fator D=1,7
    (erro = esperado - observado; negativo significa que o modelo subestima)
"""
import glob
import json
import os
import random
import statistics as st
import sys

AREAS = ("CN", "CH", "LC", "MT")


def agregar(bloco):
    """(acerto observado, esperado, n) ponderados por exposição."""
    so = se = sn = 0
    for area in AREAS:
        for arr in bloco.get("itens", {}).get(area, []):
            n, p, p_esp = arr[1], arr[2], arr[3]
            if not n or p is None or p_esp is None:
                continue
            so += p * n
            se += p_esp * n
            sn += n
    return (so / sn * 100, se / sn * 100, sn) if sn else None


def de_arquivo(caminho, rede=None):
    if not os.path.exists(caminho):
        return None
    doc = json.load(open(caminho, encoding="utf-8"))
    bloco = doc.get(rede) if rede else doc
    return agregar(bloco) if isinstance(bloco, dict) else None


def linha(rotulo, r):
    if not r:
        print(f"  {rotulo:<30}{'—':>12}")
        return None
    obs, esp, n = r
    erro = esp - obs                     # erro do modelo: negativo = subestima
    flag = "OK" if abs(erro) < 1.0 else ("SUSPEITO" if erro > -2.0 else "D=1,7?")
    print(f"  {rotulo:<30}{n:>12,}{obs:>10.2f}%{esp:>10.2f}%{erro:>+9.2f} pp   {flag}")
    return erro


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "pr2_deploy"
    api = os.path.join(base, "api")
    if not os.path.isdir(api):
        sys.exit(f"não achei {api}")

    print(f"\nCalibração do p_esp em {base}/")
    print(f"  {'nível':<30}{'exposições':>12}{'observado':>10}{'esperado':>10}"
          f"{'erro do modelo':>16}")
    print("  " + "-" * 82)

    vieses = []
    for rede in ("PUB", "T"):
        v = linha(f"UF/PR · {rede}",
                  de_arquivo(os.path.join(api, "entidade", "UF", "PR.json"), rede))
        if v is not None:
            vieses.append(v)

    muns = sorted(glob.glob(os.path.join(api, "entidade", "MUN", "*.json")))
    if muns:
        ds = [r[1] - r[0] for r in (de_arquivo(m, "PUB") for m in muns)
              if r and r[2] > 2000]
        if ds:
            print(f"  {'municípios · PUB (n>2000)':<30}{len(ds):>12}"
                  f"{'':>10}{'':>10}{st.mean(ds):>+9.2f} pp   "
                  f"mediana {st.median(ds):+.2f} · dp {st.pstdev(ds):.2f}")

    escs = sorted(glob.glob(os.path.join(api, "entidade", "ESC", "*.json")))
    if escs:
        random.seed(7)
        amostra = random.sample(escs, min(300, len(escs)))
        ds = [r[1] - r[0] for r in (de_arquivo(e) for e in amostra)
              if r and r[2] > 500]
        if ds:
            print(f"  {'escolas (amostra de 300)':<30}{len(ds):>12}"
                  f"{'':>10}{'':>10}{st.mean(ds):>+9.2f} pp   "
                  f"mediana {st.median(ds):+.2f} · dp {st.pstdev(ds):.2f}")
            vieses.append(st.mean(ds))

    if not vieses:
        sys.exit("\nsem dados suficientes pra avaliar")
    m = st.mean(vieses)
    print()
    if abs(m) < 1.0:
        print(f"✓ CALIBRADO — erro médio {m:+.2f} pp. O modelo reproduz o observado.")
    elif m < -2.0:
        print(f"✗ DESCALIBRADO — erro médio {m:+.2f} pp, subestimando de forma "
              f"sistemática.\n  Sintoma clássico do fator D=1,7 na 3PL; ver "
              f"PATCH-build_db.md.")
    else:
        print(f"? INTERMEDIÁRIO — erro médio {m:+.2f} pp. Investigar.")


if __name__ == "__main__":
    main()
