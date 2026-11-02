# Testes E2E

## Overview

Suite Playwright que exercita o app real (rotas de API e UI) contra um banco PostgreSQL exclusivo. Os serviços caros ficam de fora: a transcrição roda com o motor `mock` e a Maritaca é trocada por um servidor HTTP local.

## Key files

| File | Owns |
|---|---|
| `playwright.config.ts` (raiz) | Execução serial, Chromium com mídia falsa, e o ambiente do `webServer` |
| `e2e/support/global-setup.ts` | Valida o ambiente, sobe o mock da Maritaca e salva a sessão de cada usuário em `e2e/.auth/` |
| `e2e/support/global-teardown.ts` | Para o mock, limpa os dados e apaga o diretório de uploads |
| `e2e/support/test.ts` | `test` estendido com as fixtures `db` e `maritacaPort` |
| `e2e/fixtures/db.ts` | `seedGravacao`, `cleanupE2eData`, `placeMp4Fixture` e o cliente Prisma do banco E2E |
| `e2e/fixtures/maritaca-mock.ts` | Servidor local que responde um termo fixo no lugar da Maritaca |

## Commands

```bash
# Uma vez, depois de criar o .env.e2e a partir do .env.e2e.example
npm run test:e2e:setup

# Suite completa
npm run test:e2e

# Um arquivo, com o navegador visível
npx playwright test e2e/smoke.spec.ts --headed

# Banco E2E apagado e recriado (perde os dados), útil quando o schema mudou
npm run test:e2e:reset
```

## Conventions

- Importe `test` e `expect` de `./support/test`, assim as fixtures ficam disponíveis.
- Crie dados com `seedGravacao`, que gera ids com prefixo `e2e-`, e chame `cleanupE2eData` no `afterEach`.
- Para agir como um usuário, use `storageState: "e2e/.auth/<usuario>.json"` (`servidor1`, `servidor2` ou `juiz1`). A sessão é criada no `globalSetup`.
- Os testes compartilham o banco, por isso a suite roda com um único worker. Não ligue o paralelismo sem isolar os dados antes.

## Gotchas

- `cleanupE2eData` só apaga ids que começam com `e2e-`. Uma gravação criada por `POST /api/gravacoes` recebe um cuid comum e fica no banco, a menos que o próprio teste a apague.
- Fora do CI, o Playwright reaproveita um servidor que já esteja rodando (`reuseExistingServer`). Um `npm run dev` aberto com o `.env` normal atende os testes com o banco de desenvolvimento e o motor de transcrição real, sem o ambiente E2E. Feche esse servidor antes de rodar a suite.
- O `globalSetup` falha se `E2E_DATABASE_URL` estiver vazio ou se o usuário `servidor1` não existir. Nos dois casos, a saída é configurar o `.env.e2e` e rodar `npm run test:e2e:setup`.
- O mock da Maritaca escuta na porta `E2E_MARITACA_PORT` (padrão `39871`). Essa porta precisa estar livre.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
