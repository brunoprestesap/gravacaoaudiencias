# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Notas adicionais para Claude Code

### Comandos pontuais (além dos listados em AGENTS.md)

- `npx vitest run <caminho>` — roda um único arquivo; adicione `-t "<nome>"` para um teste específico.
- `npx vitest <caminho>` — modo watch sobre um arquivo.
- `npx playwright test e2e/smoke.spec.ts --headed` — depurar E2E com browser visível (o `webServer` do Playwright sobe `npm run dev` automaticamente).
- `npx prisma studio` — inspeção rápida do banco em desenvolvimento.

### Aliases e configuração

- Path alias `@/*` → `src/*` (definido em [tsconfig.json](tsconfig.json) e replicado em [vitest.config.ts](vitest.config.ts)). Use sempre `@/lib/...` em vez de caminhos relativos longos.
- Vitest roda em `environment: "node"` por padrão e exclui `e2e/` (esses ficam no Playwright). Testes co-localizados como `*.test.ts` em [src/lib](src/lib) e [src/hooks](src/hooks) são a fonte real — as pastas [tests/unit/](tests/unit/), [tests/integration/](tests/integration/) e [tests/e2e/](tests/e2e/) estão vazias.

### Arquitetura — pontos não óbvios que cruzam vários arquivos

- **Gravação no cliente**: [useMediaRecorder](src/hooks/useMediaRecorder.ts) emite chunks (~5s) que [useChunkStorage](src/hooks/useChunkStorage.ts) persiste no IndexedDB via `idb`. [useRecovery](src/hooks/useRecovery.ts) detecta gravações interrompidas no boot do dashboard e oferece retomada/finalização. No modo híbrido, [useHybridStream](src/hooks/useHybridStream.ts) compõe câmera + tela ([useScreenCapture](src/hooks/useScreenCapture.ts)).
- **Pipeline de upload server-side**: `POST /api/upload` grava o WebM em `UPLOAD_DIR`, chama [upload-ffmpeg.ts](src/lib/upload-ffmpeg.ts) que probe + remux MP4 (rápido) e, em caso de incompatibilidade de codec, transcodifica via FFmpeg (two-pass com fallback single-pass; preset adaptativo). Limite de saída controlado por `PJE_MAX_OUTPUT_SIZE_BYTES` em [upload-encoding.ts](src/lib/upload-encoding.ts). Após sucesso, o WebM é descartado e `Gravacao.caminhoArquivo`/`status` é atualizado.
- **Autorização compartilhada**: toda rota sob `/api/gravacoes/[id]/*` (stream, download, transcricao, PATCH/DELETE) passa por `assertGravacaoAccess` em [gravacao-access.ts](src/lib/gravacao-access.ts), com modos `read` e `write` (contextos `patch` | `delete` | `upload`). Mudanças em regras de acesso devem ir lá, não duplicadas em cada rota. O middleware [src/middleware.ts](src/middleware.ts) faz o gate de UI para `SERVIDOR` em `/gravacao/*` (exceto `/reproduzir`).
- **Transcrição em lote**: [transcription-local/engine.ts](src/lib/transcription-local/engine.ts) seleciona motor por `LOCAL_TRANSCRIPTION_ENGINE`. [audio.ts](src/lib/transcription-local/audio.ts) normaliza para WAV mono 16 kHz com FFmpeg antes de despachar para [whisper.ts](src/lib/transcription-local/whisper.ts) (whisper.cpp) ou [wav2vec.ts](src/lib/transcription-local/wav2vec.ts) (Python + HF via [scripts/transcribe_wav2vec2.py](scripts/transcribe_wav2vec2.py)). [validate-runtime.ts](src/lib/transcription-local/validate-runtime.ts) checa binários/modelos antes de rodar. Estado persistido em `Gravacao.transcricaoStatus` (`PENDENTE|PROCESSANDO|CONCLUIDA|ERRO`).
- **Modelo de dados** ([prisma/schema.prisma](prisma/schema.prisma)): `Gravacao.userId` identifica o servidor dono (regra de escrita); `Gravacao.vara` é a chave de acesso para `JUIZ` (regra de leitura). `User.role` ∈ {`SERVIDOR`, `JUIZ`}.

### CI

- Workflow ativo: [.github/workflows/test-engineer.yml](.github/workflows/test-engineer.yml).
