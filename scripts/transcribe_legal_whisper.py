#!/usr/bin/env python3
"""
Transcrição offline com Whisper-large-v3 + adapter PEFT especializado em
audiências judiciais em português.

Modelo base: openai/whisper-large-v3
Adapter:     rhaymison/transcription-portuguese-legal-whisper-peft
             https://huggingface.co/rhaymison/transcription-portuguese-legal-whisper-peft

Entrada: WAV mono PCM 16 kHz (mesmo formato gerado pelo FFmpeg do projeto).
Saída: JSON com texto completo e segmentos por janela temporal (mesmo schema
do transcribe_wav2vec2.py).
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

DEFAULT_BASE_MODEL_ID = "openai/whisper-large-v3"
DEFAULT_PEFT_MODEL_ID = "rhaymison/transcription-portuguese-legal-whisper-peft"
SAMPLE_RATE = 16_000
CHUNK_LENGTH_S = 30
# Idioma fixado: o adapter PEFT foi treinado exclusivamente em audiências
# judiciais em PT-BR. Mudar este valor não amplia o domínio do modelo.
LANGUAGE = "portuguese"


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


def run_check() -> None:
    import torch  # noqa: F401
    from transformers import (  # noqa: F401
        AutoModelForSpeechSeq2Seq,
        AutoProcessor,
        pipeline,
    )
    from peft import PeftModel  # noqa: F401

    if os.environ.get("LEGAL_WHISPER_QUANT", "8bit").lower() == "8bit" and torch.cuda.is_available():
        from transformers import BitsAndBytesConfig  # noqa: F401


def _timestamp_to_ms(value: Any) -> int | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return int(round(float(value) * 1000))
    return None


def _resolve_attn_implementation() -> str:
    return os.environ.get("LEGAL_WHISPER_ATTN_IMPL", "sdpa")


def _build_quantization_config(use_cuda: bool):
    if not use_cuda:
        return None
    if os.environ.get("LEGAL_WHISPER_QUANT", "8bit").lower() != "8bit":
        return None
    try:
        from transformers import BitsAndBytesConfig
    except ImportError:
        return None
    return BitsAndBytesConfig(load_in_8bit=True)


def _resolve_initial_prompt() -> str:
    return os.environ.get(
        "LEGAL_WHISPER_INITIAL_PROMPT",
        "Audiência judicial. Magistrado, defesa, acusação, testemunha, depoimento.",
    ).strip()


def transcribe_to_payload(wav_path: str, base_id: str, peft_id: str) -> dict[str, Any]:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

    audio = read_wav_mono_16k(wav_path)
    if audio.size == 0:
        return {"text": "", "segments": []}

    use_cuda = torch.cuda.is_available()
    device = "cuda" if use_cuda else "cpu"
    torch_dtype = torch.float16 if use_cuda else torch.float32
    batch_size = 16 if use_cuda else 2
    quant_cfg = _build_quantization_config(use_cuda)
    attn_impl = _resolve_attn_implementation()

    load_kwargs: dict[str, Any] = {
        "low_cpu_mem_usage": True,
        "use_safetensors": True,
        "attn_implementation": attn_impl,
    }
    if quant_cfg is not None:
        load_kwargs["quantization_config"] = quant_cfg
    else:
        load_kwargs["torch_dtype"] = torch_dtype

    try:
        base_model = AutoModelForSpeechSeq2Seq.from_pretrained(base_id, **load_kwargs)
    except (ValueError, TypeError):
        # Fallback: ambiente não suporta sdpa ou flag desconhecida pelo modelo.
        load_kwargs.pop("attn_implementation", None)
        base_model = AutoModelForSpeechSeq2Seq.from_pretrained(base_id, **load_kwargs)

    model = PeftModel.from_pretrained(base_model, peft_id)
    if quant_cfg is None:
        model.to(device)
    model.eval()

    processor = AutoProcessor.from_pretrained(base_id)

    asr = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        chunk_length_s=CHUNK_LENGTH_S,
        batch_size=batch_size,
        max_new_tokens=128,
        return_timestamps="word",
        torch_dtype=torch_dtype,
        device=device,
    )

    initial_prompt = _resolve_initial_prompt()
    prompt_ids = None
    if initial_prompt:
        try:
            prompt_ids = processor.get_prompt_ids(initial_prompt, return_tensors="pt").to(device)
        except Exception:  # noqa: BLE001 — prompt_ids é opcional
            prompt_ids = None

    # Guards contra hallucination loop do whisper-large-v3:
    #   condition_on_prev_tokens=False: não usa o texto anterior como contexto
    #     (a principal fonte de loops em silêncios prolongados).
    #   compression_ratio_threshold=1.35: descarta janelas com texto muito
    #     comprimido (sintoma de repetição).
    #   logprob_threshold=-1.0 / no_speech_threshold=0.6: filtros padrão
    #     da OpenAI Whisper para rejeitar tokens de baixa confiança.
    #   temperature fallback: cascateia decoding em janelas problemáticas.
    #   repetition_penalty=1.1: reduz loops residuais não pegos pelos filtros.
    generate_kwargs: dict[str, Any] = {
        "language": LANGUAGE,
        "task": "transcribe",
        "condition_on_prev_tokens": False,
        "compression_ratio_threshold": 1.35,
        "logprob_threshold": -1.0,
        "no_speech_threshold": 0.6,
        "temperature": (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
        "repetition_penalty": 1.1,
    }
    if prompt_ids is not None:
        generate_kwargs["prompt_ids"] = prompt_ids

    result = asr(
        {"array": audio, "sampling_rate": SAMPLE_RATE},
        generate_kwargs=generate_kwargs,
    )

    full_text = (result.get("text") or "").strip()
    audio_duration_ms = int(math.ceil(len(audio) * 1000 / SAMPLE_RATE))

    return {
        "text": full_text,
        "segments": _aggregate_words_to_segments(result.get("chunks") or [], audio_duration_ms),
    }


# Agrega palavras (return_timestamps="word") em segmentos coerentes para que
# transcription-diarization e voice-features não sejam executados por palavra.
SEGMENT_MAX_DURATION_MS = 15_000  # quebra dura aos 15 s
SEGMENT_GAP_MS = 600              # quebra suave em pausa > 600 ms


def _aggregate_words_to_segments(
    chunks: list[dict[str, Any]],
    audio_duration_ms: int,
) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
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
        end_ms = cur_end_ms if cur_end_ms is not None and cur_end_ms > cur_start_ms else min(
            cur_start_ms + SEGMENT_MAX_DURATION_MS, audio_duration_ms
        )
        segments.append(
            {
                "text": text,
                "startMs": cur_start_ms,
                "endMs": end_ms,
                "offsetMs": cur_start_ms,
            }
        )
        fallback_start_ms = end_ms
        cur_words, cur_start_ms, cur_end_ms = [], None, None

    for chunk in chunks:
        text = (chunk.get("text") or "").strip()
        if not text:
            continue

        ts = chunk.get("timestamp") or (None, None)
        start_raw = ts[0] if isinstance(ts, (list, tuple)) and len(ts) > 0 else None
        end_raw = ts[1] if isinstance(ts, (list, tuple)) and len(ts) > 1 else None
        start_ms = _timestamp_to_ms(start_raw)
        end_ms = _timestamp_to_ms(end_raw)

        if start_ms is None:
            start_ms = cur_end_ms if cur_end_ms is not None else fallback_start_ms
        if end_ms is None or end_ms <= start_ms:
            end_ms = start_ms + 200  # fallback grosseiro: 200 ms por palavra

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


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcrição Whisper PEFT (jurídico) → JSON")
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

    base_id = os.environ.get("LEGAL_WHISPER_BASE_MODEL_ID", DEFAULT_BASE_MODEL_ID)
    peft_id = os.environ.get("LEGAL_WHISPER_MODEL_ID", DEFAULT_PEFT_MODEL_ID)

    try:
        payload = transcribe_to_payload(args.wav_path, base_id, peft_id)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
