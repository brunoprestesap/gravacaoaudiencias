"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ScreenCaptureState {
  screenStream: MediaStream | null;
  isCapturing: boolean;
  error: string | null;
}

interface UseScreenCaptureOptions {
  onStreamEnded?: () => void;
}

export const useScreenCapture = (options?: UseScreenCaptureOptions) => {
  const [state, setState] = useState<ScreenCaptureState>({
    screenStream: null,
    isCapturing: false,
    error: null,
  });
  const streamRef = useRef<MediaStream | null>(null);

  const startCapture = useCallback(async (): Promise<MediaStream | null> => {
    setState((s) => ({ ...s, error: null }));

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      streamRef.current = stream;

      // Listen for user ending screen share via browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          setState({ screenStream: null, isCapturing: false, error: null });
          streamRef.current = null;
          options?.onStreamEnded?.();
        };
      }

      setState({ screenStream: stream, isCapturing: true, error: null });
      return stream;
    } catch (err) {
      const isCancel =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "AbortError");

      const message = isCancel
        ? "Captura de tela cancelada. A gravação continuará apenas com a câmera local."
        : "Erro ao iniciar captura de tela.";

      setState({ screenStream: null, isCapturing: false, error: message });
      return null;
    }
  }, [options]);

  const stopCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState({ screenStream: null, isCapturing: false, error: null });
  }, []);

  // Cleanup on unmount: garante que captura de tela é liberada se o componente desmontar inesperadamente
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    ...state,
    startCapture,
    stopCapture,
  };
};
