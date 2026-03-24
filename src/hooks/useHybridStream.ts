"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { combineStreams, type CombinedStreamHandle } from "@/lib/media-utils";
import { RECORDING } from "@/lib/constants";
import type { HybridLayout } from "@/types/recording";

interface UseHybridStreamOptions {
  selectedCamera: string | null;
  selectedMicrophone: string | null;
  hybridLayout: HybridLayout;
  onScreenEndedUnexpectedly: () => void;
  onCaptureCancel: () => void;
}

/**
 * Gerencia a aquisição e combinação de streams de câmera + tela para modo híbrido.
 * Encapsula combineStreams, useScreenCapture, e o modal de cancelamento de captura.
 */
export function useHybridStream({
  selectedCamera,
  selectedMicrophone,
  hybridLayout,
  onScreenEndedUnexpectedly,
  onCaptureCancel,
}: UseHybridStreamOptions) {
  const combinedHandleRef = useRef<(CombinedStreamHandle & { activeTab: "camera" | "screen" }) | null>(null);
  const isIntentionalScreenStopRef = useRef(false);
  const cameraOnlyStreamRef = useRef<MediaStream | null>(null);
  const [combinedStream, setCombinedStream] = useState<MediaStream | null>(null);
  const [cameraOnlyStream, setCameraOnlyStream] = useState<MediaStream | null>(null);
  const [showCancelCaptureModal, setShowCancelCaptureModal] = useState(false);

  const onScreenEnded = useCallback(() => {
    if (isIntentionalScreenStopRef.current) {
      isIntentionalScreenStopRef.current = false;
      return;
    }
    if (combinedHandleRef.current) {
      combinedHandleRef.current.destroy();
      combinedHandleRef.current = null;
    }
    onScreenEndedUnexpectedly();
  }, [onScreenEndedUnexpectedly]);

  const { startCapture, stopCapture } = useScreenCapture({ onStreamEnded: onScreenEnded });

  // Sync layout changes to combined handle
  useEffect(() => {
    if (combinedHandleRef.current) {
      combinedHandleRef.current.setLayout(hybridLayout);
    }
  }, [hybridLayout]);

  const startHybrid = useCallback(async () => {
    const cameraConstraints: MediaStreamConstraints = {
      video: selectedCamera
        ? {
            deviceId: { ideal: selectedCamera },
            width: { ideal: RECORDING.RECORD_WIDTH },
            height: { ideal: RECORDING.RECORD_HEIGHT },
            frameRate: { ideal: RECORDING.RECORD_FPS, max: RECORDING.RECORD_FPS },
          }
        : {
            width: { ideal: RECORDING.RECORD_WIDTH },
            height: { ideal: RECORDING.RECORD_HEIGHT },
            frameRate: { ideal: RECORDING.RECORD_FPS, max: RECORDING.RECORD_FPS },
          },
      audio: selectedMicrophone
        ? { deviceId: { ideal: selectedMicrophone } }
        : true,
    };

    let cameraStream: MediaStream;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
      cameraOnlyStreamRef.current = cameraStream;
      setCameraOnlyStream(cameraStream);
    } catch {
      throw new Error("Não foi possível acessar câmera/microfone.");
    }

    const screenStream = await startCapture();

    if (!screenStream) {
      // User cancelled screen selection — offer to continue with camera only
      setShowCancelCaptureModal(true);
      return null;
    }

    const handle = combineStreams(cameraStream, screenStream, hybridLayout);
    combinedHandleRef.current = handle as CombinedStreamHandle & { activeTab: "camera" | "screen" };
    setCombinedStream(handle.stream);
    return handle.stream;
  }, [selectedCamera, selectedMicrophone, hybridLayout, startCapture]);

  const stopHybrid = useCallback(() => {
    isIntentionalScreenStopRef.current = true;
    stopCapture();
    if (combinedHandleRef.current) {
      combinedHandleRef.current.destroy();
      combinedHandleRef.current = null;
    }
    cameraOnlyStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraOnlyStreamRef.current = null;
    setCameraOnlyStream(null);
    setCombinedStream(null);
  }, [stopCapture]);

  const setActiveTab = useCallback((tab: "camera" | "screen") => {
    if (combinedHandleRef.current) {
      combinedHandleRef.current.activeTab = tab;
    }
  }, []);

  const handleCancelCaptureWithCameraOnly = useCallback(async () => {
    setShowCancelCaptureModal(false);
    if (cameraOnlyStream) {
      setCombinedStream(cameraOnlyStream);
      return cameraOnlyStream;
    }
    return null;
  }, [cameraOnlyStream]);

  const handleCancelCaptureAbort = useCallback(() => {
    setShowCancelCaptureModal(false);
    cameraOnlyStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraOnlyStreamRef.current = null;
    setCameraOnlyStream(null);
    onCaptureCancel();
  }, [onCaptureCancel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (combinedHandleRef.current) {
        combinedHandleRef.current.destroy();
        combinedHandleRef.current = null;
      }
      cameraOnlyStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraOnlyStreamRef.current = null;
    };
  }, []);

  return {
    combinedStream,
    cameraOnlyStream,
    combinedHandle: combinedHandleRef,
    showCancelCaptureModal,
    startHybrid,
    stopHybrid,
    setActiveTab,
    handleCancelCaptureWithCameraOnly,
    handleCancelCaptureAbort,
  };
}
