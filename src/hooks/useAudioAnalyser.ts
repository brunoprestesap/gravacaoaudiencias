"use client";

import { useRef, useEffect } from "react";
import type { VoiceFeatures } from "@/lib/transcription-diarization";
import { AUDIO_ANALYSER } from "@/lib/constants";

/**
 * Analisa o áudio de um MediaStream em tempo real usando AudioContext + AnalyserNode.
 * Retorna as features de voz mais recentes via ref, para uso síncrono sem re-renders.
 */
export function useAudioAnalyser(
  stream: MediaStream | null,
  active: boolean
): React.MutableRefObject<VoiceFeatures | undefined> {
  const latestVoiceFeaturesRef = useRef<VoiceFeatures | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioMetricsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clearAudioTracking = () => {
      cancelled = true;

      if (audioMetricsTimerRef.current) {
        clearInterval(audioMetricsTimerRef.current);
        audioMetricsTimerRef.current = null;
      }
      try {
        mediaSourceRef.current?.disconnect();
      } catch {
        // ignore disconnect errors
      }
      mediaSourceRef.current = null;
      try {
        analyserRef.current?.disconnect();
      } catch {
        // ignore disconnect errors
      }
      analyserRef.current = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
      latestVoiceFeaturesRef.current = undefined;
    };

    if (!active || !stream) {
      clearAudioTracking();
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      latestVoiceFeaturesRef.current = undefined;
      return;
    }

    const setup = () => {
      if (cancelled) return;
      try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = AUDIO_ANALYSER.FFT_SIZE;
        analyser.smoothingTimeConstant = AUDIO_ANALYSER.SMOOTHING;

        const mediaSource = audioContext.createMediaStreamSource(
          new MediaStream([audioTrack])
        );
        mediaSource.connect(analyser);

        if (cancelled) {
          try { mediaSource.disconnect(); } catch { /* ignore */ }
          void audioContext.close();
          return;
        }

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        mediaSourceRef.current = mediaSource;

        const timeData = new Float32Array(AUDIO_ANALYSER.FFT_SIZE);

        let voicedSamples = 0;
        let totalSamples = 0;
        let speechBursts = 0;
        let inSpeech = false;
        const startedAt = Date.now();

        audioMetricsTimerRef.current = setInterval(() => {
          analyser.getFloatTimeDomainData(timeData);

          let sumSquares = 0;
          let zeroCrossings = 0;
          for (let i = 0; i < timeData.length; i += 1) {
            const value = timeData[i];
            sumSquares += value * value;
            if (
              i > 0 &&
              ((timeData[i - 1] <= 0 && value > 0) ||
                (timeData[i - 1] >= 0 && value < 0))
            ) {
              zeroCrossings += 1;
            }
          }

          const rms = Math.sqrt(sumSquares / timeData.length);
          const energyMeanDb = 20 * Math.log10(Math.max(1e-6, rms));
          const isVoiced = rms > AUDIO_ANALYSER.VOICE_THRESHOLD_RMS;
          totalSamples += 1;
          if (isVoiced) {
            voicedSamples += 1;
            if (!inSpeech) {
              speechBursts += 1;
              inSpeech = true;
            }
          } else {
            inSpeech = false;
          }

          const sampleRate = audioContext.sampleRate;
          const approxPitchHz = Math.max(
            50,
            Math.min(500, (zeroCrossings * sampleRate) / (2 * timeData.length))
          );
          const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
          const speechRateApprox = (speechBursts * 35) / (elapsedSeconds / 60);
          const pauseRatio = 1 - voicedSamples / Math.max(1, totalSamples);

          latestVoiceFeaturesRef.current = {
            pitchMeanHz: approxPitchHz,
            pitchStdHz: Math.max(0, approxPitchHz * 0.14),
            energyMeanDb,
            pauseRatio: Number(pauseRatio.toFixed(3)),
            speechRateApprox: Number(speechRateApprox.toFixed(1)),
          };
        }, AUDIO_ANALYSER.INTERVAL_MS);
      } catch {
        latestVoiceFeaturesRef.current = undefined;
      }
    };

    setup();

    return () => {
      clearAudioTracking();
    };
  }, [active, stream]);

  return latestVoiceFeaturesRef;
}
