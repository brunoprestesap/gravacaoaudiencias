"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { combineMultipleCameraStreams, type MultiCameraStreamHandle } from "@/lib/media-utils";
import { RECORDING } from "@/lib/constants";
import type { MultiCameraLayout } from "@/types/recording";

interface UseMultiCameraStreamOptions {
  selectedCameras: string[];
  selectedMicrophone: string | null;
}

/**
 * Manages acquiring multiple camera streams and compositing them into one
 * MediaStream using a canvas. Layout changes are applied live without stopping
 * via the returned `setLayout` function.
 */
export function useMultiCameraStream({
  selectedCameras,
  selectedMicrophone,
}: UseMultiCameraStreamOptions) {
  const handleRef = useRef<MultiCameraStreamHandle | null>(null);
  const cameraStreamsRef = useRef<MediaStream[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [combinedStream, setCombinedStream] = useState<MediaStream | null>(null);

  /** Call this directly to change layout on the live compositor — no React cycle needed. */
  const setLayout = useCallback((layout: MultiCameraLayout) => {
    handleRef.current?.setLayout(layout);
  }, []);

  const start = useCallback(async (initialLayout: MultiCameraLayout = "side-by-side"): Promise<MediaStream | null> => {
    if (selectedCameras.length < 2) return null;

    // Open video-only stream per camera
    const streams: MediaStream[] = [];
    for (const cameraId of selectedCameras) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: cameraId },
            width: { ideal: RECORDING.RECORD_WIDTH },
            height: { ideal: RECORDING.RECORD_HEIGHT },
            frameRate: { ideal: RECORDING.RECORD_FPS, max: RECORDING.RECORD_FPS },
          },
          audio: false,
        });
        streams.push(s);
      } catch {
        // If one camera fails, stop already-opened streams and throw
        streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        throw new Error(`Não foi possível acessar a câmera ${cameraId}.`);
      }
    }
    cameraStreamsRef.current = streams;

    // Open microphone stream
    let micStream: MediaStream | null = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: selectedMicrophone ? { deviceId: { ideal: selectedMicrophone } } : true,
      });
    } catch {
      // Proceed without audio — user will be warned separately if needed
    }
    micStreamRef.current = micStream;

    const handle = combineMultipleCameraStreams(streams, micStream, initialLayout);
    handleRef.current = handle;
    setCombinedStream(handle.stream);
    return handle.stream;
  }, [selectedCameras, selectedMicrophone]);

  const stop = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.destroy();
      handleRef.current = null;
    }
    cameraStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    cameraStreamsRef.current = [];
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setCombinedStream(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
      cameraStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { combinedStream, start, stop, setLayout };
}
