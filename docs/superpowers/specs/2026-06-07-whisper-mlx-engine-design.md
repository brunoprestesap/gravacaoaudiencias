# Design: Motor de Transcrição whisper-mlx

**Data:** 2026-06-07
**Status:** Aprovado

## Contexto

O projeto suporta múltiplos motores de transcrição plugáveis selecionados por `LOCAL_TRANSCRIPTION_ENGINE`. O motor `google` (Chirp 2 via GCS) exige conta de serviço, bucket GCS e conectividade externa. O objetivo é adicionar um motor local `whisper-mlx` baseado no pacote Python `mlx-whisper`, otimizado para Apple Silicon via MLX framework, sem dependências de rede externas.

## Arquitetura

Segue o padrão dos motores `wav2vec2` e `legal-whisper`: subprocess Python invocado pelo servidor Next.js, sem servidor intermediário.

### Arquivos novos

| Arquivo | Responsabilidade |
|---|---|
| `scripts/transcribe_whisper_mlx.py` | Script Python: aceita `--check` ou `<wav_path> <json_out>`. Usa `mlx_whisper.transcribe()`. Emite JSON `{ text, segments }`. |
| `src/lib/transcription-local/whisper-mlx.ts` | Módulo TS: `getWhisperMlxConfig()`, `runWhisperMlxPython()`, `parseWhisperMlxOutput()`, `segmentsFromWhisperMlxPayload()`. |
| `src/lib/transcription-local/whisper-mlx.test.ts` | Testes unitários de parse e conversão de segmentos. |

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `src/lib/transcription-local/engine.ts` | Adiciona `"whisper-mlx"` ao union type e ao `getLocalTranscriptionEngine()`. |
| `src/lib/transcription-local/transcribe.ts` | Nova função `transcribeNormalizedWavWithWhisperMlx()` e branch em `dispatchEngine()`. |
| `src/lib/transcription-local/validate-runtime.ts` | Branch de validação para `"whisper-mlx"`: checa existência do script e executa `--check`. |
| `AGENTS.md` | Nova linha na tabela de variáveis de ambiente. |

`errors.ts` não recebe código novo — reutiliza `PYTHON_NOT_AVAILABLE` e `CONFIG_MISSING`, alinhando com o padrão dos outros motores locais.

## Fluxo de dados

```
inputVideoPath
  → findTranscriptionAudioSibling() | próprio MP4
  → normalizeAudio()                        → audio.wav (WAV mono 16 kHz)
  → [VAD opcional, TRANSCRIPTION_USE_VAD=1] → audio-speech.wav
  → transcribeNormalizedWavWithWhisperMlx(wavPath, tempDir)
      → runWhisperMlxPython(wavPath, jsonOutPath)   [subprocess Python]
      → parseWhisperMlxOutput(raw JSON)
      → segmentsFromWhisperMlxPayload(payload)      → TranscriptSegment[]
  → filterWhisperHallucinations()           [aplica-se: mesmo corpus OpenAI]
  → collapseHallucinationCycles()
  → collapseNearDuplicateLongSegments()
  → extractSegmentVoiceFeatures()
  → harmonizeRolesByUpstreamSpeaker()
  → TranscribeLocalRecordingResult
```

## Saída do script Python

```json
{
  "text": "transcrição completa",
  "segments": [
    { "text": "Iniciamos a audiência.", "start": 0.0, "end": 3.2 },
    { "text": "O réu está presente.", "start": 3.2, "end": 6.1 }
  ]
}
```

`segmentsFromWhisperMlxPayload()` converte `start`/`end` (segundos float) para `startMs`/`endMs`/`offsetMs` (ms inteiro). Se `segments` estiver ausente ou vazio, aplica `createBatchSegmentsFromText(text)` como fallback.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `LOCAL_TRANSCRIPTION_ENGINE` | `whisper` | Definir `whisper-mlx` para ativar este motor. |
| `WHISPER_MLX_MODEL_ID` | `mlx-community/whisper-large-v3-mlx` | ID do modelo no Hugging Face MLX Community. |
| `TRANSCRIPTION_PYTHON` | `python3` | Reaproveitada — mesmo intérprete dos outros motores Python. |

Aliases aceitos em `getLocalTranscriptionEngine()`: `"whisper-mlx"`, `"whispermlx"`, `"whisper_mlx"`.

## Validação de runtime

```
validateLocalTranscriptionRuntime() → engine === "whisper-mlx"
  1. ffmpeg --version                       (FFMPEG_NOT_AVAILABLE)
  2. access(scriptPath)                     (CONFIG_MISSING)
  3. python3 script.py --check              (PYTHON_NOT_AVAILABLE se mlx_whisper não instalado)
  4. validateVadRuntime()                   (se TRANSCRIPTION_USE_VAD=1)
```

O `--check` faz apenas `import mlx_whisper` sem baixar modelo (análogo ao `legal-whisper`).

## Testes unitários

`whisper-mlx.test.ts` cobre:
- `parseWhisperMlxOutput()` com payload completo → `text` e `segments` corretos
- `parseWhisperMlxOutput()` com `segments` ausentes → fallback para `createBatchSegmentsFromText`
- `segmentsFromWhisperMlxPayload()` → conversão segundos → ms correta (× 1000)
- Payload com `segments: []` → fallback ativado

Não há testes e2e específicos por motor — a seleção é feita por env var e a suite e2e existente não testa motores individualmente.

## Dependências Python

Nova entrada em `requirements-transcription.txt`:
```
mlx-whisper>=0.4.0
```

Requer Apple Silicon (M1+). Em hardware não-MLX o `import mlx_whisper` falha no `--check` e o servidor loga `PYTHON_NOT_AVAILABLE` com instrução clara.
