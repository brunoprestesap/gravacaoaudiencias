#!/usr/bin/env python3
"""
Pré-segmentação por VAD usando o pacote `silero-vad` (modelo ONNX/PyTorch
~2 MB). Concatena os trechos de fala em um WAV reduzido e emite um JSON com
o mapeamento de offsets para reconstruir os timestamps originais a partir
da saída do Whisper/Wav2Vec2.

Entrada:  WAV mono PCM 16 kHz (mesma saída do FFmpeg em audio.ts).
Saídas:
  - <out_wav>: WAV concatenado contendo apenas trechos de fala.
  - <out_json>: { "segments": [{ "speech_start_ms": int, "speech_end_ms": int,
                                  "orig_start_ms": int, "orig_end_ms": int }] }
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import wave
from typing import Any

import numpy as np

SAMPLE_RATE = 16_000
DEFAULT_MIN_SPEECH_MS = 250
DEFAULT_MIN_SILENCE_MS = 500
DEFAULT_PADDING_MS = 80


def read_wav_mono_16k(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wf:
        if wf.getnchannels() != 1:
            raise ValueError("Esperado WAV mono.")
        if wf.getsampwidth() != 2:
            raise ValueError("Esperado PCM 16 bits.")
        if wf.getframerate() != SAMPLE_RATE:
            raise ValueError(f"Esperado taxa {SAMPLE_RATE} Hz, obtido {wf.getframerate()}.")
        frames = wf.readframes(wf.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def write_wav_mono_16k(path: str, audio: np.ndarray) -> None:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16).tobytes()
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)


def run_check() -> None:
    import torch  # noqa: F401
    from silero_vad import get_speech_timestamps, load_silero_vad  # noqa: F401


def detect_speech_segments(audio: np.ndarray) -> list[dict[str, int]]:
    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    model = load_silero_vad()
    tensor = torch.from_numpy(audio)

    min_speech_ms = int(os.environ.get("VAD_MIN_SPEECH_MS", DEFAULT_MIN_SPEECH_MS))
    min_silence_ms = int(os.environ.get("VAD_MIN_SILENCE_MS", DEFAULT_MIN_SILENCE_MS))
    padding_ms = int(os.environ.get("VAD_PADDING_MS", DEFAULT_PADDING_MS))

    raw_segments = get_speech_timestamps(
        tensor,
        model,
        sampling_rate=SAMPLE_RATE,
        min_speech_duration_ms=min_speech_ms,
        min_silence_duration_ms=min_silence_ms,
        speech_pad_ms=padding_ms,
        return_seconds=False,
    )
    return [{"start": int(seg["start"]), "end": int(seg["end"])} for seg in raw_segments]


def build_payload(
    audio: np.ndarray, segments: list[dict[str, int]]
) -> tuple[np.ndarray, list[dict[str, int]]]:
    if not segments:
        return audio, []

    chunks: list[np.ndarray] = []
    mapping: list[dict[str, int]] = []
    cursor_samples = 0

    for seg in segments:
        start = max(0, seg["start"])
        end = min(len(audio), seg["end"])
        if end <= start:
            continue
        slice_ = audio[start:end]
        chunks.append(slice_)

        speech_start_ms = cursor_samples * 1000 // SAMPLE_RATE
        cursor_samples += slice_.shape[0]
        speech_end_ms = cursor_samples * 1000 // SAMPLE_RATE

        mapping.append(
            {
                "speech_start_ms": int(speech_start_ms),
                "speech_end_ms": int(speech_end_ms),
                "orig_start_ms": int(start * 1000 // SAMPLE_RATE),
                "orig_end_ms": int(end * 1000 // SAMPLE_RATE),
            }
        )

    if not chunks:
        return audio, []

    return np.concatenate(chunks), mapping


def main() -> int:
    parser = argparse.ArgumentParser(description="Pré-segmentação VAD (Silero) → WAV+JSON")
    parser.add_argument("--check", action="store_true", help="Valida imports e encerra.")
    parser.add_argument("wav_in", nargs="?", help="WAV mono 16 kHz de entrada.")
    parser.add_argument("wav_out", nargs="?", help="WAV concatenado (somente fala).")
    parser.add_argument("json_out", nargs="?", help="JSON com mapping de offsets.")
    args = parser.parse_args()

    if args.check:
        try:
            run_check()
        except Exception as exc:  # noqa: BLE001
            print(str(exc), file=sys.stderr)
            return 1
        return 0

    if not (args.wav_in and args.wav_out and args.json_out):
        parser.error("Informe wav_in, wav_out e json_out (ou use --check).")

    try:
        audio = read_wav_mono_16k(args.wav_in)
        segments = detect_speech_segments(audio) if audio.size > 0 else []
        speech_audio, mapping = build_payload(audio, segments)

        # Se VAD não detectou nada, copia o áudio original e retorna mapping vazio
        # — o pipeline a jusante segue como se VAD estivesse desligado.
        if mapping:
            write_wav_mono_16k(args.wav_out, speech_audio)
        else:
            write_wav_mono_16k(args.wav_out, audio)

        payload: dict[str, Any] = {
            "segments": mapping,
            "original_duration_ms": int(audio.shape[0] * 1000 // SAMPLE_RATE) if audio.size else 0,
        }
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
