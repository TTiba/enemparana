# Tutorial de deploy — Painel ENEM Paraná v2

Site em produção com redundância: **Netlify** (primário) + **Cloudflare Pages**
(secundário). Ambos servem o conteúdo de `pr2_deploy/` do repo
[TTiba/enemparana](https://github.com/TTiba/enemparana) e re-deployam
automaticamente a cada push na branch `main`.

**URLs:**
- Primário: https://enemparana.netlify.app
- Secundário: `<a definir na Cloudflare Pages>` — ver §2

---

## 0. Pré-requisitos

- `pr2_deploy/` atualizado (rodar `python3 pr2/deploy_pr2.py` do repo
  `plataforma/` se você mexeu no source `pr2/`).
- Working tree limpo e o commit atual pushado pra `origin/main`.

Confira antes de deployar:
```bash
cd ~/Documents/enemparana
git status                     # tem que estar limpo
git log --oneline -1           # HEAD deve ser o commit que quer publicar
ls pr2_deploy/data/hist_nota_pr.json   # sanity check: arquivo grande existe
```

---

## 1. Deploy no Netlify (primário — já configurado)

Site: [enemparana](https://app.netlify.com/projects/enemparana) · Team: Nerd ·
Project ID: `879df1d6-7cb4-4b2b-8c72-7dd503b8b02e`

**Config do site:**
- Publish directory: `pr2_deploy` (definido em `netlify.toml` da raiz)
- Auto-deploy: **não** conectado ao GitHub (deploy manual via CLI). Motivo:
  o site é grande (67 MB, 3.633 arquivos) e não queremos rebuild do Netlify.

### Publicar uma nova versão

```bash
cd ~/Documents/enemparana
netlify deploy --prod --dir=pr2_deploy
```

Netlify CLI já está logado como `raphacorrea@gmail.com`. Upload demora ~1
minuto (envia só os arquivos que mudaram).

Ao terminar, imprime:
```
Production URL: https://enemparana.netlify.app
Build logs:     https://app.netlify.com/projects/enemparana/deploys/<hash>
```

### Configurar auto-deploy via GitHub (opcional)

Se quiser que cada `git push origin main` gere um deploy sozinho:

1. Netlify dashboard → **enemparana** → **Site configuration** → **Build & deploy** → **Continuous deployment**
2. **Link repository** → GitHub → `TTiba/enemparana` → branch `main`
3. Publish directory: `pr2_deploy` (já vem do `netlify.toml`)
4. Build command: **vazio** (é site estático, sem build)

Depois disso, o comando manual continua funcionando (útil pra deploy sem
esperar CI).

### Rollback

```bash
netlify api listSiteDeploys --data '{"site_id":"879df1d6-7cb4-4b2b-8c72-7dd503b8b02e"}' \
  | jq -r '.[:5][] | "\(.id)  \(.state)  \(.created_at)  \(.title // "-")"'
# copia o id do deploy anterior e:
netlify api restoreSiteDeploy --data '{"site_id":"879df1d6-7cb4-4b2b-8c72-7dd503b8b02e","deploy_id":"<ID>"}'
```

---

## 2. Deploy no Cloudflare Pages (secundário)

Diferente do Netlify, este é auto-deploy do GitHub — não usa CLI local.

### Setup (uma vez só)

1. Criar conta em https://dash.cloudflare.com/sign-up (grátis) se ainda não tem.

2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.

3. Autorizar o GitHub App do Cloudflare (limitar acesso apenas a
   `TTiba/enemparana` se preferir).

4. Selecionar repo `TTiba/enemparana` → **Begin setup**.

5. Configurações:
   - **Project name:** `enemparana` (vira `enemparana.pages.dev`)
   - **Production branch:** `main`
   - **Framework preset:** **None**
   - **Build command:** *(deixar vazio — é estático)*
   - **Build output directory:** `pr2_deploy`
   - **Root directory (advanced):** deixar em branco (raiz do repo)

6. **Save and Deploy**. O primeiro build sobe todos os arquivos (~2 min).

7. Ao terminar, URL fica em `https://enemparana.pages.dev` (mais custom
   domain se quiser depois).

### Publicar uma nova versão

Automático: qualquer push pra `main` no GitHub dispara build no Cloudflare.

```bash
cd ~/Documents/enemparana
# fazer alterações...
git add -A && git commit -m "..." && git push
# Cloudflare rebuilda em ~1-2 min
```

### Configurações extras

- **Add headers**: criar `pr2_deploy/_headers` com:
  ```
  /*
    X-Robots-Tag: noindex, nofollow
  ```
  (o `netlify.toml` faz o mesmo pra Netlify; `_headers` é o equivalente
  Cloudflare/Netlify universal.)

- **Rollback**: Dashboard → Deployments → clicar num deploy anterior → **Rollback**.

---

## 3. Redundância no dia da apresentação

Antes da apresentação, testar **ambos** os URLs:

```bash
for url in https://enemparana.netlify.app https://enemparana.pages.dev; do
  echo "=== $url ==="
  for p in / /mapa.html /criticas.html /priorizacao.html /ranking_escolas.html; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "${url}${p}")
    echo "  ${code}  ${p}"
  done
done
```

Todos devem ser **200**. Se algum der erro, a apresentação fica no outro URL.

**QR codes ou short links:** gere um pra cada URL antes da apresentação
(bit.ly, encurtador Wayground, etc.) pra ficar fácil compartilhar no slide.

---

## 4. Rebuild do `pr2_deploy/` (quando o source muda)

Se você mexeu em `pr2/` ou nos scripts do pipeline:

```bash
cd ~/Documents/Microdados\ ENEM/plataforma

# se atualizou histórico NRE:
.venv/bin/python pipeline/build_nre_hist.py

# se atualizou histogramas de nota (raro, só quando o CSV muda):
.venv/bin/python pipeline/build_hist_nota_pr.py

# regera pr2_deploy do zero:
python3 pr2/deploy_pr2.py
```

Depois sincroniza pro repo `enemparana` e faz commit + push:

```bash
cd ~/Documents/enemparana
rsync -a --delete ~/Documents/Microdados\ ENEM/plataforma/pr2/       pr2/
rsync -a --delete ~/Documents/Microdados\ ENEM/plataforma/pr2_deploy/ pr2_deploy/
git add -A
git commit -m "Atualiza deploy · <descrição>"
git push                         # dispara build no Cloudflare
netlify deploy --prod --dir=pr2_deploy   # deploy manual no Netlify
```

---

## 5. Troubleshooting

- **Netlify erro "File exceeds 25MB"**: o painel tem arquivos grandes
  (o maior é `enem_hist.sqlite`? não, não é servido). Se algum JSON passar
  de 25 MB, comprima antes ou divida.
- **Cloudflare Pages build falha**: verifica que "Build output directory"
  está exatamente `pr2_deploy` (sem barra inicial).
- **Página em branco no Netlify mas funciona local**: provavelmente
  `window.API_STATIC = 1` não foi injetado em algum HTML. Rerodar
  `python3 pr2/deploy_pr2.py`.
- **Histograma some no /mapa.html**: `data/hist_nota_pr.json` faltando no
  `pr2_deploy/data/`. O `deploy_pr2.py` já inclui esse arquivo desde
  2026-07-25 — se ainda faltar, roda o script de novo.

---

## Referências

- Painel Nacional (produção): https://microdadosenem.netlify.app
- Repo Nacional: https://github.com/TTiba/painelenem
- Repo Paraná v2: https://github.com/TTiba/enemparana
- Netlify docs: https://docs.netlify.com/cli/get-started/
- Cloudflare Pages docs: https://developers.cloudflare.com/pages/get-started/
