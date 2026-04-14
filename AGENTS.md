# Audiencia — guia para agentes e desenvolvedores

Monólito **Next.js 16** (App Router) para gravação e consulta de audiências judiciais (TRF1): autenticação **NextAuth** (JWT + credenciais), **PostgreSQL** via **Prisma**, upload de vídeo com **FFmpeg** no servidor e transcrição local.

## Requisitos de ambiente

- **Node.js** compatível com o `package.json` do repositório.
- **PostgreSQL** acessível pela `DATABASE_URL`.
- **FFmpeg** instalado e disponível no `PATH` do processo que executa o Next (upload padrão, remux de recuperação e transcodificação WebM → MP4).
- **Transcrição em lote (opcional Wav2Vec2):** Python 3 com `pip install -r requirements-transcription.txt` (PyTorch + Transformers); o primeiro uso pode baixar o modelo do Hugging Face.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Sim | URL do PostgreSQL (Prisma). |
| `NEXTAUTH_SECRET` | Sim | Segredo para assinatura JWT/sessão. |
| `NEXTAUTH_URL` | Sim em produção | URL base da aplicação (ex.: `http://localhost:3000`). |
| `UPLOAD_DIR` | Não | Diretório absoluto para arquivos de vídeo; padrão: `<cwd>/uploads`. |
| `UPLOAD_DEBUG_LOGS` | Não | Em dev, `false` desativa logs extras de upload (padrão: logs ativos fora de produção). |
| `LOCAL_TRANSCRIPTION_ENGINE` | Não | `whisper` (padrão) ou `wav2vec2` — motor da transcrição em lote. |
| `WHISPER_CPP_BIN` | Se `whisper` | Caminho absoluto do executável do whisper.cpp. |
| `WHISPER_MODEL_PATH` | Se `whisper` | Caminho absoluto do modelo `ggml-*.bin`. |
| `TRANSCRIPTION_PYTHON` | Não | Intérprete Python para Wav2Vec2 (padrão: `python3`). |
| `TRANSCRIPTION_WAV2VEC_SCRIPT` | Não | Caminho do script Python (relativo ao cwd ou absoluto); padrão: `scripts/transcribe_wav2vec2.py`. |
| `HF_MODEL_ID` | Não | ID do modelo no Hugging Face (padrão: `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese`). |
| `HF_HOME` | Não | Cache de modelos/datasets HF (opcional). |

Copie [`.env.example`](.env.example) para `.env` e ajuste os valores.

## Comandos úteis

- `npm run dev` — desenvolvimento (Turbopack).
- `npm run build` / `npm run start` — produção.
- `npm run lint` / `npm run type-check` — qualidade estática.
- `npm run test` — Vitest (libs e algumas rotas).
- `npm run test:e2e` — Playwright (smoke em `e2e/`; na primeira vez, instale o Chromium com `node ./node_modules/@playwright/test/cli.js install chromium`).
- `npx prisma migrate dev` — aplicar migrações; `npx prisma db seed` — usuários de exemplo (ver seed).

## Papéis e regras de negócio

- **`SERVIDOR`**: cria gravações, grava envia arquivo (`POST /api/upload`), atualiza/exclui apenas as próprias gravações. Middleware bloqueia rotas de gravação (`/gravacao/nova`, `/gravacao/...` exceto reprodução) para quem não é servidor.
- **`JUIZ`**: lista e acessa gravações cuja `vara` coincide com a do usuário (consulta, stream, download, transcrição de leitura).

Autorização compartilhada em [`src/lib/gravacao-access.ts`](src/lib/gravacao-access.ts): `assertGravacaoAccess` com modos `read` e `write` (contextos `patch` | `delete` | `upload` para mensagens de erro).

## Fluxos principais

1. **Login** — `POST` em `/api/auth/[...nextauth]` (Credentials); sessão JWT.
2. **Nova gravação** — `POST /api/gravacoes` cria registro; cliente grava (WebM), opcionalmente chunks/recuperação em IndexedDB; `PATCH /api/gravacoes/:id` atualiza metadados/estado.
3. **Upload final** — `POST /api/upload` (multipart): exige **servidor dono** da gravação; persiste WebM, transcodifica para MP4, remove WebM, atualiza `caminhoArquivo` e `status`.
4. **Consulta** — `GET /api/gravacoes` com paginação e busca; reprodução via `GET /api/gravacoes/:id/stream` ou download.
5. **Transcrição** — `GET/POST/PATCH /api/gravacoes/:id/transcricao` (leitura conforme papel; escrita em tempo real apenas servidor dono). Transcrição em lote: `LOCAL_TRANSCRIPTION_ENGINE=whisper` (whisper.cpp) ou `wav2vec2` (Python + HF).

## Organização do código

- `src/app` — rotas App Router e route handlers em `src/app/api/**`.
- `src/components` — UI por área (`recording`, `consultation`, `metadata`, `layout`, `ui`).
- `src/hooks` — captura de mídia, streams, IndexedDB, recuperação.
- `src/lib` — auth de API, Prisma, upload/FFmpeg, transcrição, segmentação, etc.
- `prisma/` — `schema.prisma` e `seed.ts`.

## Seed de desenvolvimento

Usuários criados pelo seed (senha **`senha123`**): `servidor1`, `servidor2`, `juiz1` (todos na mesma vara de exemplo). Use apenas em ambiente de desenvolvimento.

## Documentação cruzada

- [`CLAUDE.md`](CLAUDE.md) aponta para este arquivo como referência principal para agentes.
