"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface DetectedDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface DeviceDetectionState {
  cameras: DetectedDevice[];
  microphones: DetectedDevice[];
  selectedCamera: string | null;
  selectedMicrophone: string | null;
  selectedCameras: string[];
  isDetecting: boolean;
  error: string | null;
}

const isLogitech = (label: string) =>
  /logitech/i.test(label);

const isUSBMic = (label: string) =>
  /usb|external|condenser/i.test(label) && !/logitech/i.test(label);

export const useDeviceDetection = (enabled = true, initialSelectedCameras?: string[], initialSelectedMicrophone?: string) => {
  const [state, setState] = useState<DeviceDetectionState>({
    cameras: [],
    microphones: [],
    selectedCamera: null,
    selectedMicrophone: null,
    selectedCameras: [],
    isDetecting: enabled,
    error: null,
  });
  const mountedRef = useRef(true);
  const initialSelectedRef = useRef(initialSelectedCameras);
  const initialSelectedMicRef = useRef(initialSelectedMicrophone);
  const initialAppliedRef = useRef(false);

  const detectDevices = useCallback(async () => {
    setState((s) => ({ ...s, isDetecting: true, error: null }));

    try {
      // Request permission to get labeled devices
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      tempStream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();

      const cameras: DetectedDevice[] = devices
        .filter((d) => d.kind === "videoinput" && d.deviceId)
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Câmera", kind: d.kind }));

      const microphones: DetectedDevice[] = devices
        .filter((d) => d.kind === "audioinput" && d.deviceId)
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microfone", kind: d.kind }));

      // Auto-select: prefer Logitech camera, else first available
      const preferredCamera =
        cameras.find((c) => isLogitech(c.label)) ?? cameras[0] ?? null;

      // Auto-select: prefer USB mic, then non-Logitech, else first
      const preferredMic =
        microphones.find((m) => isUSBMic(m.label)) ??
        microphones.find((m) => !isLogitech(m.label)) ??
        microphones[0] ??
        null;

      const isFirstDetection = !initialAppliedRef.current;
      initialAppliedRef.current = true;

      if (!mountedRef.current) return;

      setState((prev) => {
        // On first detection: apply wizard selection (if provided) or auto-select
        // On subsequent detections: preserve current selection, filtering out disconnected cameras
        const selectedCameras = (() => {
          if (isFirstDetection) {
            const initial = initialSelectedRef.current;
            if (initial && initial.length > 0) {
              const valid = initial.filter((id) => cameras.some((c) => c.deviceId === id));
              if (valid.length > 0) return valid;
            }
            return preferredCamera ? [preferredCamera.deviceId] : [];
          }
          // Preserve current selection, filter out cameras no longer connected
          const preserved = prev.selectedCameras.filter((id) =>
            cameras.some((c) => c.deviceId === id)
          );
          if (preserved.length > 0) return preserved;
          return preferredCamera ? [preferredCamera.deviceId] : [];
        })();

        const selectedCamera = selectedCameras[0] ?? preferredCamera?.deviceId ?? null;
        const selectedMicrophone = isFirstDetection
          ? (() => {
              const initial = initialSelectedMicRef.current;
              if (initial && microphones.some((m) => m.deviceId === initial)) return initial;
              return preferredMic?.deviceId ?? null;
            })()
          : prev.selectedMicrophone;

        return {
          cameras,
          microphones,
          selectedCamera,
          selectedMicrophone,
          selectedCameras,
          isDetecting: false,
          error:
            cameras.length === 0 && microphones.length === 0
              ? "Nenhum dispositivo de mídia encontrado."
              : null,
        };
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        isDetecting: false,
        error:
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Permissão de câmera/microfone negada. Habilite nas configurações do navegador."
            : "Erro ao detectar dispositivos.",
      }));
    }
  }, []);

  const selectCamera = useCallback((deviceId: string) => {
    setState((s) => ({ ...s, selectedCamera: deviceId }));
  }, []);

  const selectMicrophone = useCallback((deviceId: string) => {
    setState((s) => ({ ...s, selectedMicrophone: deviceId }));
  }, []);

  const toggleCamera = useCallback((deviceId: string) => {
    setState((s) => {
      const already = s.selectedCameras.includes(deviceId);
      const next = already
        ? s.selectedCameras.filter((id) => id !== deviceId)
        : [...s.selectedCameras, deviceId];
      // Keep at least one camera selected
      if (next.length === 0) return s;
      return {
        ...s,
        selectedCameras: next,
        selectedCamera: next[0],
      };
    });
  }, []);

  // Listen for device connect/disconnect (only when enabled)
  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;
    detectDevices();

    const handleChange = () => detectDevices();
    navigator.mediaDevices.addEventListener("devicechange", handleChange);

    return () => {
      mountedRef.current = false;
      navigator.mediaDevices.removeEventListener("devicechange", handleChange);
    };
  }, [detectDevices, enabled]);

  return {
    ...state,
    selectCamera,
    selectMicrophone,
    toggleCamera,
    refresh: detectDevices,
  };
};
