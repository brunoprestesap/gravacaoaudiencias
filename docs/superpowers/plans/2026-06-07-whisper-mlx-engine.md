# Whisper-MLX Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o motor `whisper-mlx` ao sistema de transcrição, usando `mlx-whisper` como subprocess Python (padrão idêntico ao `wav2vec2` e `legal-whisper`).

**Architecture:** Um script Python `scripts/transcribe_whisper_mlx.py` é invocado como subprocess pelo servidor Next.js. Ele usa `mlx_whisper.transcribe()` e emite JSON com `text` + `segments[]{text, start, end}`. Um módulo TypeScript `whisper-mlx.ts` encapsula a execução e o parse. O motor é selecionado via `LOCAL_TRANSCRIPTION_ENGINE=whisper-mlx` e plugado nos mesmos pontos que os outros motores locais (`engine.ts`, `transcribe.ts`, `validate-runtime.ts`).

**Tech Stack:** Python `mlx-whisper>=0.4.0` (Apple Silicon / MLX), TypeScript, Vitest, padrões existentes do projeto.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/lib/transcription-local/constants.ts` | Modificar | Adicionar `DEFAULT_WHISPER_MLX_MODEL_ID` |
| `src/lib/transcription-local/engine.ts` | Modificar | Adicionar `"whisper-mlx"` ao union type e ao getter |
| `src/lib/transcription-local/whisper-mlx.ts` | Criar | `getWhisperMlxConfig`, `getWhisperMlxScriptPath`, `runWhisperMlxPython`, `parseWhisperMlxOutput`, `segmentsFromWhisperMlxPayload` |
| `src/lib/transcription-local/whisper-mlx.test.ts` | Criar | Testes unitários de parse e conversão de segmentos |
| `src/lib/transcription-local/transcribe.ts` | Modificar | `transcribeNormalizedWavWithWhisperMlx` + branch em `dispatchEngine` |
| `src/lib/transcription-local/validate-runtime.ts` | Modificar | Branch de validação para `"whisper-mlx"` |
| `scripts/transcribe_whisper_mlx.py` | Criar | Script Python: `--check` + transcrição → JSON |
| `requirements-transcription.txt` | Modificar | Adicionar `mlx-whisper>=0.4.0` |
| `AGENTS.md` | Modificar | Documentar `WHISPER_MLX_MODEL_ID` e o motor na tabela |

---

## Task 1: Constante e tipo do motor

**Files:**
- Modify: `src/lib/transcription-local/constants.ts`
- Modify: `src/lib/transcription-local/engine.ts`

- [ ] **Step 1: Adicionar constante em `constants.ts`**

Abra `src/lib/transcription-local/constants.ts` e adicione ao final:

```typescript
export const DEFAULT_WHISPER_MLX_MODEL_ID = "mlx-community/whisper-large-v3-mlx";
```

- [ ] **Step 2: Adicionar `"whisper-mlx"` ao tipo e getter em `engine.ts`**

O arquivo atual:
```typescript
export type LocalTranscriptionEngine =
  | "whisper"
  | "wav2vec2"
  | "legal-whisper"
  | "google"
  | "mock";

export function getLocalTranscriptionEngine(): LocalTranscriptionEngine {
  const raw = (process.env.LOCAL_TRANSCRIPTION_ENGINE ?? "whisper").trim().toLowerCase();
  if (raw === "wav2vec2" || raw === "wav2vec") {
    return "wav2vec2";
  }
  if (raw === "legal-whisper" || raw === "legalwhisper" || raw === "legal_whisper") {
    return "legal-whisper";
  }
  if (raw === "google" || raw === "gcp" || raw === "chirp" || raw === "chirp_2") {
    return "google";
  }
  if (raw === "mock") {
    return "mock";
  }
  return "whisper";
}
```

Substitua pelo conteúdo abaixo:
```typescript
export type LocalTranscriptionEngine =
  | "whisper"
  | "wav2vec2"
  | "legal-whisper"
  | "google"
  | "whisper-mlx"
  | "mock";

export function getLocalTranscriptionEngine(): LocalTranscriptionEngine {
  const raw = (process.env.LOCAL_TRANSCRIPTION_ENGINE ?? "whisper").trim().toLowerCase();
  if (raw === "wav2vec2" || raw === "wav2vec") {
    return "wav2vec2";
  }
  if (raw === "legal-whisper" || raw === "legalwhisper" || raw === "legal_whisper") {
    return "legal-whisper";
  }
  if (raw === "google" || raw === "gcp" || raw === "chirp" || raw === "chirp_2") {
    return "google";
  }
  if (raw === "whisper-mlx" || raw === "whispermlx" || raw === "whisper_mlx") {
    return "whisper-mlx";
  }
  if (raw === "mock") {
    return "mock";
  }
  return "whisper";
}
```

- [ ] **Step 3: Verificar type-check**

```bash
npm run type-check
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/transcription-local/constants.ts src/lib/transcription-local/engine.ts
git commit -m "feat(transcricao): adiciona tipo e constante do motor whisper-mlx"
```

---

## Task 2: Módulo TypeScript `whisper-mlx.ts` (TDD)

**Files:**
- Create: `src/lib/transcription-local/whisper-mlx.test.ts`
- Create: `src/lib/transcription-local/whisper-mlx.ts`

- [ ] **Step 1: Escrever testes antes de qualquer implementação**

Crie `src/lib/transcription-local/whisper-mlx.test.ts` com o conteúdo:

```typescript
import { describe, expect, it } from "vitest";
import {
  parseWhisperMlxOutput,
  segmentsFromWhisperMlxPayload,
} from "./whisper-mlx";

describe("parseWhisperMlxOutput", () => {
  it("parseia JSON válido com text e segments", () => {
    const raw = JSON.stringify({
      text: "Boa tarde Excelência.",
      segments: [{ text: "Boa tarde Excelência.", start: 0.0, end: 3.5 }],
    });
    const result = parseWhisperMlxOutput(raw);
    expect(result.text).toBe("Boa tarde Excelência.");
    expect(result.segments).toHaveLength(1);
  });

  it("parseia JSON sem segments (campo ausente)", () => {
    const raw = JSON.stringify({ text: "Texto simples." });
    const result = parseWhisperMlxOutput(raw);
    expect(result.text).toBe("Texto simples.");
    expect(result.segments).toBeUndefined();
  });

  it("lança TRANSCRIPTION_FAILED em JSON inválido", () => {
    expect(() => parseWhisperMlxOutput("não é json")).toThrow();
  });
});

describe("segmentsFromWhisperMlxPayload", () => {
  it("converte start/end de segundos para ms", () => {
    const payload = {
      text: "Olá mundo.",
      segments: [
        { text: "Olá", start: 0.0, end: 1.5 },
        { text: "mundo.", start: 1.5, end: 3.2 },
      ],
    };
    const segments = segmentsFromWhisperMlxPayload(payload);
    expect(segments).not.toBeNull();
    expect(segments![0].startMs).toBe(0);
    expect(segments![0].endMs).toBe(1500);
    expect(segments![1].startMs).toBe(1500);
    expect(segments![1].endMs).toBe(3200);
  });

  it("retorna null quando segments está ausente", () => {
    const result = segmentsFromWhisperMlxPayload({ text: "algo" });
    expect(result).toBeNull();
  });

  it("retorna null quando segments é array vazio", () => {
    const result = segmentsFromWhisperMlxPayload({ text: "algo", segments: [] });
    expect(result).toBeNull();
  });

  it("pula segmentos com texto vazio", () => {
    const payload = {
      text: "válido",
      segments: [
        { text: "", start: 0, end: 1 },
        { text: "válido", start: 1, end: 2 },
      ],
    };
    const segments = segmentsFromWhisperMlxPayload(payload);
    expect(segments).toHaveLength(1);
    expect(segments![0].text).toBe("válido");
  });

  it("seta offsetMs igual a startMs", () => {
    const payload = {
      text: "teste",
      segments: [{ text: "teste", start: 2.0, end: 4.0 }],
    };
    const segments = segmentsFromWhisperMlxPayload(payload);
    expect(segments![0].offsetMs).toBe(2000);
    expect(segments![0].startMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Rodar os testes e verificar que falham**

```bash
npx vitest run src/lib/transcription-local/whisper-mlx.test.ts
```

Esperado: FAIL com `Cannot find module './whisper-mlx'`.

- [ ] **Step 3: Criar `whisper-mlx.ts` com a implementação**

Crie `src/lib/transcription-local/whisper-mlx.ts`:

```typescript
import path from "path";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import { DEFAULT_WHISPER_MLX_MODEL_ID, WHISPER_MAX_BUFFER } from "./constants";
import { LocalTranscriptionError } from "./errors";
import { execFileAsyncWithEnv, logSubprocessFailure } from "./exec";
import { getTranscriptionPython } from "./wav2vec";

export interface WhisperMlxJsonSegment {
  text?: string;
  start?: number;
  end?: number;
}

export interface WhisperMlxJsonPayload {
  text?: string;
  segments?: WhisperMlxJsonSegment[];
}

export function getWhisperMlxScriptPath(): string {
  const fromEnv = process.env.TRANSCRIPTION_WHISPER_MLX_SCRIPT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "scripts", "transcribe_whisper_mlx.py");
}

export function getWhisperMlxModelId(): string {
  return (
    process.env.WHISPER_MLX_MODEL_ID?.trim() || DEFAULT_WHISPER_MLX_MODEL_ID
  );
}

function randomSegmentId(index: number) {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

export function segmentsFromWhisperMlxPayload(
  payload: WhisperMlxJsonPayload
): TranscriptSegment[] | null {
  const list = payload.segments;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const out: TranscriptSegment[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;

    const startMs =
      typeof item.start === "number" ? Math.round(item.start * 1000) : i * 5000;
    const endMs =
      typeof item.end === "number" ? Math.round(item.end * 1000) : startMs + 4500;

    out.push({
      id: randomSegmentId(i),
      text,
      offsetMs: startMs,
      createdAt,
      startMs,
      endMs,
    });
  }

  return out.length > 0 ? out : null;
}

export function parseWhisperMlxOutput(raw: string): WhisperMlxJsonPayload {
  try {
    return JSON.parse(raw) as WhisperMlxJsonPayload;
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Saída inválida do motor whisper-mlx (JSON)."
    );
  }
}

export async function runWhisperMlxPython(wavPath: string, jsonOutPath: string) {
  const pythonBin = getTranscriptionPython();
  const scriptPath = getWhisperMlxScriptPath();

  const env = { ...process.env };
  if (!env.WHISPER_MLX_MODEL_ID?.trim()) {
    env.WHISPER_MLX_MODEL_ID = DEFAULT_WHISPER_MLX_MODEL_ID;
  }

  try {
    await execFileAsyncWithEnv(pythonBin, [scriptPath, wavPath, jsonOutPath], {
      maxBuffer: WHISPER_MAX_BUFFER,
      env,
    });
  } catch (err) {
    logSubprocessFailure("whisper-mlx", err);
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao executar a transcrição whisper-mlx (Python)."
    );
  }
}
```

- [ ] **Step 4: Rodar os testes e verificar que passam**

```bash
npx vitest run src/lib/transcription-local/whisper-mlx.test.ts
```

Esperado: todos os testes PASS.

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/transcription-local/whisper-mlx.ts src/lib/transcription-local/whisper-mlx.test.ts
git commit -m "feat(transcricao): módulo TypeScript do motor whisper-mlx com testes"
```

---

## Task 3: Script Python `transcribe_whisper_mlx.py`

**Files:**
- Create: `scripts/transcribe_whisper_mlx.py`

- [ ] **Step 1: Criar o script Python**

Crie `scripts/transcribe_whisper_mlx.py`:

```python
#!/usr/bin/env python3
"""
Transcrição offline com mlx-whisper (Apple Silicon / MLX framework).

Modelo padrão: mlx-community/whisper-large-v3-mlx
Configurável via WHISPER_MLX_MODEL_ID.

Entrada: WAV mono PCM 16 kHz (gerado pelo FFmpeg do projeto).
Saída: JSON { text, segments: [{text, start, end}] }
       start/end em segundos (float).
"""

from __future__ import annotations

import argparse
import json
import os
import sys


DEFAULT_MODEL_ID = "mlx-community/whisper-large-v3-mlx"
LANGUAGE = "pt"


def run_check() -> None:
    import mlx_whisper  # noqa: F401


def transcribe_to_payload(wav_path: str, model_id: str) -> dict:
    import mlx_whisper

    result = mlx_whisper.transcribe(
        wav_path,
        path_or_hf_repo=model_id,
        language=LANGUAGE,
        word_timestamps=False,
        condition_on_previous_text=False,
        compression_ratio_threshold=1.35,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
    )

    full_text = (result.get("text") or "").strip()
    raw_segments = result.get("segments") or []

    segments = []
    for seg in raw_segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        segments.append(
            {
                "text": text,
                "start": float(seg.get("start") or 0),
                "end": float(seg.get("end") or 0),
            }
        )

    return {"text": full_text, "segments": segments}


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcrição whisper-mlx → JSON")
    parser.add_argument("--check", action="store_true", help="Valida imports e encerra.")
    parser.add_argument("wav_path", nargs="?", help="Caminho do WAV 16 kHz mono.")
    parser.add_argument("json_out", nargs="?", help="Caminho do arquivo JSON de saída.")
    args = parser.parse_args()

    if args.check:
        try:
            run_check()
        except Exception as exc:  # noqa: BLE001
            print(str(exc), file=sys.stderr)
            return 1
        return 0

    if not args.wav_path or not args.json_out:
        parser.error("Informe wav_path e json_out (ou use --check).")

    model_id = os.environ.get("WHISPER_MLX_MODEL_ID", DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID

    try:
        payload = transcribe_to_payload(args.wav_path, model_id)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Tornar o script executável**

```bash
chmod +x scripts/transcribe_whisper_mlx.py
```

- [ ] **Step 3: Commit**

```bash
git add scripts/transcribe_whisper_mlx.py
git commit -m "feat(transcricao): script Python whisper-mlx (mlx-whisper subprocess)"
```

---

## Task 4: Integrar o motor em `transcribe.ts` e `validate-runtime.ts`

**Files:**
- Modify: `src/lib/transcription-local/transcribe.ts`
- Modify: `src/lib/transcription-local/validate-runtime.ts`

- [ ] **Step 1: Adicionar import e função em `transcribe.ts`**

Abra `src/lib/transcription-local/transcribe.ts`. No bloco de imports, após a linha que importa `legal-whisper`, adicione:

```typescript
import {
  runWhisperMlxPython,
  segmentsFromWhisperMlxPayload,
  parseWhisperMlxOutput,
} from "./whisper-mlx";
```

Após a função `transcribeNormalizedWavWithLegalWhisper` (linha ~85), adicione a nova função:

```typescript
async function transcribeNormalizedWavWithWhisperMlx(
  normalizedWavPath: string,
  tempDir: string
): Promise<{ text: string; baseSegments: TranscriptSegment[] }> {
  const jsonOutPath = path.join(tempDir, "transcricao.json");
  await runWhisperMlxPython(normalizedWavPath, jsonOutPath);

  const raw = await readFile(jsonOutPath, "utf-8");
  const payload = parseWhisperMlxOutput(raw);
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const fromModel = segmentsFromWhisperMlxPayload(payload);
  return { text, baseSegments: fromModel ?? createBatchSegmentsFromText(text) };
}
```

- [ ] **Step 2: Adicionar branch em `dispatchEngine`**

Na função `dispatchEngine`, após o branch `if (engine === "legal-whisper")` e antes do `return transcribeNormalizedWavWithGoogle(...)`, adicione:

```typescript
  if (engine === "whisper-mlx") {
    return transcribeNormalizedWavWithWhisperMlx(asrInputWavPath, tempDir);
  }
```

- [ ] **Step 3: Adicionar branch de validação em `validate-runtime.ts`**

Abra `src/lib/transcription-local/validate-runtime.ts`. Adicione o import do novo módulo após os imports existentes:

```typescript
import { getWhisperMlxScriptPath } from "./whisper-mlx";
```

A estrutura atual da função `validateLocalTranscriptionRuntime` é:
1. checa FFmpeg
2. `if (engine === "mock") return`
3. `if (engine === "google") { await validateGoogleRuntime(); return; }`
4. `await validateVadRuntime()` ← chamada **uma única vez** para todos os motores locais
5. branches de `whisper` e `legal-whisper`, cada um retorna cedo
6. fallthrough para `wav2vec2`

Adicione o branch abaixo de `legal-whisper` (após `return;` do `legal-whisper`) e **antes** do bloco de `wav2vec2`, aproveitando que `validateVadRuntime()` já foi chamado:

```typescript
  if (engine === "whisper-mlx") {
    const scriptPath = getWhisperMlxScriptPath();
    try {
      await access(scriptPath);
    } catch {
      throw new LocalTranscriptionError(
        "CONFIG_MISSING",
        `Script whisper-mlx não encontrado: ${scriptPath}`
      );
    }

    const pythonBin = getTranscriptionPython();
    try {
      await execFileAsync(pythonBin, [scriptPath, "--check"]);
    } catch {
      throw new LocalTranscriptionError(
        "PYTHON_NOT_AVAILABLE",
        "mlx-whisper não está disponível para o Python configurado. " +
          "Instale com: pip install mlx-whisper (requer Apple Silicon)."
      );
    }
    return;
  }
```

- [ ] **Step 4: Verificar type-check e testes**

```bash
npm run type-check && npx vitest run src/lib/transcription-local/
```

Esperado: sem erros de tipo, todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcription-local/transcribe.ts src/lib/transcription-local/validate-runtime.ts
git commit -m "feat(transcricao): integra motor whisper-mlx no pipeline de transcrição"
```

---

## Task 5: Documentação e dependências

**Files:**
- Modify: `requirements-transcription.txt`
- Modify: `AGENTS.md`

- [ ] **Step 1: Adicionar `mlx-whisper` em `requirements-transcription.txt`**

Abra `requirements-transcription.txt` e adicione ao final:

```
# Motor whisper-mlx (Apple Silicon / MLX). Requer macOS com chip M1+.
# mlx-whisper baixa o modelo do Hugging Face na primeira execução (~1.5 GB para large-v3).
mlx-whisper>=0.4.0
```

- [ ] **Step 2: Atualizar `AGENTS.md`**

Na linha `| \`LOCAL_TRANSCRIPTION_ENGINE\` | ...`, atualize a descrição para incluir `whisper-mlx`:

Encontre:
```
| `LOCAL_TRANSCRIPTION_ENGINE` | Não | `whisper` (padrão), `wav2vec2`, `legal-whisper` ou `google` — motor da transcrição em lote. |
```

Substitua por:
```
| `LOCAL_TRANSCRIPTION_ENGINE` | Não | `whisper` (padrão), `wav2vec2`, `legal-whisper`, `google` ou `whisper-mlx` — motor da transcrição em lote. |
```

Após a linha de `TRANSCRIPTION_PYTHON`, adicione (antes da linha `TRANSCRIPTION_WAV2VEC_SCRIPT`):
```
| `WHISPER_MLX_MODEL_ID` | Não | ID do modelo HF MLX Community para o motor `whisper-mlx` (padrão: `mlx-community/whisper-large-v3-mlx`). |
| `TRANSCRIPTION_WHISPER_MLX_SCRIPT` | Não | Caminho do script Python whisper-mlx (padrão: `scripts/transcribe_whisper_mlx.py`). |
```

Nos **Requisitos de ambiente**, adicione após o item do Google:
```
- **Transcrição em lote (opcional whisper-mlx):** Python 3 com `pip install mlx-whisper` (requer Apple Silicon M1+). O modelo é baixado automaticamente do Hugging Face na primeira transcrição (~1.5 GB para o padrão `large-v3`). Defina `TRANSCRIPTION_PYTHON` se usar um venv isolado.
```

- [ ] **Step 3: Rodar suite de testes completa**

```bash
npm run test
```

Esperado: todos os testes PASS.

- [ ] **Step 4: Commit final**

```bash
git add requirements-transcription.txt AGENTS.md
git commit -m "docs(transcricao): documenta motor whisper-mlx em AGENTS.md e requirements"
```

---

## Verificação manual (opcional, requer mlx-whisper instalado)

Para testar end-to-end, com `mlx-whisper` instalado no Python configurado:

```bash
# Verificar que o --check passa
python3 scripts/transcribe_whisper_mlx.py --check

# Testar com um WAV real (substitua o caminho)
LOCAL_TRANSCRIPTION_ENGINE=whisper-mlx npm run dev
# Em seguida, disparar uma transcrição pela UI ou via API
```
