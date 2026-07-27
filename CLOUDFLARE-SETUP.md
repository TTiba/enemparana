# Tutorial · Publicar o Painel PR em um segundo servidor (Cloudflare Pages)

**Objetivo:** ter uma URL de redundância para o dia da apresentação. Se o
Netlify sair do ar ou tiver problema, o Cloudflare serve como backup.

**Resultado esperado ao terminar:**
- URL primário: https://enemparana.netlify.app (já configurado)
- URL secundário: https://enemparana.pages.dev (**este tutorial**)
- Ambos servindo exatamente o mesmo conteúdo do repo TTiba/enemparana
- Auto-deploy: a cada `git push` no `main`, o Cloudflare rebuilda sozinho

**Tempo estimado:** 10 minutos.

---

## 1. Pré-requisitos

Você precisa de:

- Uma conta Cloudflare (grátis). Se ainda não tem, crie em
  https://dash.cloudflare.com/sign-up
- Acesso ao repo https://github.com/TTiba/enemparana (você é o dono, então
  ok)
- O repo já com netlify.toml no root apontando `publish = "pr2_deploy"`
  (já está — verifique com `cat netlify.toml` se quiser)

---

## 2. Login e criação do projeto

1. Vá para https://dash.cloudflare.com e faça login
2. No menu lateral esquerdo, clique em **Workers & Pages**
3. Botão **Create** no topo da página → aba **Pages** → botão **Connect to Git**
4. **Connect GitHub** → autorizar o Cloudflare Pages App
   - Na tela de autorização do GitHub, você pode escolher entre:
     - **All repositories** (acesso a todos)
     - **Only select repositories** → **TTiba/enemparana** (mais seguro,
       recomendado)
   - Clicar **Install & Authorize**
5. De volta ao Cloudflare, deve aparecer a lista dos seus repos autorizados.
   Selecionar **TTiba/enemparana** → **Begin setup**

---

## 3. Configurações do build

Na tela "Set up builds and deployments", preencher **exatamente** assim:

| Campo | Valor |
|---|---|
| **Project name** | `enemparana` |
| **Production branch** | `main` |
| **Framework preset** | **None** |
| **Build command** | *(deixar vazio)* |
| **Build output directory** | `pr2_deploy` |
| **Root directory (Advanced)** | *(deixar em branco)* |
| **Environment variables** | *(nada)* |

> **Importante:** o "Build output directory" tem que ser exatamente
> `pr2_deploy` (sem barra inicial, sem `./`). Se errar aqui, o CF vai
> tentar servir o `pr2/` (source) que não tem `index.html` — resultando
> em 404.

Botão **Save and Deploy** no fim da tela.

---

## 4. Aguardar o primeiro build

Cloudflare começa o primeiro deploy imediatamente. Você vê uma tela de
progresso com 4 fases:

- **Initializing** (~10s) — clona o repo
- **Cloning repository** (~15s)
- **Building application** (~30s) — como não temos build, pula
- **Deploying to Cloudflare's global network** (~1min) — sobe os 5.691
  arquivos (~141 MB)

**Total: ~2min** no primeiro deploy. Nos seguintes, sobe só o diff (mais
rápido).

Ao terminar, Cloudflare mostra:
- **Deploy successful** em verde
- URL: `https://enemparana.pages.dev`
- Um alias por deploy tipo `https://abc123.enemparana.pages.dev` (útil
  pra rollback rápido)

---

## 5. Testar

Abra https://enemparana.pages.dev num navegador. Deve funcionar idêntico
ao Netlify. Sanity check via curl:

```bash
for url in https://enemparana.netlify.app https://enemparana.pages.dev; do
  echo "=== $url ==="
  for p in / /mapa.html /criticas.html /priorizacao.html /ranking_escolas.html \
           /api/entidade/UF/PR.json /api/historico/ESC/41063325.json \
           /data/hist_nota_pr.json; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "${url}${p}")
    echo "  ${code}  ${p}"
  done
done
```

Todos devem ser **200**. Se algum der 404, veja o Troubleshooting §7.

---

## 6. Fluxo de trabalho depois de configurado

Não precisa mais mexer no Cloudflare. A partir de agora:

```bash
cd ~/Documents/enemparana
# edita alguma coisa em pr2/... regenera pr2_deploy... etc
git add -A
git commit -m "..."
git push
# Cloudflare detecta o push e rebuilda em ~1-2min sozinho
```

Para acompanhar builds em andamento:
https://dash.cloudflare.com/?to=/:account/workers-and-pages/view/enemparana/deployments

---

## 7. Troubleshooting

### Site abre mas mostra 404 em todos os paths
- **Causa provável:** "Build output directory" está errado. Deveria ser
  `pr2_deploy` (não `./pr2_deploy`, não `pr2/`, não vazio).
- **Fix:** Cloudflare dashboard → Project → **Settings** → **Builds &
  deployments** → **Build configurations** → **Edit** → ajustar → salvar
  → Deployments → botão **Retry deployment** no último.

### Build falha com "No index.html found in output directory"
- Igual acima — output directory apontando pro lugar errado.

### `/data/*` ou `/api/*` retornam 404
- Verifique que rodou `python3 pr2/deploy_pr2.py` antes do push. O
  `pr2_deploy/` no repo tem que ter esses subdirs.
- Verifique se os arquivos estão no repo remoto:
  ```bash
  git ls-files pr2_deploy/api/historico/ESC/ | head
  git ls-files pr2_deploy/data/
  ```

### Custom domain (opcional, se quiser um domínio próprio)
- Dashboard → Project → **Custom domains** → **Set up a custom domain**
- Adiciona o domínio (ex.: `pr.microdadosenem.org`), Cloudflare mostra
  os registros DNS que você precisa configurar no seu registrador.

### Cloudflare começa a limitar ou dar erros de banda
- Free tier tem limites generosos (unlimited requests, 500 builds/mês).
  Só passaria se colocasse o Cloudflare como fonte de tráfego enorme.
  Não é uma preocupação real para o cenário de apresentação.

### Rollback pra uma versão anterior
- Dashboard → Project → **Deployments** → aba **All deployments** →
  clica num deploy antigo → botão **Rollback to this deployment**.
- Efeito imediato (~10s de propagação global).

---

## 8. Checklist pré-apresentação

Um dia antes de qualquer demo:

- [ ] Rodar `python3 pr2/deploy_pr2.py` no `plataforma/` se mexeu no source
- [ ] Sincronizar `pr2/` e `pr2_deploy/` no repo `enemparana` via rsync
- [ ] `git add -A && git commit -m "..." && git push` (dispara CF)
- [ ] `netlify deploy --prod --dir=pr2_deploy` (deploy manual no Netlify)
- [ ] Rodar o script do §5 para testar as duas URLs
- [ ] **Salvar as duas URLs num slide ou aba** — se cair uma, você tem a
      outra na mão sem precisar procurar

---

## 9. Referências

- Cloudflare Pages docs: https://developers.cloudflare.com/pages/
- Guia de builds estáticos: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- Suporte de framework detection: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Dashboard: https://dash.cloudflare.com/?to=/:account/workers-and-pages
- Sobre o repo: [README](./status.md) · [Deploy geral](./DEPLOY.md)
