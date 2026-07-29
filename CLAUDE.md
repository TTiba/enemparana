# Instruções do repositório

**Leia `ESTADO.md` antes de qualquer coisa.** Ele tem o estado corrente dos
dois painéis (Paraná e nacional), o que está em aberto e as armadilhas já
pisadas. `status.md` tem o detalhe e o histórico.

Ao terminar uma tanda de trabalho, atualize o `ESTADO.md` — seções **Onde
está cada coisa**, **Em aberto** e a data no topo.

## Três fatos que já foram confundidos

1. **Paraná publica manual**, `netlify deploy --prod --dir=pr2_deploy`; não é
   ligado ao git. **Nacional publica por push/merge na `main`** (Netlify
   conectado ao GitHub). Não inverta.
2. **`pr2_deploy/` é derivado de `deploy/`** — `deploy_pr2.py` lê
   `deploy/api/` e `data/enem2025.sqlite`. Um rebuild corrige os dois.
3. **Não afirme número que não mediu.** Há ferramenta pra isso:
   `verifica_calibracao.py <deploy>` e `diag_deploy.py <deploy>...`.
   Rode antes de reportar.

## Branch

Desenvolvimento em `claude/enem-canal-bug-5g78e7`. Não mergear na `main` sem
pedido explícito — a `main` está bem atrás da produção, e mergear com o
Cloudflare ativo pode republicar versão velha.
