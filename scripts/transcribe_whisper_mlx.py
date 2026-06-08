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


def _resolve_initial_prompt() -> str:
    return os.environ.get(
        "WHISPER_MLX_INITIAL_PROMPT",
        "Audiência judicial. Magistrado, defesa, acusação, testemunha, depoimento.",
    ).strip()


def transcribe_to_payload(wav_path: str, model_id: str) -> dict:
    import mlx_whisper

    initial_prompt = _resolve_initial_prompt()

    # compression_ratio_threshold: mlx-whisper avalia por janela de 30s (não por
    # palavra como no HF pipeline). Português jurídico tem CR naturalmente alto
    # (termos repetitivos) — o default 2.4 é calibrado para esse nível de chunk.
    # Usar 1.35 (valor do legal-whisper/HF) faz quase todo chunk "falhar" e
    # disparar a cascata de temperaturas, degradando qualidade e triplicando o tempo.
    #
    # condition_on_previous_text=True: mantém contexto entre chunks (nomes de
    # partes, número do processo, termos estabelecidos). hallucination_silence_threshold
    # é o mecanismo correto do mlx-whisper para suprimir hallucinations em silêncios,
    # sem precisar cortar o contexto cross-chunk.
    result = mlx_whisper.transcribe(
        wav_path,
        path_or_hf_repo=model_id,
        language=LANGUAGE,
        word_timestamps=False,
        condition_on_previous_text=True,
        compression_ratio_threshold=2.4,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
        hallucination_silence_threshold=2.0,
        temperature=(0.0, 0.2, 0.4),
        initial_prompt=initial_prompt or None,
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
