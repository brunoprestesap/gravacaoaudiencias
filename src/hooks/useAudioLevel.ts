"use client";

import { useRef, useEffect } from "react";
import { AUDIO_LEVEL } from "@/lib/constants";

/**
 * Analisa o nível de energia de áudio de um MediaStream em tempo real via rAF.
 * Retorna uma ref com o nível normalizado [0, 1] para uso direto em animações,
 * sem causar re-renders no componente pai.
 */
export function useAudioLevel(
  stream: MediaStream | null,
  active: boolean
): React.MutableRefObject<number> {
  const levelRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataRef = useRef<Float32Array | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const teardown = () => {
      cancelled = true;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
      try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      dataRef.current = null;
      levelRef.current = 0;
    };

    if (!active || !stream) {
      teardown();
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      levelRef.current = 0;
      return;
    }

    const setup = () => {
      if (cancelled) return;
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = AUDIO_LEVEL.FFT_SIZE;
        analyser.smoothingTimeConstant = AUDIO_LEVEL.SMOOTHING;

        const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
        source.connect(analyser);

        if (cancelled) {
          try { source.disconnect(); } catch { /* ignore */ }
          void ctx.close();
          return;
        }

        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        sourceRef.current = source;
        dataRef.current = new Float32Array(AUDIO_LEVEL.FFT_SIZE);

        const tick = () => {
          if (cancelled || !analyserRef.current || !dataRef.current) return;

          analyserRef.current.getFloatTimeDomainData(dataRef.current);

          let sumSq = 0;
          const len = dataRef.current.length;
          for (let i = 0; i < len; i++) {
            sumSq += dataRef.current[i] * dataRef.current[i];
          }
          const rms = Math.sqrt(sumSq / len);
          levelRef.current = Math.min(1, rms / AUDIO_LEVEL.RMS_SCALE);

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch {
        levelRef.current = 0;
      }
    };

    setup();

    return teardown;
  }, [active, stream]);

  return levelRef;
}
