#!/usr/bin/env python3
"""Painel ENEM · variante Paraná (pr2) — porta 8093 por padrão.

Serve `pr2/` com API dinâmica filtrada para PR (mesmo padrão do server_pr.py)
+ fallback estático para `deploy/api/` (mesmo padrão do server.py). Isso
permite que criticas.html, ranking_escolas.html e sparklines históricas
funcionem localmente sem gerar `pr2_deploy/`.

Também serve arquivos de `pr/data/` (assets NRE) sob `/data/` — na Fase B
migra pra `pr2/data/`.

Uso: python3 server_pr2.py [porta]
"""
import json
import os
import sqlite3
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "data", "enem2025.sqlite")
WEB = os.path.join(BASE, "pr2")
DEPLOY_API = os.path.join(BASE, "deploy", "api")
PR_DATA = os.path.join(BASE, "pr", "data")

DEPENDENCIA = {1: "Federal", 2: "Estadual", 3: "Municipal", 4: "Privada"}


def q(sql, params=()):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(sql, params).fetchall()]
    con.close()
    return rows


def resumo_row(nivel, chave, rede="T"):
    if nivel == "ESC":
        rede = "T"
    r = q("SELECT * FROM agg_resumo WHERE nivel=? AND chave=? AND rede=?",
          (nivel, chave, rede))
    return r[0] if r else None


def rede_de(qs):
    r = qs.get("rede", ["PUB"])[0].upper()
    return r if r in ("T", "PUB", "PRIV") else "PUB"


def api(path, qs):
    """API filtrada para PR (mesma estrutura do server_pr.py)."""
    rede = rede_de(qs)

    if path == "/api/ufs":
        return q("""SELECT chave, nome, n_participantes,
                           n_lc, n_ch, n_cn, n_mt, n_red,
                           media_geral, media_red, media_lc, media_ch,
                           media_cn, media_mt
                    FROM agg_resumo
                    WHERE nivel='UF' AND chave='PR' AND rede=?""", (rede,))

    if path == "/api/municipios":
        return q("""SELECT chave, nome, n_participantes,
                           n_lc, n_ch, n_cn, n_mt, n_red,
                           media_geral, media_red, media_lc, media_ch,
                           media_cn, media_mt
                    FROM agg_resumo WHERE nivel='MUN' AND uf='PR' AND rede=?
                    ORDER BY nome""", (rede,))

    if path == "/api/escolas":
        mun = qs.get("municipio", [""])[0]
        filtro_rede = {"PUB": "AND COALESCE(e.dependencia, 0) != 4",
                       "PRIV": "AND e.dependencia = 4"}.get(rede, "")
        rows = q(f"""SELECT e.chave, e.nome, e.dependencia, e.n_participantes,
                           r.media_geral, r.n_lc, r.n_mt
                    FROM escolas e
                    JOIN agg_resumo r ON r.nivel='ESC' AND r.chave=e.chave
                                     AND r.rede='T'
                    WHERE e.co_municipio=? AND e.uf='PR' {filtro_rede}
                    ORDER BY e.n_participantes DESC""", (mun,))
        for r in rows:
            dep = DEPENDENCIA.get(r["dependencia"], "")
            r["rotulo"] = (r["nome"] or f"Escola INEP {r['chave']}") + \
                          (f" · {dep}" if dep else "")
        return rows

    if path == "/api/resumo":
        nivel = qs.get("nivel", ["UF"])[0]
        chave = qs.get("chave", ["PR"])[0]
        alvo = resumo_row(nivel, chave, rede)
        if not alvo:
            return {"erro": "não encontrado"}
        ctx = []
        if nivel == "ESC":
            esc = q("SELECT * FROM escolas WHERE chave=?", (chave,))
            if esc:
                if esc[0]["nome"]:
                    alvo["nome"] = esc[0]["nome"]
                alvo["escola"] = esc[0]
                alvo["escola"]["dependencia_nome"] = DEPENDENCIA.get(
                    esc[0]["dependencia"], "")
                m = resumo_row("MUN", str(esc[0]["co_municipio"]), rede)
                u = resumo_row("UF", "PR", rede)
                ctx = [x for x in (m, u) if x]
        elif nivel == "MUN":
            u = resumo_row("UF", "PR", rede)
            ctx = [x for x in (u,) if x]
        br = resumo_row("BR", "BR", rede)
        if nivel != "BR" and br:
            ctx.append(br)
        return {"alvo": alvo, "contexto": ctx}

    if path == "/api/itens":
        nivel = qs.get("nivel", ["UF"])[0]
        chave = qs.get("chave", ["PR"])[0]
        area = qs.get("area", ["MT"])[0]
        uf = "PR"
        rede_alvo = "T" if nivel == "ESC" else rede
        rows = q("""
            SELECT a.CO_ITEM AS item, a.n, CAST(a.acertos AS INTEGER) AS acertos,
                   round(1.0*a.acertos/a.n, 3) AS p,
                   round(1.0*a.esperado/a.n, 3) AS p_esp,
                   m.habilidade_inep, m.habilidade_custom,
                   m.param_b, m.gabarito, m.tp_lingua,
                   round(1.0*u.acertos/u.n, 3) AS p_uf,
                   round(1.0*b.acertos/b.n, 3) AS p_br
            FROM agg_item a
            JOIN itens_meta m ON m.CO_ITEM = a.CO_ITEM AND m.area = ?
            LEFT JOIN agg_item u ON u.nivel='UF' AND u.chave=? AND u.rede=?
                                AND u.CO_ITEM=a.CO_ITEM
            LEFT JOIN agg_item b ON b.nivel='BR' AND b.chave='BR' AND b.rede=?
                                AND b.CO_ITEM=a.CO_ITEM
            WHERE a.nivel=? AND a.chave=? AND a.rede=?
            ORDER BY p ASC""",
            (area, uf, rede, rede, nivel, chave, rede_alvo))
        if rows:
            n_max = max(r["n"] for r in rows)
            rows = [r for r in rows if r["n"] >= 0.25 * n_max]
        return rows

    return {"erro": "rota desconhecida"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        super().end_headers()

    def _serve_deploy_static(self, path):
        rel = path.lstrip("/").split("api/", 1)[1] if "/api/" in path else ""
        if not rel:
            return False
        abs_path = os.path.normpath(os.path.join(DEPLOY_API, rel))
        if not abs_path.startswith(DEPLOY_API) or not os.path.isfile(abs_path):
            return False
        with open(abs_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def _serve_pr_data(self, path):
        """Serve /data/* de pr/data (assets NRE) — usado até pr2/data existir."""
        rel = path.lstrip("/").split("data/", 1)[1] if "/data/" in path else ""
        if not rel:
            return False
        abs_path = os.path.normpath(os.path.join(PR_DATA, rel))
        if not abs_path.startswith(PR_DATA) or not os.path.isfile(abs_path):
            return False
        with open(abs_path, "rb") as f:
            body = f.read()
        ext = os.path.splitext(abs_path)[1].lower()
        ctype = {"json": "application/json", "geojson": "application/geo+json",
                 "csv": "text/csv"}.get(ext.lstrip("."), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/robots.txt":
            body = b"User-agent: *\nDisallow: /\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # /data/* → pr/data/* enquanto pr2/data não existir
        if u.path.startswith("/data/"):
            pr2_data = os.path.normpath(
                os.path.join(WEB, "data", u.path.lstrip("/").split("data/", 1)[1]))
            if pr2_data.startswith(os.path.join(WEB, "data")) and os.path.isfile(pr2_data):
                super().do_GET()
                return
            if self._serve_pr_data(u.path):
                return

        if u.path.startswith("/api/"):
            try:
                resp = api(u.path, parse_qs(u.query))
                if isinstance(resp, dict) and resp.get("erro") == "rota desconhecida":
                    if self._serve_deploy_static(u.path):
                        return
                body = json.dumps(resp, ensure_ascii=False).encode()
                self.send_response(200)
            except Exception as e:
                body = json.dumps({"erro": str(e)}).encode()
                self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


if __name__ == "__main__":
    porta = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", 8093))
    print(f"Painel ENEM · PR v2 em http://localhost:{porta}", flush=True)
    HTTPServer(("127.0.0.1", porta), Handler).serve_forever()
