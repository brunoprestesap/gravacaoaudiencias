"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { VideoPreview } from "./VideoPreview";
import { RecordingControls } from "./RecordingControls";
import { RecordingStatus } from "./RecordingStatus";
import { LayoutSwitcher } from "./LayoutSwitcher";
import { MultiCameraLayoutSwitcher } from "./MultiCameraLayoutSwitcher";
import { CameraSelector } from "./CameraSelector";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useChunkStorage } from "@/hooks/useChunkStorage";
import { useDeviceDetection } from "@/hooks/useDeviceDetection";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useToast } from "@/hooks/useToast";
import { useAudioAnalyser } from "@/hooks/useAudioAnalyser";
import { useAudioLevel } from "@/hooks/useAudioLevel";
import { AudioLevelIndicator } from "./AudioLevelIndicator";
import { useLiveTranscription } from "@/hooks/useLiveTranscription";
import { useHybridStream } from "@/hooks/useHybridStream";
import { useMultiCameraStream } from "@/hooks/useMultiCameraStream";
import { Modal } from "@/components/ui/Modal";
import { uploadRecoverySegments } from "@/lib/upload-client";
import { buildSegmentsFromChunks } from "@/lib/chunk-segmentation";
import { RECORDING } from "@/lib/constants";
import type { ProcessMetadata, ModoGravacao, HybridLayout, MultiCameraLayout } from "@/types/recording";

interface RecordingScreenProps {
  gravacaoId: string;
  metadata: ProcessMetadata;
  modo: ModoGravacao;
  initialSelectedCameras?: string[];
  initialSelectedMicrophone?: string;
  onComplete?: () => void;
}

export const RecordingScreen = ({
  gravacaoId,
  metadata,
  modo,
  initialSelectedCameras,
  initialSelectedMicrophone,
  onComplete,
}: RecordingScreenProps) => {
  const toast = useToast();
  const [showStopModal, setShowStopModal] = useState(false);
  const [showScreenEndedModal, setShowScreenEndedModal] = useState(false);
  const [hybridLayout, setHybridLayout] = useState<HybridLayout>("pip");
  const [multiCameraLayout, setMultiCameraLayout] = useState<MultiCameraLayout>("side-by-side");
  const [activeTab, setActiveTab] = useState<"camera" | "screen">("screen");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewCameraStream, setPreviewCameraStream] = useState<MediaStream | null>(null);
  const speechSupportWarnedRef = useRef(false);
  const prevStatusRef = useRef<"idle" | "recording" | "paused" | "stopped">("idle");
  const speechStartRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechStartedFromUserGestureRef = useRef(false);
  const pendingStartRef = useRef(false);

  const isHybrid = modo === "HIBRIDO";

  // ── Device detection ──────────────────────────────────────────────────────
  const {
    selectedCamera,
    selectedMicrophone,
    selectedCameras,
    cameras,
    microphones,
    isDetecting,
    error: deviceError,
    toggleCamera,
  } = useDeviceDetection(true, initialSelectedCameras, initialSelectedMicrophone);

  const isMultiCamera = !isHybrid && selectedCameras.length > 1;

  // ── Chunk storage ─────────────────────────────────────────────────────────
  const {
    chunkCount,
    totalBytes,
    saveChunk,
    getAllChunks,
    clearChunks,
    createRecoveryRecord,
    beginNewSegment,
    clearRecoveryRecord,
    error: storageError,
  } = useChunkStorage(gravacaoId);

  // ── Hybrid stream (must come before useMediaRecorder) ─────────────────────
  const onScreenEndedUnexpectedly = useCallback(() => {
    toast.warning("Compartilhamento de tela encerrado. Escolha como deseja continuar.");
    setShowScreenEndedModal(true);
  }, [toast]);

  const {
    combinedStream,
    cameraOnlyStream,
    showCancelCaptureModal,
    startHybrid,
    stopHybrid,
    setActiveTab: setHybridActiveTab,
    handleCancelCaptureWithCameraOnly: handleCancelCaptureWithCameraOnlyRaw,
    handleCancelCaptureAbort,
  } = useHybridStream({
    selectedCamera,
    selectedMicrophone,
    hybridLayout,
    onScreenEndedUnexpectedly,
    onCaptureCancel: useCallback(() => {}, []),
  });

  // Sync activeTab to hybrid handle
  useEffect(() => {
    setHybridActiveTab(activeTab);
  }, [activeTab, setHybridActiveTab]);

  // ── Multi-camera stream ───────────────────────────────────────────────────
  const {
    combinedStream: multiCameraStream,
    start: startMultiCamera,
    stop: stopMultiCamera,
    setLayout: setMultiCameraCompositorLayout,
  } = useMultiCameraStream({
    selectedCameras,
    selectedMicrophone,
  });

  const handleMultiCameraLayoutChange = useCallback((layout: MultiCameraLayout) => {
    setMultiCameraLayout(layout);
    setMultiCameraCompositorLayout(layout);
  }, [setMultiCameraCompositorLayout]);

  // ── Media recorder ────────────────────────────────────────────────────────
  const handleChunk = useCallback(
    (blob: Blob) => {
      saveChunk(blob).catch(() => {
        toast.error("Falha ao salvar chunk — risco de perda de dados");
      });
    },
    [saveChunk, toast]
  );

  const handleRecordingError = useCallback(
    (error: string) => { toast.error(error); },
    [toast]
  );

  const usesExternalStream = isHybrid || isMultiCamera;
  const {
    status,
    stream: recorderStream,
    elapsedMs,
    start: startRecorder,
    pause,
    resume,
    stop,
  } = useMediaRecorder({
    cameraId: usesExternalStream ? undefined : selectedCamera,
    microphoneId: usesExternalStream ? undefined : selectedMicrophone,
    externalStream: isHybrid ? combinedStream : isMultiCamera ? multiCameraStream : undefined,
    onChunk: handleChunk,
    onError: handleRecordingError,
  });

  // ── Audio analyser ────────────────────────────────────────────────────────
  const isActive = status === "recording" || status === "paused";
  const voiceFeaturesRef = useAudioAnalyser(recorderStream, isActive);
  const audioLevelRef = useAudioLevel(recorderStream, isActive);

  // ── Speech recognition ────────────────────────────────────────────────────
  const handleSpeechError = useCallback(
    (message: string) => { toast.warning(message); },
    [toast]
  );

  const {
    isSupported: isSpeechSupported,
    unsupportedReason: speechUnsupportedReason,
    isRunning: isSpeechRunning,
    interimText,
    finalSegments,
    transcriptText,
    start: startSpeech,
    pause: pauseSpeech,
    resume: resumeSpeech,
    stop: stopSpeech,
  } = useSpeechRecognition({
    lang: "pt-BR",
    processMetadata: metadata,
    getVoiceFeatures: () => voiceFeaturesRef.current,
    onError: handleSpeechError,
  });

  // ── Live transcription sync ───────────────────────────────────────────────
  const { flush: flushLiveTranscription } = useLiveTranscription(
    gravacaoId,
    finalSegments,
    isActive
  );

  // ── Start logic ───────────────────────────────────────────────────────────
  const stopPreviewStream = useCallback(() => {
    setPreviewCameraStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const startPresencial = useCallback(async () => {
    if (chunkCount > 0) beginNewSegment();
    stopPreviewStream();
    await createRecoveryRecord(metadata, modo);
    await startRecorder();
  }, [chunkCount, beginNewSegment, createRecoveryRecord, metadata, modo, startRecorder, stopPreviewStream]);

  const startMultiCameraWrapper = useCallback(async () => {
    if (chunkCount > 0) beginNewSegment();
    stopPreviewStream();
    try {
      const stream = await startMultiCamera(multiCameraLayout);
      if (stream) {
        await createRecoveryRecord(metadata, modo);
        pendingStartRef.current = true;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar câmeras.");
    }
  }, [
    chunkCount,
    beginNewSegment,
    stopPreviewStream,
    startMultiCamera,
    createRecoveryRecord,
    metadata,
    modo,
    toast,
    multiCameraLayout,
  ]);

  const startHybridWrapper = useCallback(async () => {
    if (chunkCount > 0) beginNewSegment();
    stopPreviewStream();
    try {
      const stream = await startHybrid();
      if (stream) {
        await createRecoveryRecord(metadata, modo);
        pendingStartRef.current = true;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar captura híbrida.");
    }
  }, [chunkCount, beginNewSegment, stopPreviewStream, startHybrid, createRecoveryRecord, metadata, modo, toast]);

  // Start recorder once the external stream (hybrid or multi-camera) is ready
  useEffect(() => {
    const externalStream = combinedStream ?? multiCameraStream;
    if (pendingStartRef.current && externalStream && (status === "idle" || status === "stopped")) {
      pendingStartRef.current = false;
      startRecorder();
    }
  }, [combinedStream, multiCameraStream, status, startRecorder]);

  const handleCancelCaptureWithCameraOnly = useCallback(async () => {
    const stream = await handleCancelCaptureWithCameraOnlyRaw();
    if (stream) {
      await createRecoveryRecord(metadata, modo);
      pendingStartRef.current = true;
    }
  }, [handleCancelCaptureWithCameraOnlyRaw, createRecoveryRecord, metadata, modo]);

  const start = isHybrid
    ? startHybridWrapper
    : isMultiCamera
      ? startMultiCameraWrapper
      : startPresencial;

  const handleScreenEndedContinueWithCamera = useCallback(async () => {
    setShowScreenEndedModal(false);
    if (!cameraOnlyStream) {
      toast.error("Não foi possível continuar: stream da câmera não está disponível.");
      return;
    }
    await stop();
    beginNewSegment();
    pendingStartRef.current = true;
  }, [cameraOnlyStream, beginNewSegment, stop, toast]);

  const handleScreenEndedStop = useCallback(() => {
    setShowScreenEndedModal(false);
    setShowStopModal(true);
  }, []);

  // ── Camera preview (presencial mode, idle) ────────────────────────────────
  useEffect(() => {
    if (isHybrid || isMultiCamera || status !== "idle" || !selectedCamera) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const openPreview = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
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
          audio: false,
        });
        if (!cancelled) {
          setPreviewCameraStream(stream);
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch {
        // Silently fail — the user will see placeholder
      }
    };

    openPreview();
    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setPreviewCameraStream(null);
    };
  }, [isHybrid, isMultiCamera, status, selectedCamera]);

  // ── Stop logic ────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => setShowStopModal(true), []);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const estimatedMp4Bytes = Math.round(
    (Math.max(1, Math.floor(elapsedMs / 1000)) *
      (RECORDING.VIDEO_BITS_PER_SECOND + RECORDING.AUDIO_BITS_PER_SECOND)) /
      8 * 1.1
  );

  const confirmStop = useCallback(async () => {
    setShowStopModal(false);
    const durationSec = Math.round(elapsedMs / 1000);
    await stop();
    stopSpeech();

    // Libera câmeras e microfones imediatamente após o fim da gravação
    if (isHybrid) stopHybrid();
    if (isMultiCamera) stopMultiCamera();

    await new Promise((resolve) => setTimeout(resolve, 400));
    await flushLiveTranscription({ force: true });

    toast.info("Processando gravação...");
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const chunks = await getAllChunks();
      if (chunks.length === 0) {
        toast.error("Nenhum chunk encontrado para consolidar.");
        setIsUploading(false);
        return;
      }

      const segments = buildSegmentsFromChunks(chunks);
      if (segments.length === 0) {
        toast.error("Nenhum segmento válido encontrado para envio.");
        setIsUploading(false);
        return;
      }

      const uploadResult = await uploadRecoverySegments(gravacaoId, segments, {
        duracao: durationSec,
        onProgress: setUploadProgress,
      });

      await clearChunks();
      await clearRecoveryRecord();
      await flushLiveTranscription({ force: true, isFinal: true });

      setIsUploading(false);
      if (uploadResult.warning) {
        toast.warning(uploadResult.warning);
      } else {
        toast.success("Gravação finalizada e enviada ao servidor com sucesso.");
      }
      if (uploadResult.encoding) {
        const estimatedMb = (estimatedMp4Bytes / (1024 * 1024)).toFixed(1);
        const finalMb = (uploadResult.fileSize / (1024 * 1024)).toFixed(1);
        toast.info(`Estimado: ${estimatedMb} MB | MP4 final: ${finalMb} MB`);
      }
      onComplete?.();
    } catch {
      toast.error("Falha ao enviar gravação ao servidor. Os dados estão preservados localmente. Tente novamente.");
      setIsUploading(false);
    }
  }, [
    stop, stopSpeech, flushLiveTranscription, elapsedMs, clearRecoveryRecord, toast,
    isHybrid, stopHybrid, isMultiCamera, stopMultiCamera,
    onComplete, getAllChunks, clearChunks, gravacaoId, estimatedMp4Bytes,
  ]);

  // ── Speech status transitions ─────────────────────────────────────────────
  useEffect(() => {
    const prevStatus = prevStatusRef.current;

    if (status === "recording" && (prevStatus === "idle" || prevStatus === "stopped")) {
      if (isSpeechSupported) {
        const started = speechStartedFromUserGestureRef.current || startSpeech();
        if (!started) {
          if (speechStartRetryTimerRef.current) clearTimeout(speechStartRetryTimerRef.current);
          speechStartRetryTimerRef.current = setTimeout(() => { startSpeech(); }, 600);
        }
      }
    } else if (status === "paused" && prevStatus === "recording") {
      pauseSpeech();
    } else if (status === "recording" && prevStatus === "paused") {
      resumeSpeech();
    } else if (status === "stopped" && (prevStatus === "recording" || prevStatus === "paused")) {
      stopSpeech();
      speechStartedFromUserGestureRef.current = false;
    }

    prevStatusRef.current = status;
  }, [status, isSpeechSupported, startSpeech, pauseSpeech, resumeSpeech, stopSpeech]);

  useEffect(() => () => {
    if (speechStartRetryTimerRef.current) {
      clearTimeout(speechStartRetryTimerRef.current);
      speechStartRetryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      // RecoveryRecord stays as "recording" — no action needed
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const previewStream = isHybrid
    ? combinedStream
    : isMultiCamera
      ? multiCameraStream ?? recorderStream
      : recorderStream ?? previewCameraStream;

  const modoLabel = modo === "PRESENCIAL" ? "Presencial" : "Híbrido";

  const deviceInfo = useMemo(() => {
    if (isDetecting) return { camera: "Detectando...", mic: "Detectando..." };
    if (deviceError) return { camera: deviceError, mic: "" };
    const cam = cameras.find((c) => c.deviceId === selectedCamera);
    const mic = microphones.find((m) => m.deviceId === selectedMicrophone);
    return {
      camera: cam?.label ?? "Sem câmera",
      mic: mic?.label ?? "Sem microfone",
    };
  }, [isDetecting, deviceError, cameras, microphones, selectedCamera, selectedMicrophone]);

  const isDev = process.env.NODE_ENV === "development";
  const isRecording = status === "recording";
  const isPaused = status === "paused";

  const speechStatusLabel = !isSpeechSupported
    ? (speechUnsupportedReason ?? "Não suportado neste navegador")
    : isSpeechRunning
      ? "Capturando fala"
      : isActive
        ? "Aguardando reconhecimento"
        : "Parado";

  const startWithSpeechNotice = useCallback(async () => {
    if (!isSpeechSupported && !speechSupportWarnedRef.current) {
      speechSupportWarnedRef.current = true;
      toast.warning(speechUnsupportedReason ?? "Transcrição em tempo real indisponível neste navegador. Use Chrome ou Edge.");
    }
    if (isSpeechSupported) {
      speechStartedFromUserGestureRef.current = startSpeech();
    } else {
      speechStartedFromUserGestureRef.current = false;
    }
    await start();
  }, [isSpeechSupported, toast, start, startSpeech]);


  return (
    <div className="recording-screen flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden bg-gradient-to-br from-[#0a0f1e] via-[#111827] to-[#0a0f1e]">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-[120px] transition-colors duration-1000 ${
          isRecording ? "bg-red-500" : isPaused ? "bg-amber-500" : "bg-blue-500"
        }`} />
        <div className={`absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-15 blur-[120px] transition-colors duration-1000 ${
          isRecording ? "bg-red-600" : isPaused ? "bg-amber-600" : "bg-indigo-500"
        }`} />
      </div>

      {/* Top bar */}
      <header className="glass-panel relative z-10 flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide ${
            isHybrid
              ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
              : "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30"
          }`}>
            {modoLabel}
          </span>
          <span className="text-sm font-medium text-white/90">{metadata.numeroProcesso}</span>
        </div>

        <div className="flex items-center gap-3">
          <AudioLevelIndicator levelRef={audioLevelRef} active={isActive} />
          <RecordingStatus
            status={status}
            elapsedMs={elapsedMs}
            chunkCount={chunkCount}
            totalBytes={totalBytes}
            estimatedMp4Bytes={estimatedMp4Bytes}
          />
          {isDev && isActive && (
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-mono text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20 transition-colors"
              title="DEV: Simular crash (reload)"
            >
              Crash
            </button>
          )}
        </div>
      </header>

      {/* Main area */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Tabs for hybrid tabs mode */}
          {isHybrid && hybridLayout === "tabs" && isActive && (
            <div className="flex gap-1 px-4 pt-3">
              <button
                onClick={() => setActiveTab("camera")}
                className={`rounded-t-lg px-4 py-2 text-xs font-medium transition-all ${
                  activeTab === "camera" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  Câmera
                </span>
              </button>
              <button
                onClick={() => setActiveTab("screen")}
                className={`rounded-t-lg px-4 py-2 text-xs font-medium transition-all ${
                  activeTab === "screen" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
                  </svg>
                  Teams
                </span>
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 p-4">
            <VideoPreview stream={previewStream} isLoading={isDetecting || (!previewStream && status === "idle" && !deviceError)} />
          </div>

          <div className="flex shrink-0 items-center justify-center gap-4 px-6 pb-5 pt-1">
            {isHybrid && isActive && (
              <LayoutSwitcher layout={hybridLayout} onLayoutChange={setHybridLayout} />
            )}
            {isMultiCamera && isActive && (
              <MultiCameraLayoutSwitcher
                layout={multiCameraLayout}
                onLayoutChange={handleMultiCameraLayoutChange}
                cameraCount={selectedCameras.length}
              />
            )}
            <RecordingControls
              status={status}
              onStart={startWithSpeechNotice}
              onPause={pause}
              onResume={resume}
              onStop={handleStop}
            />
          </div>
        </div>

        {/* Side panel */}
        <aside className={`sidebar-panel relative shrink-0 transition-all duration-300 ${sidebarCollapsed ? "w-12" : "w-72"}`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute -left-3 top-6 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/60 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white"
            title={sidebarCollapsed ? "Expandir painel" : "Recolher painel"}
          >
            <svg className={`h-3 w-3 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>

          {!sidebarCollapsed && (
            <div className="h-full overflow-y-auto p-5">
              {/* Process info */}
              <div className="mb-5">
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  Processo
                </h3>
                <div className="space-y-2.5">
                  <MetadataField label="N° Processo" value={metadata.numeroProcesso} />
                  {metadata.classeProcessual && <MetadataField label="Classe" value={metadata.classeProcessual} />}
                  {metadata.partes && <MetadataField label="Partes" value={metadata.partes} />}
                  {metadata.vara && <MetadataField label="Vara" value={metadata.vara} />}
                  {metadata.nomeJuiz && <MetadataField label="Juiz(a)" value={metadata.nomeJuiz} />}
                  {metadata.tipoAudiencia && <MetadataField label="Tipo" value={metadata.tipoAudiencia} />}
                  {metadata.dataAudiencia && <MetadataField label="Data" value={metadata.dataAudiencia} />}
                </div>
              </div>

              {!isHybrid && cameras.length > 1 && (
                <>
                  <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  <div className="mb-5">
                    <CameraSelector
                      cameras={cameras}
                      selectedCameras={selectedCameras}
                      onToggle={toggleCamera}
                      disabled={isActive}
                    />
                  </div>
                </>
              )}

              <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

              {/* Devices */}
              <div className="mb-5">
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                  </svg>
                  Dispositivos
                </h3>
                <div className="space-y-2">
                  <DeviceItem
                    icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>}
                    label={deviceInfo.camera}
                  />
                  <DeviceItem
                    icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>}
                    label={deviceInfo.mic}
                  />
                </div>
              </div>

              <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

              {/* Live transcription */}
              <div className="mb-5">
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                  Transcrição ao vivo
                </h3>
                <div className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                  <p className={`mb-2 text-[11px] uppercase tracking-wider ${isSpeechSupported ? "text-emerald-300/80" : "text-amber-300/80"}`}>
                    {speechStatusLabel}
                  </p>
                  {finalSegments.length > 0 ? (
                    <div className="max-h-44 space-y-2 overflow-y-auto">
                      {finalSegments.slice(-8).map((segment) => (
                        <p key={segment.id} className="text-xs leading-relaxed text-white/80">
                          <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-cyan-200">
                            {segment.role ?? "DESCONHECIDO"}
                          </span>
                          {segment.text}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-white/75">
                      {transcriptText || "Nenhum trecho final reconhecido ainda."}
                    </p>
                  )}
                  {interimText && (
                    <p className="mt-2 text-xs italic leading-relaxed text-white/45">{interimText}</p>
                  )}
                </div>
              </div>

              <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

              {/* Storage info */}
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                  </svg>
                  Armazenamento
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <StorageStat label="Chunks" value={String(chunkCount)} />
                  <StorageStat label="Tamanho" value={formatBytes(totalBytes)} />
                  <StorageStat label="Intervalo" value="5s" />
                  <StorageStat label="Status" value={isActive ? "Ativo" : "Parado"} active={isActive} />
                </div>
              </div>

              {storageError && (
                <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-xs text-red-400 ring-1 ring-red-500/20">
                  <span className="flex items-center gap-2">
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    {storageError}
                  </span>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Stop confirmation modal */}
      <Modal
        open={showStopModal}
        onClose={() => setShowStopModal(false)}
        title="Encerrar Gravação"
        confirmLabel="Encerrar"
        cancelLabel="Cancelar"
        onConfirm={confirmStop}
        destructive
      >
        <p>
          Deseja encerrar a gravação da audiência do processo{" "}
          <strong>{metadata.numeroProcesso}</strong>?
        </p>
        <p className="mt-2 text-text-muted">
          {chunkCount} chunks salvos ({(totalBytes / (1024 * 1024)).toFixed(1)} MB)
        </p>
      </Modal>

      {/* Upload progress overlay */}
      {isUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-96 rounded-2xl bg-[#1e293b]/90 p-8 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/10 border-t-blue-400" />
            </div>
            <p className="text-lg font-semibold text-white">Enviando gravação</p>
            <p className="mt-1 text-sm text-white/50">Aguarde o envio completo ao servidor</p>
            <div className="mt-5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="mt-2 text-sm font-medium tabular-nums text-white/70">{uploadProgress}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Screen capture cancelled modal */}
      <Modal
        open={showCancelCaptureModal}
        onClose={handleCancelCaptureAbort}
        title="Captura de Tela Cancelada"
        confirmLabel="Continuar com Câmera"
        cancelLabel="Cancelar Gravação"
        onConfirm={handleCancelCaptureWithCameraOnly}
      >
        <p>A seleção da janela do Teams foi cancelada. Deseja continuar a gravação apenas com a câmera local?</p>
      </Modal>

      <Modal
        open={showScreenEndedModal}
        onClose={handleScreenEndedStop}
        title="Compartilhamento de tela interrompido"
        confirmLabel="Retomar com Câmera"
        cancelLabel="Encerrar Gravação"
        onConfirm={handleScreenEndedContinueWithCamera}
        destructive
      >
        <p>O compartilhamento de tela do Teams foi encerrado durante a gravação híbrida.</p>
        <p className="mt-2 text-text-muted">
          Para evitar gravação degradada, a captura foi pausada automaticamente. Escolha retomar apenas com câmera local ou encerrar.
        </p>
      </Modal>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const MetadataField = ({ label, value }: { label: string; value: string }) => (
  <div className="group">
    <dt className="text-[10px] font-medium uppercase tracking-widest text-white/30">{label}</dt>
    <dd className="mt-0.5 text-[13px] leading-snug text-white/80">{value}</dd>
  </div>
);

const DeviceItem = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
  <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2">
    <span className="text-white/40">{icon}</span>
    <span className="truncate text-xs text-white/60">{label}</span>
  </div>
);

const StorageStat = ({ label, value, active }: { label: string; value: string; active?: boolean }) => (
  <div className="rounded-lg bg-white/5 px-3 py-2 text-center">
    <p className={`text-sm font-semibold tabular-nums ${active ? "text-emerald-400" : "text-white/80"}`}>{value}</p>
    <p className="text-[10px] uppercase tracking-wider text-white/30">{label}</p>
  </div>
);

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
