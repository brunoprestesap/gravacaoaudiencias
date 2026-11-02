"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RECORDING } from "@/lib/constants";
import type { RecordingStatus } from "@/types/recording";

interface UseMediaRecorderOptions {
  /** For presencial mode: device IDs to open via getUserMedia */
  cameraId?: string | null;
  microphoneId?: string | null;
  /** For hybrid mode: provide a pre-built stream (from combineStreams) */
  externalStream?: MediaStream | null;
  /**
   * Fontes reais de um stream composto. As trilhas do canvas e do AudioContext nunca
   * terminam, então a queda de um dispositivo só aparece nestas.
   */
  monitoredStreams?: MediaStream[];
  onChunk: (blob: Blob) => void;
  onError?: (error: string) => void;
  /**
   * "audio" ou "video": o gravador segue com o que restou (o Chromium continua gravando
   * sem a trilha perdida). "all": o gravador parou sozinho.
   */
  onDeviceLost?: (kind: DeviceLossKind) => void;
  /** Tempo gravado antes desta tela abrir (retomada depois de recarregar). */
  priorElapsedMs?: number;
}

export type DeviceLossKind = "audio" | "video" | "all";

interface MediaRecorderState {
  status: RecordingStatus;
  stream: MediaStream | null;
  elapsedMs: number;
}

export const useMediaRecorder = ({
  cameraId,
  microphoneId,
  externalStream,
  monitoredStreams,
  onChunk,
  onError,
  onDeviceLost,
  priorElapsedMs = 0,
}: UseMediaRecorderOptions) => {
  const [state, setState] = useState<MediaRecorderState>({
    status: "idle",
    stream: null,
    elapsedMs: 0,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0);
  const ownsStreamRef = useRef(false);
  const stopMonitoringRef = useRef<(() => void) | null>(null);

  const getCodec = () => {
    if (MediaRecorder.isTypeSupported(RECORDING.PREFERRED_CODEC)) {
      return RECORDING.PREFERRED_CODEC;
    }
    if (MediaRecorder.isTypeSupported(RECORDING.FALLBACK_CODEC)) {
      return RECORDING.FALLBACK_CODEC;
    }
    return "video/webm";
  };

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setState((s) => ({
        ...s,
        elapsedMs: pausedElapsedRef.current + (Date.now() - startTimeRef.current),
      }));
    }, 200);
  }, []);

  // Guarda o trecho em andamento. Sem timer ativo (pausa), ele já foi guardado.
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      pausedElapsedRef.current += Date.now() - startTimeRef.current;
      setState((s) => ({ ...s, elapsedMs: pausedElapsedRef.current }));
    }
  }, []);

  const start = useCallback(async () => {
    try {
      let stream: MediaStream;

      if (externalStream) {
        // Hybrid mode: use the combined stream provided externally
        stream = externalStream;
        ownsStreamRef.current = false;
      } else {
        // Presencial mode: open camera + mic via getUserMedia
        const constraints: MediaStreamConstraints = {
          video: cameraId
            ? {
                deviceId: { ideal: cameraId },
                width: { ideal: RECORDING.RECORD_WIDTH },
                height: { ideal: RECORDING.RECORD_HEIGHT },
                frameRate: { ideal: RECORDING.RECORD_FPS, max: RECORDING.RECORD_FPS },
              }
            : {
                width: { ideal: RECORDING.RECORD_WIDTH },
                height: { ideal: RECORDING.RECORD_HEIGHT },
                frameRate: { ideal: RECORDING.RECORD_FPS, max: RECORDING.RECORD_FPS },
              },
          // Constraints calibradas para ASR (Google Chirp 2):
          // - echoCancellation reduz reverberação de alto-falante de sala
          // - autoGainControl=false preserva dinâmica entre falantes (AGC ligado
          //   "achata" sussurros e infla pausas, induzindo o decoder a alucinar)
          // - noiseSuppression=false: Chirp prefere áudio sem NS agressivo
          // - channelCount=1 + sampleRate=48000 alinham com o downsample 16k do servidor
          audio: {
            ...(microphoneId ? { deviceId: { ideal: microphoneId } } : {}),
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
          },
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        ownsStreamRef.current = true;
      }

      streamRef.current = stream;

      const codec = getCodec();
      const recorder = new MediaRecorder(stream, {
        mimeType: codec,
        videoBitsPerSecond: RECORDING.VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: RECORDING.AUDIO_BITS_PER_SECOND,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          onChunk(e.data);
        }
      };

      recorder.onerror = () => {
        onError?.("Erro no MediaRecorder. Verifique os dispositivos.");
      };

      const handleTrackEnded = (event: Event) => {
        onDeviceLost?.((event.target as MediaStreamTrack).kind as "audio" | "video");
      };
      const monitoredTracks = new Set([
        ...stream.getTracks(),
        ...(monitoredStreams ?? []).flatMap((source) => source.getTracks()),
      ]);
      monitoredTracks.forEach((track) => track.addEventListener("ended", handleTrackEnded));
      stopMonitoringRef.current = () => {
        monitoredTracks.forEach((track) => track.removeEventListener("ended", handleTrackEnded));
        stopMonitoringRef.current = null;
      };

      // stop() troca este handler, então aqui o gravador parou sem ninguém pedir.
      recorder.onstop = () => {
        stopMonitoringRef.current?.();
        stopTimer();
        if (ownsStreamRef.current) {
          streamRef.current?.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = null;
        recorderRef.current = null;
        setState((s) => ({ ...s, status: "stopped", stream: null }));
        onDeviceLost?.("all");
      };

      recorder.start(RECORDING.CHUNK_INTERVAL_MS);
      // Não zera o tempo: um novo start é mais um trecho da mesma gravação.
      startTimer();

      setState((s) => ({ ...s, status: "recording", stream }));
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Permissão de câmera/microfone negada."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "Dispositivo de mídia não encontrado."
            : "Erro ao iniciar gravação.";
      onError?.(msg);
    }
  }, [
    cameraId,
    microphoneId,
    externalStream,
    monitoredStreams,
    onChunk,
    onError,
    onDeviceLost,
    startTimer,
    stopTimer,
  ]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      stopTimer();
      setState((s) => ({ ...s, status: "paused" }));
    }
  }, [stopTimer]);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      startTimer();
      setState((s) => ({ ...s, status: "recording" }));
    }
  }, [startTimer]);

  const stop = useCallback((): Promise<void> => {
    stopMonitoringRef.current?.();
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve();
        return;
      }

      recorder.onstop = () => {
        stopTimer();
        // Only stop tracks if we own the stream (presencial mode)
        if (ownsStreamRef.current) {
          streamRef.current?.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = null;
        recorderRef.current = null;
        setState((s) => ({ ...s, status: "stopped", stream: null }));
        resolve();
      };

      recorder.stop();
    });
  }, [stopTimer]);

  // Cleanup on unmount: garante que câmera/mic são liberados se o componente desmontar inesperadamente
  useEffect(() => {
    return () => {
      stopMonitoringRef.current?.();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      if (ownsStreamRef.current) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    ...state,
    elapsedMs: priorElapsedMs + state.elapsedMs,
    start,
    pause,
    resume,
    stop,
  };
};
