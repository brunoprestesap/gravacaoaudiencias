#!/usr/bin/env python3
"""
Transcrição offline com Wav2Vec2 (HF), alinhado ao cartão do modelo:
https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-portuguese

Entrada: WAV mono PCM 16 kHz (mesmo formato gerado pelo FFmpeg do projeto).
Saída: JSON com texto completo e segmentos por janela temporal.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import wave
from typing import Any

import numpy as np

DEFAULT_MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese"
SAMPLE_RATE = 16_000
CHUNK_SECONDS = 20.0
OVERLAP_SECONDS = 2.0


def read_wav_mono_16k(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wf:
        if wf.getnchannels() != 1:
            raise ValueError("Esperado WAV mono.")
        if wf.getsampwidth() != 2:
            raise ValueError("Esperado PCM 16 bits.")
        if wf.getframerate() != SAMPLE_RATE:
            raise ValueError(f"Esperado taxa {SAMPLE_RATE} Hz, obtido {wf.getframerate()}.")
        frames = wf.readframes(wf.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return audio


def run_check() -> None:
    import torch  # noqa: F401
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor  # noqa: F401


def _remove_overlap_prefix(previous: str, current: str) -> str:
    """Remove prefixo duplicado entre janelas adjacentes com overlap."""
    if not previous or not current:
        return current
    prev_words = previous.split()
    cur_words = current.split()
    if not prev_words or not cur_words:
        return current
    max_check = min(len(prev_words), len(cur_words), 8)
    best = 0
    for length in range(1, max_check + 1):
        suffix = prev_words[-length:]
        prefix = cur_words[:length]
        if [w.lower() for w in suffix] == [w.lower() for w in prefix]:
            best = length
    if best > 0:
        return " ".join(cur_words[best:])
    return current


def transcribe_to_payload(
    wav_path: str,
    model_id: str,
) -> dict[str, Any]:
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    audio = read_wav_mono_16k(wav_path)
    if audio.size == 0:
        return {"text": "", "segments": []}

    processor = Wav2Vec2Processor.from_pretrained(model_id)
    model = Wav2Vec2ForCTC.from_pretrained(model_id)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.eval()

    chunk_samples = int(CHUNK_SECONDS * SAMPLE_RATE)
    hop_samples = int((CHUNK_SECONDS - OVERLAP_SECONDS) * SAMPLE_RATE)
    hop_samples = max(hop_samples, 1)

    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    prev_piece = ""

    for start in range(0, len(audio), hop_samples):
        end = min(start + chunk_samples, len(audio))
        chunk = audio[start:end]
        if chunk.size < 1600 and start > 0:
            break

        inputs = processor(
            chunk,
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
            padding=True,
            do_normalize=True,
        )
        input_values = inputs.input_values.to(device)
        attention_mask = inputs.attention_mask.to(device) if inputs.attention_mask is not None else None

        with torch.no_grad():
            logits = model(input_values, attention_mask=attention_mask).logits

        pred_ids = torch.argmax(logits, dim=-1)
        decoded = processor.batch_decode(pred_ids)[0]
        piece = decoded.strip()
        if piece:
            deduped = _remove_overlap_prefix(prev_piece, piece)
            if deduped:
                text_parts.append(deduped)
                start_ms = int(math.floor(start * 1000 / SAMPLE_RATE))
                end_ms = int(math.ceil(end * 1000 / SAMPLE_RATE))
                segments.append(
                    {
                        "text": deduped,
                        "startMs": start_ms,
                        "endMs": end_ms,
                        "offsetMs": start_ms,
                    }
                )
            prev_piece = piece

        if end >= len(audio):
            break

    full_text = " ".join(text_parts).strip()
    return {"text": full_text, "segments": segments}


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcrição Wav2Vec2 → JSON")
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

    model_id = os.environ.get("HF_MODEL_ID", DEFAULT_MODEL_ID)

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
