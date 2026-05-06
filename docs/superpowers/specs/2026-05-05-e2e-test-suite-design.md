# Design — Suite e2e abrangente para Audiencia

**Data:** 2026-05-05
**Autor:** Bruno Prestes (com Claude Code)
**Status:** Proposto

## Objetivo

Construir uma suite Playwright que cubra os fluxos críticos do monólito (auth, gravação, upload, consulta, transcrição, termo de audiência, exports), substituindo o smoke atual (`e2e/smoke.spec.ts`, dois testes) por uma suite estruturada que rode em < 5 min localmente, hermética, sem custo de API e sem flakes.

## Não-objetivos

- Não testar a captura real de câmera/mic com áudio significativo (o ambiente headless usa `--use-fake-device-for-media-stream`, suficiente para testar fluxo do wizard mas não a qualidade da gravação).
- Não validar a saída perceptiva da transcrição/diarização (os motores Whisper/Wav2Vec2/Google têm testes unitários separados em `src/lib/transcription-local/`).
- Não testar visualmente a renderização do PDF/DOCX exportado — só content-type e tamanho não-zero.
- Não cobrir performance/load.

## Decisões de arquitetura

### Estratégia de dependências externas

Adotamos a **abordagem A** (mock server local + Prisma seed):

| Dependência | Onde roda | Estratégia | Motivo |
|---|---|---|---|
| Maritaca AI | Server (Next) | Mock HTTP local em porta livre, injetado via `MARITACA_BASE_URL` | Evita custo, determinístico, valida o pipeline real do Next |
| Motor de transcrição | Server (Next) | Novo motor `mock` em `transcription-local/engine.ts`, ativado por `LOCAL_TRANSCRIPTION_ENGINE=mock` | Permite testar `POST /transcricao` ponta-a-ponta sem instalar Whisper/Python |
| FFmpeg (upload) | Server (Next) | Real, com WebM fixture de ~50KB | Já está no PATH do dev, valida o pipeline crítico de transcodificação |
| MediaRecorder/getUserMedia | Browser | Flag `--use-fake-device-for-media-stream` do Chromium | Wizard de gravação funciona ponta-a-ponta sem hardware |
| `page.route` | Browser | Usado pontualmente para simular falhas de API | Quando precisamos provocar erros sem alterar DB |

### Banco de dados de teste

- **Variável obrigatória:** `E2E_DATABASE_URL`. Se ausente, `globalSetup` aborta com mensagem clara — nunca cai no `DATABASE_URL` de dev.
- **Schema:** aplicado via `prisma migrate deploy` antes da suite (script `test:e2e:setup`).
- **Seed:** roda `prisma db seed` para criar `servidor1`, `servidor2`, `juiz1` (mesma vara, senha `senha123`).
- **Isolamento:** todos os registros criados por testes têm `id` prefixado com `e2e-`. `globalTeardown` faz `DELETE WHERE id LIKE 'e2e-%'` em `Gravacao`. Users do seed permanecem entre execuções.
- **Concorrência:** Playwright `fullyParallel: true` exige dados independentes por teste; cada teste cria seus próprios registros com IDs únicos.

### Motor de transcrição `mock`

Novo arquivo `src/lib/transcription-local/mock.ts` exportando função compatível com a assinatura usada por `transcribe.ts` (mesma forma de `whisper.ts`/`wav2vec.ts`):

```ts
// Retorna segmentos pré-fabricados com role variando, simulando diarização
export async function transcribeWithMock(input: AudioInput): Promise<TranscriptionRawResult> { ... }
```

Integração:

1. `engine.ts` — adicionar `"mock"` ao tipo `LocalTranscriptionEngine` e mapear em `getLocalTranscriptionEngine` (`if (raw === "mock") return "mock"`).
2. `transcribe.ts` — adicionar branch no `switch (engine)` que invoca `transcribeWithMock`.
3. `validate-runtime.ts` — adicionar branch que retorna `{ ok: true }` para `engine === "mock"`.

Zero dependências runtime (sem Python, sem binários). Documentado apenas em `.env.e2e.example`, não em `AGENTS.md`.

### Mock server da Maritaca

`e2e/fixtures/maritaca-mock.ts` — servidor `http.createServer` (sem framework), bind em porta efêmera (`listen(0)`).

- Aceita `POST /chat/completions` (path real da Maritaca após `MARITACA_BASE_URL`).
- Valida header `Authorization: Key test-key`.
- Inspeciona o último `user message`: se contiver `numeroProcesso=ERRO_FORCADO`, retorna 500 (para testar caminho de erro).
- Caso contrário, retorna JSON estruturado válido segundo `src/lib/termo-audiencia/schema.ts` com `tipoSentenca: "procedencia"` e `markdown: "# Termo de Audiência..."`.
- Logs de cada chamada acessíveis para asserções (`mock.lastCall`).

URL final exposta via global state e injetada em `webServer.env` do Playwright.

## Estrutura de arquivos

```
e2e/
├── fixtures/
│   ├── auth.ts              # storageStates por papel
│   ├── db.ts                # helpers Prisma (createGravacao, seedTranscricao, seedTermo, cleanup)
│   ├── files.ts             # path para sample.webm
│   ├── sample.webm          # fixture binária ~50KB (gerada uma vez com `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240 -c:v libvpx -b:v 64k sample.webm`, commitada)
│   └── maritaca-mock.ts     # servidor HTTP de mock
├── support/
│   ├── global-setup.ts      # checa E2E_DATABASE_URL, sobe mock Maritaca, gera storageStates
│   ├── global-teardown.ts   # mata mock, DELETE e2e-* do DB
│   └── test.ts              # custom test fixture
├── auth.spec.ts
├── access-control.spec.ts
├── dashboard.spec.ts
├── consulta.spec.ts
├── gravacao-crud.spec.ts
├── upload.spec.ts
├── reproducao.spec.ts
├── transcricao.spec.ts
├── termo.spec.ts
├── termo-export.spec.ts
└── smoke.spec.ts            # mantido
```

## Cobertura por spec

### `auth.spec.ts`
- Login válido como SERVIDOR redireciona para `/dashboard` e mostra "Painel do Servidor".
- Login válido como JUIZ mostra "Painel do Juiz".
- Senha errada exibe "Usuário ou senha inválidos."
- Acesso anônimo a `/dashboard`, `/consulta`, `/gravacao/nova` redireciona a `/login`.
- Logout (botão "Sair" em `AppHeader.tsx`) executa `signOut`, redireciona para `/login` e invalida a sessão (`/dashboard` redireciona de volta a `/login`).

### `access-control.spec.ts`
- JUIZ tentando `/gravacao/nova` redireciona para `/dashboard` (middleware).
- JUIZ tentando `POST /api/gravacoes` recebe 403.
- SERVIDOR2 tentando `PATCH /api/gravacoes/<id-do-servidor1>` recebe 403.
- SERVIDOR2 tentando `DELETE /api/gravacoes/<id-do-servidor1>` recebe 403.
- JUIZ vê na consulta gravações de QUALQUER servidor da própria vara.
- SERVIDOR só vê suas próprias.

### `dashboard.spec.ts`
- Heading "Painel do Servidor" + link "Nova Gravação" visível para SERVIDOR.
- Heading "Painel do Juiz" + ausência do link "Nova Gravação" para JUIZ.
- Saudação contém o `name` do usuário.

### `consulta.spec.ts`
- Lista vazia mostra "Nenhuma gravação encontrada".
- Após seedar 25 gravações, paginação mostra "Página 1 de 2", botão "Próximo" funciona.
- Busca por número parcial filtra (debounce — usar `expect.poll` com timeout 1500ms).
- Botão "Limpar busca" reseta.
- Botão "Excluir" abre modal; confirmar remove a gravação da lista.
- Botão "Transcrever" desabilitado quando `status !== "FINALIZADA"`.

### `gravacao-crud.spec.ts` (testa via `request.fetch`, sem UI)
- `POST /api/gravacoes` cria registro; campos obrigatórios validados (400).
- `GET /api/gravacoes/:id` retorna registro próprio para SERVIDOR.
- `PATCH /api/gravacoes/:id` atualiza metadados; cross-user 403.
- `DELETE /api/gravacoes/:id` remove; cross-user 403; não-existente 404.

### `upload.spec.ts`
- `POST /api/upload` com WebM fixture + `gravacaoId` válido: status 200, `Gravacao.caminhoArquivo` populado, `status="FINALIZADA"`.
- WebM enviado é convertido para MP4 (probe rápido com FFmpeg para validar saída — opcional, usar `Content-Type` armazenado).
- Upload sem ser dono da gravação: 403.
- Upload sem arquivo no multipart: 400.

### `reproducao.spec.ts`
- Após seedar gravação com `caminhoArquivo` apontando para MP4 fixture, página `/gravacao/:id/reproduzir` carrega `<video>` com `src` apontando para `/api/gravacoes/:id/stream`.
- `GET /stream` com header `Range: bytes=0-1023` retorna 206 + Content-Range.
- JUIZ da mesma vara consegue acessar.
- SERVIDOR de outra vara recebe 403.

### `transcricao.spec.ts`
- `GET /api/gravacoes/:id/transcricao` retorna 404 quando ainda não existe.
- Após seed (`transcricaoStatus=CONCLUIDA` + segmentos), GET retorna 200 com segmentos.
- `POST /api/gravacoes/:id/transcricao` por SERVIDOR dono dispara motor `mock`, atualiza `transcricaoStatus` para CONCLUIDA, popula `transcricaoTexto` e `transcricaoSegmentos`.
- POST por SERVIDOR não-dono: 403.
- `PATCH /api/gravacoes/:id/transcricao` (escrita realtime) funciona para servidor dono.
- Na UI da consulta, badge muda de "Pendente" → "Processando" → "Concluída" após disparar (com `expect.poll` no polling de 4s do frontend).

### `termo.spec.ts`
- Pré-condição: gravação com `transcricaoStatus=CONCLUIDA` + segmentos com role.
- `POST /api/gravacoes/:id/termo` chama o mock Maritaca; `mock.lastCall` contém prompt com prefixos `[JUIZ]`/`[PARTE]`/`[PROCURADOR]`.
- Após POST, `Gravacao.termoStatus="CONCLUIDA"`, `termoTexto` populado, `termoEstruturado.tipoSentenca` definido.
- `PATCH /termo` salva markdown editado.
- `GET /termo` por JUIZ mesma vara: 200; vara errada: 403.
- Quando mock retorna 500 (caso `numeroProcesso=ERRO_FORCADO`), `termoStatus="ERRO"` + `termoErro` populado.

### `termo-export.spec.ts`
- Gravação com termo gerado.
- `GET /termo/export?formato=pdf` retorna 200, `Content-Type: application/pdf`, body > 1KB.
- `GET /termo/export?formato=docx` retorna 200, content-type DOCX, body > 1KB.
- Sem termo: 404.
- Formato inválido: 400.

### `smoke.spec.ts`
- Mantido como é (login + redirect anônimo).

## Fluxo de execução

1. Dev configura `E2E_DATABASE_URL` em `.env.e2e` (template em `.env.e2e.example`).
2. `npm run test:e2e:setup` aplica migrações e roda seed no DB de teste.
3. `npm run test:e2e` invoca `playwright test`. `globalSetup`:
   - Valida `E2E_DATABASE_URL`.
   - Sobe Maritaca mock em porta livre, exporta URL para arquivo temp lido pelo `webServer.env`.
   - Faz login programático para cada usuário e salva storage state em `e2e/.auth/<role>.json`.
4. Playwright sobe `npm run dev` com env injetadas (`MARITACA_BASE_URL`, `MARITACA_API_KEY=test-key`, `LOCAL_TRANSCRIPTION_ENGINE=mock`, `DATABASE_URL=<E2E_DATABASE_URL>`, `UPLOAD_DIR=/tmp/audiencia-e2e-uploads`).
5. Specs rodam em paralelo (Chromium).
6. `globalTeardown`: mata Maritaca mock; deleta `Gravacao` com `id LIKE 'e2e-%'`; remove `/tmp/audiencia-e2e-uploads`.

## Dependências adicionais

- Nenhuma dependência runtime nova obrigatória; o mock server usa só `node:http`.
- Já presentes: `@playwright/test`, `@prisma/client`, `bcryptjs` (via seed).
- `chromium` precisa ser instalado uma vez: `node ./node_modules/@playwright/test/cli.js install chromium` (já documentado).

## Mudanças no código de produção

Mínimas e bem isoladas:

1. **`src/lib/transcription-local/mock.ts`** — novo arquivo (~40 linhas).
2. **`src/lib/transcription-local/engine.ts`** — adiciona `"mock"` ao tipo e ao mapeamento (~3 linhas).
3. **`src/lib/transcription-local/transcribe.ts`** — branch no switch para invocar mock (~3 linhas).
4. **`src/lib/transcription-local/validate-runtime.ts`** — branch ok para `mock` (~2 linhas).
5. **`package.json`** — scripts `test:e2e:setup` e `test:e2e:teardown`.
6. **`.env.e2e.example`** — novo arquivo documentando vars.
7. **`playwright.config.ts`** — globalSetup, globalTeardown, webServer.env.

Nenhuma alteração em rotas, hooks, ou componentes.

## Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Headless Chromium falha em getUserMedia | `launchOptions.args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']` no projeto |
| Testes paralelos colidem em `UPLOAD_DIR` | Cada teste de upload escreve em subdir único `${UPLOAD_DIR}/${testId}` |
| Maritaca mock vaza entre runs | Listen em porta efêmera + cleanup em globalTeardown |
| `e2e-` prefix conflita com IDs CUID reais | CUID nunca começa com `e2e-` (começa com `c` + base36); seguro |
| Seed cria users a cada run | `upsert` no seed.ts já é idempotente |

## Métricas de sucesso

- Suite completa < 5 min em laptop dev.
- Zero flakes em 10 runs consecutivos.
- Cobertura (manual): cada rota em `src/app/api/**` tocada ao menos uma vez; cada papel testado em pelo menos um caminho positivo e um negativo.
- CI: workflow `test-engineer.yml` extendido com job `e2e` (depois — fora do escopo deste design).

## Ordem de implementação proposta

1. Infra: `playwright.config.ts`, `globalSetup`, `globalTeardown`, fixtures básicas, motor `mock`.
2. `auth.spec.ts` + `access-control.spec.ts` (validam infra de auth).
3. `gravacao-crud.spec.ts` + `dashboard.spec.ts` + `consulta.spec.ts`.
4. `upload.spec.ts` (precisa de WebM fixture).
5. `transcricao.spec.ts` + `reproducao.spec.ts`.
6. `termo.spec.ts` + `termo-export.spec.ts` (precisa do mock Maritaca).
