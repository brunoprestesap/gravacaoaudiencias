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

# Agrega palavras em frases para que cada segmento isole um único locutor
# (≤15s) e permita que voice-features/diarization funcionem corretamente.
# Sem word_timestamps o mlx-whisper entrega chunks de 30s com múltiplos
# locutores misturados → pitch médio corrompido → tudo classificado como JUIZ.
SEGMENT_MAX_DURATION_MS = 15_000  # quebra dura aos 15 s
# 350 ms: audiências têm troca de locutor em 300-450 ms. 600 ms colapsava
# pergunta do juiz + resposta da testemunha no mesmo segmento → label errado.
SEGMENT_GAP_MS = 350              # quebra suave em pausa > 350 ms


def run_check() -> None:
    import mlx_whisper  # noqa: F401


def _resolve_initial_prompt() -> str:
    return os.environ.get(
        "WHISPER_MLX_INITIAL_PROMPT",
        "Audiência judicial. Magistrado, defesa, acusação, testemunha, depoimento.",
    ).strip()


def _aggregate_words_to_segments(
    all_words: list[dict],
    audio_duration_ms: int,
) -> list[dict]:
    """Agrega palavras (mlx-whisper word_timestamps) em frases de ≤15s."""
    segments: list[dict] = []
    cur_words: list[str] = []
    cur_start_ms: int | None = None
    cur_end_ms: int | None = None
    fallback_start_ms = 0

    def flush() -> None:
        nonlocal cur_words, cur_start_ms, cur_end_ms, fallback_start_ms
        if not cur_words or cur_start_ms is None:
            cur_words, cur_start_ms, cur_end_ms = [], None, None
            return
        text = " ".join(cur_words).strip()
        if not text:
            cur_words, cur_start_ms, cur_end_ms = [], None, None
            return
        end_ms = (
            cur_end_ms
            if cur_end_ms is not None and cur_end_ms > cur_start_ms
            else min(cur_start_ms + SEGMENT_MAX_DURATION_MS, audio_duration_ms)
        )
        segments.append({"text": text, "start": cur_start_ms / 1000.0, "end": end_ms / 1000.0})
        fallback_start_ms = end_ms
        cur_words, cur_start_ms, cur_end_ms = [], None, None

    for w in all_words:
        # mlx-whisper word format: {"word": str, "start": float, "end": float}
        text = (w.get("word") or "").strip()
        if not text:
            continue

        start_raw = w.get("start")
        end_raw = w.get("end")
        start_ms = int(round(float(start_raw) * 1000)) if isinstance(start_raw, (int, float)) else None
        end_ms = int(round(float(end_raw) * 1000)) if isinstance(end_raw, (int, float)) else None

        if start_ms is None:
            start_ms = cur_end_ms if cur_end_ms is not None else fallback_start_ms
        if end_ms is None or end_ms <= start_ms:
            end_ms = start_ms + 200

        if cur_start_ms is None:
            cur_start_ms = start_ms

        gap_ms = start_ms - (cur_end_ms if cur_end_ms is not None else start_ms)
        duration_ms = end_ms - cur_start_ms
        if cur_words and (gap_ms > SEGMENT_GAP_MS or duration_ms > SEGMENT_MAX_DURATION_MS):
            flush()
            cur_start_ms = start_ms

        cur_words.append(text)
        cur_end_ms = end_ms

    flush()
    return segments


def transcribe_to_payload(wav_path: str, model_id: str) -> dict:
    import math
    import wave
    import mlx_whisper

    initial_prompt = _resolve_initial_prompt()

    # word_timestamps=True: entrega timestamps por palavra, usados em
    # _aggregate_words_to_segments para criar frases de ≤15s que isolam
    # locutores individuais (necessário para diarização via voice-features).
    # Sem isso, chunks de 30s misturam JUIZ e PARTE → pitch médio corrompido.
    #
    # compression_ratio_threshold=2.4: default calibrado do mlx-whisper para
    # janelas de 30s. O valor 1.35 (do HF pipeline word-level) disparava a
    # cascata de temperaturas em quase todo chunk de português jurídico.
    #
    # condition_on_previous_text=True + hallucination_silence_threshold=2.0:
    # mantém contexto cross-chunk; silêncios são tratados pelo threshold nativo.
    result = mlx_whisper.transcribe(
        wav_path,
        path_or_hf_repo=model_id,
        language=LANGUAGE,
        word_timestamps=True,
        condition_on_previous_text=True,
        compression_ratio_threshold=2.4,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
        hallucination_silence_threshold=2.0,
        temperature=(0.0, 0.2, 0.4),
        initial_prompt=initial_prompt or None,
    )

    full_text = (result.get("text") or "").strip()

    # Extrai palavras de todos os chunks e agrega em frases de ≤15s.
    all_words: list[dict] = []
    for seg in result.get("segments") or []:
        all_words.extend(seg.get("words") or [])

    try:
        with wave.open(wav_path, "rb") as wf:
            audio_duration_ms = int(math.ceil(wf.getnframes() * 1000 / wf.getframerate()))
    except Exception:
        audio_duration_ms = 7_200_000  # fallback: 2h

    segments = _aggregate_words_to_segments(all_words, audio_duration_ms)

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
