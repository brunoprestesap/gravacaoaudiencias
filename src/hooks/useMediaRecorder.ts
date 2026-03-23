"use client";

import { useCallback, useRef, useState } from "react";
import { RECORDING } from "@/lib/constants";
import type { RecordingStatus } from "@/types/recording";

interface UseMediaRecorderOptions {
  /** For presencial mode: device IDs to open via getUserMedia */
  cameraId?: string | null;
  microphoneId?: string | null;
  /** For hybrid mode: provide a pre-built stream (from combineStreams) */
  externalStream?: MediaStream | null;
  onChunk: (blob: Blob) => void;
  onError?: (error: string) => void;
}

interface MediaRecorderState {
  status: RecordingStatus;
  stream: MediaStream | null;
  elapsedMs: number;
}

export const useMediaRecorder = ({
  cameraId,
  microphoneId,
  externalStream,
  onChunk,
  onError,
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

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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
            ? { deviceId: { ideal: cameraId }, width: { ideal: RECORDING.RECORD_WIDTH }, height: { ideal: RECORDING.RECORD_HEIGHT } }
            : { width: { ideal: RECORDING.RECORD_WIDTH }, height: { ideal: RECORDING.RECORD_HEIGHT } },
          audio: microphoneId
            ? { deviceId: { ideal: microphoneId } }
            : true,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        ownsStreamRef.current = true;
      }

      streamRef.current = stream;

      const codec = getCodec();
      const recorder = new MediaRecorder(stream, { mimeType: codec });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          onChunk(e.data);
        }
      };

      recorder.onerror = () => {
        onError?.("Erro no MediaRecorder. Verifique os dispositivos.");
      };

      recorder.start(RECORDING.CHUNK_INTERVAL_MS);
      pausedElapsedRef.current = 0;
      startTimer();

      setState({ status: "recording", stream, elapsedMs: 0 });
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Permissão de câmera/microfone negada."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "Dispositivo de mídia não encontrado."
            : "Erro ao iniciar gravação.";
      onError?.(msg);
    }
  }, [cameraId, microphoneId, externalStream, onChunk, onError, startTimer]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      pausedElapsedRef.current += Date.now() - startTimeRef.current;
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

  return {
    ...state,
    start,
    pause,
    resume,
    stop,
  };
};
