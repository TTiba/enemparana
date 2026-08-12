# Instruções do repositório

**Leia `ESTADO.md` antes de qualquer coisa.** Ele tem o estado corrente dos
dois painéis (Paraná e nacional), o que está em aberto e as armadilhas já
pisadas. `status.md` tem o detalhe e o histórico.

Ao terminar uma tanda de trabalho, atualize o `ESTADO.md` — seções **Onde
está cada coisa**, **Em aberto** e a data no topo.

## Três fatos que já foram confundidos

1. **O Paraná tem os dois caminhos de publicação, e isso já confundiu.** O
   Netlify **está** ligado ao repo (produção = branch `main`), e além disso
   se publica manual com `netlify deploy --prod --dir=pr2_deploy`. Por muito
   tempo só o manual foi usado, então a `main` ficou atrás do que estava no
   ar — **não deduza o que está em produção olhando a `main`**, nem o card
   "Production: main@sha" do Netlify, que mostra só o último deploy vindo do
   git. Confira o site. O Cloudflare (`wrangler.toml` → `pr2_deploy/`)
   também publica da `main`, então mergear dispara os dois.
   **Nacional publica por push/merge na `main`** (Netlify conectado ao
   GitHub).
2. **`pr2_deploy/` é derivado de `deploy/`** — `deploy_pr2.py` lê
   `deploy/api/` e `data/enem2025.sqlite`. Um rebuild corrige os dois.
3. **Não afirme número que não mediu.** Há ferramenta pra isso:
   `verifica_calibracao.py <deploy>` e `diag_deploy.py <deploy>...`.
   Rode antes de reportar.

## Branch

Desenvolvimento em `claude/enem-canal-bug-5g78e7`. Não mergear na `main` sem
pedido explícito — mergear publica (Netlify e Cloudflare leem a `main`).
Antes de mergear, confira que o branch está à frente do que está no ar, e
não atrás; foi por isso que a regra existe.
