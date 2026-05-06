# Audiencia — guia para agentes e desenvolvedores

Monólito **Next.js 16** (App Router) para gravação e consulta de audiências judiciais (TRF1): autenticação **NextAuth** (JWT + credenciais), **PostgreSQL** via **Prisma**, upload de vídeo com **FFmpeg** no servidor e transcrição local.

## Requisitos de ambiente

- **Node.js** compatível com o `package.json` do repositório.
- **PostgreSQL** acessível pela `DATABASE_URL`.
- **FFmpeg** instalado e disponível no `PATH` do processo que executa o Next (upload padrão, remux de recuperação e transcodificação WebM → MP4).
- **Transcrição em lote (opcional Wav2Vec2 ou legal-whisper):** Python 3 com `pip install -r requirements-transcription.txt` (PyTorch + Transformers; `peft` + `accelerate` exigidos pelo motor `legal-whisper`; `silero-vad` exigido se `TRANSCRIPTION_USE_VAD=1`; `bitsandbytes` exigido em GPU para `LEGAL_WHISPER_QUANT=8bit`); o primeiro uso pode baixar o modelo do Hugging Face.
- **Transcrição em lote (opcional Google Cloud Speech-to-Text v2 + Chirp 2):** sem dependências Python. Exige Service Account com papéis `Speech-to-Text User` + `Storage Object Admin` no bucket `GCS_TRANSCRIPTION_BUCKET`. As libs `@google-cloud/speech` e `@google-cloud/storage` já estão no `package.json`.
- **Geração de Termo de Audiência (opcional Maritaca AI):** após transcrição concluída, o servidor pode gerar o Termo de Audiência via LLM (`sabia-4`). Requer `MARITACA_API_KEY`. Bibliotecas `docx` e `pdfkit` (já no `package.json`) cuidam do export final.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Sim | URL do PostgreSQL (Prisma). |
| `NEXTAUTH_SECRET` | Sim | Segredo para assinatura JWT/sessão. |
| `NEXTAUTH_URL` | Sim em produção | URL base da aplicação (ex.: `http://localhost:3000`). |
| `UPLOAD_DIR` | Não | Diretório absoluto para arquivos de vídeo; padrão: `<cwd>/uploads`. |
| `UPLOAD_DEBUG_LOGS` | Não | Em dev, `false` desativa logs extras de upload (padrão: logs ativos fora de produção). |
| `LOCAL_TRANSCRIPTION_ENGINE` | Não | `whisper` (padrão), `wav2vec2`, `legal-whisper` ou `google` — motor da transcrição em lote. |
| `WHISPER_CPP_BIN` | Se `whisper` | Caminho absoluto do executável do whisper.cpp. |
| `WHISPER_MODEL_PATH` | Se `whisper` | Caminho absoluto do modelo `ggml-*.bin`. |
| `TRANSCRIPTION_PYTHON` | Não | Intérprete Python para Wav2Vec2 / legal-whisper (padrão: `python3`). |
| `TRANSCRIPTION_WAV2VEC_SCRIPT` | Não | Caminho do script Python Wav2Vec2 (relativo ao cwd ou absoluto); padrão: `scripts/transcribe_wav2vec2.py`. |
| `HF_MODEL_ID` | Não | ID do modelo no Hugging Face para Wav2Vec2 (padrão: `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese`). |
| `HF_HOME` | Não | Cache de modelos/datasets HF (opcional). |
| `TRANSCRIPTION_LEGAL_WHISPER_SCRIPT` | Não | Caminho do script Python do motor `legal-whisper` (padrão: `scripts/transcribe_legal_whisper.py`). |
| `LEGAL_WHISPER_MODEL_ID` | Não | Adapter PEFT no Hugging Face (padrão: `rhaymison/transcription-portuguese-legal-whisper-peft`). |
| `LEGAL_WHISPER_BASE_MODEL_ID` | Não | Modelo base do adapter (padrão: `openai/whisper-large-v3`). |
| `LEGAL_WHISPER_QUANT` | Não | `8bit` (default; só ativa em GPU CUDA com `bitsandbytes`) ou `none` (fp16/fp32). Recomendação do model card. |
| `LEGAL_WHISPER_ATTN_IMPL` | Não | Implementação de atenção (padrão `sdpa`; cai para `eager` se incompatível). |
| `LEGAL_WHISPER_INITIAL_PROMPT` | Não | Prompt inicial para bias léxico (padrão: texto jurídico). |
| `WHISPER_INITIAL_PROMPT` | Não | Prompt inicial para whisper.cpp (passado via `--prompt`); vazio = sem prompt. |
| `TRANSCRIPTION_AUDIO_PREPROCESS` | Não | `basic` (default — Whisper recomenda áudio bruto), `loudness` (só two-pass loudnorm) ou `full` (loudness + highpass/lowpass; risco de regressão). |
| `TRANSCRIPTION_USE_VAD` | Não | `1` ativa pré-segmentação por Silero-VAD antes do ASR (reduz hallucination em silêncio). |
| `TRANSCRIPTION_VAD_SCRIPT` | Não | Caminho do script Python VAD (padrão: `scripts/preprocess_vad.py`). |
| `VAD_MIN_SPEECH_MS` / `VAD_MIN_SILENCE_MS` / `VAD_PADDING_MS` | Não | Tunables do Silero-VAD (defaults: 250 / 500 / 80). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Se `google` | Caminho absoluto do JSON da Service Account com papéis `Speech-to-Text User` + `Storage Object Admin` no bucket. |
| `GCS_TRANSCRIPTION_BUCKET` | Se `google` | Nome do bucket GCS para upload temporário do WAV (limpo automaticamente após cada transcrição). |
| `GOOGLE_TRANSCRIPTION_REGION` | Não | Região do recognizer (padrão: `us-central1`; Chirp 2 nem sempre está em `southamerica-east1`). |
| `GOOGLE_TRANSCRIPTION_MODEL` | Não | Modelo Speech-to-Text v2: `chirp_2` (padrão; sem diarização nativa em batch), `chirp_3` (com diarização nativa, otimizado para multi-locutor) ou `latest_long`. |
| `GOOGLE_TRANSCRIPTION_LANGUAGE` | Não | Código BCP-47 (padrão: `pt-BR`). |
| `GOOGLE_TRANSCRIPTION_DIARIZATION_ENABLED` | Não | `false` por default. Habilite só com modelo compatível (ex.: `chirp_3`). `chirp_2` em batch rejeita `diarizationConfig`. |
| `GOOGLE_TRANSCRIPTION_DIARIZATION_MIN_SPEAKERS` / `GOOGLE_TRANSCRIPTION_DIARIZATION_MAX_SPEAKERS` | Não | Limites quando diarização nativa está habilitada (defaults: 2 / 6). |
| `GOOGLE_TRANSCRIPTION_USE_GRPC` | Não | `false` por default — usa REST/JSON. Se `true`, usa gRPC (mais sujeito a erros mascarados ao rodar dentro de Next/Turbopack). |
| `MARITACA_API_KEY` | Se gerar termo | Chave da Maritaca AI. Header de auth é `Authorization: Key <chave>` (NÃO Bearer). |
| `MARITACA_MODEL` | Não | Modelo Maritaca (padrão: `sabia-4` — 128k contexto, structured output, corpus jurídico BR). |
| `MARITACA_BASE_URL` | Não | URL base da API Maritaca (padrão: `https://chat.maritaca.ai/api`). |

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
5. **Transcrição** — `GET/POST/PATCH /api/gravacoes/:id/transcricao` (leitura conforme papel; escrita em tempo real apenas servidor dono). Transcrição em lote: `LOCAL_TRANSCRIPTION_ENGINE=whisper` (whisper.cpp), `wav2vec2` (Python + HF), `legal-whisper` (Whisper-large-v3 + adapter PEFT especializado em audiências judiciais — [rhaymison/transcription-portuguese-legal-whisper-peft](https://huggingface.co/rhaymison/transcription-portuguese-legal-whisper-peft)) ou `google` (Speech-to-Text v2 + Chirp 2 com diarização nativa, áudio enviado para GCS e removido após o batchRecognize).
6. **Termo de Audiência** — `GET/POST/PATCH /api/gravacoes/:id/termo` (geração e edição: apenas servidor dono; leitura conforme papel). Após `transcricaoStatus === CONCLUIDA`, o servidor dispara `POST /termo` que invoca [Maritaca AI](https://docs.maritaca.ai) (`sabia-4`) com a transcrição diarizada e os metadados do processo, recebe um Termo estruturado em JSON (campo `markdown` editável + `tipoSentenca` classificado: `extincao_sem_merito | procedencia | improcedencia | acordo | outra`) e persiste em `Gravacao.termoTexto`/`termoEstruturado`. Edição manual via `PATCH /termo`. Export em PDF/DOCX via `GET /api/gravacoes/:id/termo/export?formato=pdf|docx` (renderizadores em [`src/lib/termo-audiencia/render.ts`](src/lib/termo-audiencia/render.ts) usando `pdfkit` e `docx`).

## Organização do código

- `src/app` — rotas App Router e route handlers em `src/app/api/**`.
- `src/components` — UI por área (`recording`, `consultation`, `metadata`, `layout`, `ui`).
- `src/hooks` — captura de mídia, streams, IndexedDB, recuperação.
- `src/lib` — auth de API, Prisma, upload/FFmpeg, transcrição, segmentação, etc.
- `prisma/` — `schema.prisma` e `seed.ts`.

## Pós-processamento e mitigação de hallucinations

Pipeline aplicado aos motores **whisper, wav2vec2 e legal-whisper** em [`src/lib/transcription-local/transcribe.ts`](src/lib/transcription-local/transcribe.ts), nesta ordem (motor `google` pula esse pipeline — Chirp 2 não exibe os padrões abaixo):

1. **`filterWhisperHallucinations`** ([transcription-cleanup.ts](src/lib/transcription-cleanup.ts)) — remove segmentos cujo texto inteiro casa com padrões conhecidos de hallucination do Whisper:
   - Despedidas de YouTube ("obrigado por assistir", "até o próximo vídeo", "curtam e se inscrevam")
   - Créditos de legendagem ("Legendas pela comunidade Amara.org", "Tradução e legendagem por...")
   - Marcadores não-fala ("[música]", "(applause)", "♪")
   - Vazamentos do corpus em inglês ("Thank you for watching", "Subscribe to my channel")
   - Origem dessas frases: corpus de treino do Whisper inclui muito subtítulo de YouTube; em silêncio prolongado o decoder regride para essas âncoras.
2. **`collapseHallucinationCycles`** — colapsa ciclos repetidos (A A A → A; A B C A B C → A B C).
3. **`collapseNearDuplicateLongSegments`** — remove resíduos por similaridade Jaccard de palavras (mantém respostas curtas legítimas como "Sim"/"Não").

No motor `whisper` (whisper.cpp) também é passada a flag `--suppress-nst` que suprime tokens não-fala já no decoder, reduzindo a geração de hallucinations cobertas pelo filtro acima.

## Notas operacionais do motor `legal-whisper`

- O subprocess Python carrega `whisper-large-v3` (~3GB) a cada transcrição (cold start). Cache do Hugging Face é controlado por `HF_HOME`.
- **CPU é apenas para desenvolvimento**: em fp32 consome ~6GB de RAM e processa em 3–5× tempo real. Para produção, use GPU CUDA — o script seleciona `torch.float16` automaticamente quando `torch.cuda.is_available()`.
- Se rodar via venv (`.venv-transcription`), defina `TRANSCRIPTION_PYTHON` no `.env` apontando para o `python3` ABSOLUTO do venv. O Next.js não herda o venv do shell que iniciou o `npm run dev`; sem isso, `validateLocalTranscriptionRuntime` falha com `PYTHON_NOT_AVAILABLE`.
- Falhas do subprocess Python agora têm o `stderr` ecoado no log do servidor (prefixo `[legal-whisper]` / `[wav2vec2]` / `[whisper.cpp]`) — útil para diagnosticar OOM, modelo corrompido ou áudio inválido.

## Notas operacionais do termo de audiência (Maritaca AI)

- **Header de auth não-padrão**: a Maritaca usa `Authorization: Key <chave>` (não `Bearer`). Por isso a integração em [`src/lib/termo-audiencia/maritaca.ts`](src/lib/termo-audiencia/maritaca.ts) usa `fetch` direto, não SDK OpenAI.
- **Structured output**: a chamada usa `response_format: { type: "json_schema", json_schema: ... }` — schema completo em [`src/lib/termo-audiencia/schema.ts`](src/lib/termo-audiencia/schema.ts). Se trocar para um modelo Maritaca mais antigo (`sabia-3`), confirme suporte a structured output antes.
- **Prompt fiel à transcrição**: o system prompt em [`src/lib/termo-audiencia/prompt.ts`](src/lib/termo-audiencia/prompt.ts) instrui o modelo a NÃO inventar dispositivos legais nem fatos não mencionados. Mesmo assim, revisão humana antes do export é obrigatória — o `TermoEditor` (auto-save via `PATCH /termo`) existe para isso.
- **Custo aproximado**: ~R$ 0,07 por audiência (sabia-4, ~50k input + ~5k output). Cada `POST /termo` faz uma chamada à API; "Regerar" repete a cobrança.
- **Diarização alimenta o prompt**: cada segmento entra prefixado com `[JUIZ]`, `[PARTE]`, `[PROCURADOR]` ou `[DESCONHECIDO]`. Falas sem `role` cai em `[DESCONHECIDO]`. A qualidade da diarização ([`transcription-diarization.ts`](src/lib/transcription-diarization.ts)) impacta diretamente a qualidade do termo.

## Notas operacionais do motor `google`

- **Áudio sempre em modo `basic`**: independentemente de `TRANSCRIPTION_AUDIO_PREPROCESS`, o motor `google` força WAV mono 16 kHz sem filtros. Recomendação explícita da [doc Speech-to-Text v2 best-practices](https://cloud.google.com/speech-to-text/v2/docs/best-practices): "All noise reduction processing should be disabled… typically reduces recognition accuracy."
- **Phrase set com boost calibrado**: termos do processo (numero, partes, juiz, vara, classe, tipo de audiência) entram com `boost=18`; vocabulário jurídico base com `boost=10`. Range válido na API é `> 0` e `<= 20`. Definido em [phrase-set.ts](src/lib/transcription-local/google/phrase-set.ts).
- **Sem diarização nativa por default**: `chirp_2` em batchRecognize rejeita `diarizationConfig`. A diarização do projeto baseada em voice features (`diarizeSegmentsByRole`) continua rodando após a transcrição. Para diarização nativa, troque para `chirp_3`.
- **Transporte REST por default**: o cliente usa `fallback: true` (HTTP/JSON) em vez de gRPC. gRPC dentro de Next/Turbopack ocasionalmente devolve erros com trailer vazio (`code: undefined, details: undefined`).
- **Cleanup do GCS**: cada transcrição faz upload de `transcricoes/<uuid>.wav` no bucket e remove o blob no `finally`. Falha de delete é logada mas não bloqueia o resultado.

## Seed de desenvolvimento

Usuários criados pelo seed (senha **`senha123`**): `servidor1`, `servidor2`, `juiz1` (todos na mesma vara de exemplo). Use apenas em ambiente de desenvolvimento.

## Documentação cruzada

- [`CLAUDE.md`](CLAUDE.md) aponta para este arquivo como referência principal para agentes.
