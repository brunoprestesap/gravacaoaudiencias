"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { VideoPreview } from "./VideoPreview";
import { RecordingControls } from "./RecordingControls";
import { RecordingStatus } from "./RecordingStatus";
import { LayoutSwitcher } from "./LayoutSwitcher";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useChunkStorage } from "@/hooks/useChunkStorage";
import { useDeviceDetection } from "@/hooks/useDeviceDetection";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { useToast } from "@/hooks/useToast";
import { Modal } from "@/components/ui/Modal";
import { combineStreams, consolidateChunks, uploadConsolidated, type CombinedStreamHandle } from "@/lib/media-utils";
import type { ProcessMetadata, ModoGravacao, HybridLayout } from "@/types/recording";

interface RecordingScreenProps {
  gravacaoId: string;
  metadata: ProcessMetadata;
  modo: ModoGravacao;
  onComplete?: () => void;
}

export const RecordingScreen = ({
  gravacaoId,
  metadata,
  modo,
  onComplete,
}: RecordingScreenProps) => {
  const toast = useToast();
  const [showStopModal, setShowStopModal] = useState(false);
  const [showCancelCaptureModal, setShowCancelCaptureModal] = useState(false);
  const [hybridLayout, setHybridLayout] = useState<HybridLayout>("pip");
  const [activeTab, setActiveTab] = useState<"camera" | "screen">("screen");
  const combinedHandleRef = useRef<(CombinedStreamHandle & { activeTab: "camera" | "screen" }) | null>(null);
  const [combinedStream, setCombinedStream] = useState<MediaStream | null>(null);
  const [cameraOnlyStream, setCameraOnlyStream] = useState<MediaStream | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isHybrid = modo === "HIBRIDO";
  const [previewCameraStream, setPreviewCameraStream] = useState<MediaStream | null>(null);

  const {
    selectedCamera,
    selectedMicrophone,
    cameras,
    microphones,
    isDetecting,
    error: deviceError,
  } = useDeviceDetection();

  const {
    chunkCount,
    totalBytes,
    saveChunk,
    getAllChunks,
    clearChunks,
    createRecoveryRecord,
    clearRecoveryRecord,
    error: storageError,
  } = useChunkStorage(gravacaoId);

  const handleChunk = useCallback(
    (blob: Blob) => {
      saveChunk(blob).catch(() => {
        toast.error("Falha ao salvar chunk — risco de perda de dados");
      });
    },
    [saveChunk, toast]
  );

  const handleRecordingError = useCallback(
    (error: string) => {
      toast.error(error);
    },
    [toast]
  );

  const onScreenEnded = useCallback(() => {
    toast.warning("Compartilhamento de tela encerrado. A gravação continua apenas com a câmera.");
    if (combinedHandleRef.current) {
      combinedHandleRef.current.destroy();
      combinedHandleRef.current = null;
    }
  }, [toast]);

  const {
    startCapture,
    stopCapture,
  } = useScreenCapture({ onStreamEnded: onScreenEnded });

  const {
    status,
    stream: recorderStream,
    elapsedMs,
    start: startRecorder,
    pause,
    resume,
    stop,
  } = useMediaRecorder({
    cameraId: isHybrid ? undefined : selectedCamera,
    microphoneId: isHybrid ? undefined : selectedMicrophone,
    externalStream: isHybrid ? combinedStream : undefined,
    onChunk: handleChunk,
    onError: handleRecordingError,
  });

  useEffect(() => {
    if (isHybrid || status !== "idle" || !selectedCamera) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const openPreview = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: selectedCamera
            ? { deviceId: { ideal: selectedCamera }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
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
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setPreviewCameraStream(null);
    };
  }, [isHybrid, status, selectedCamera]);

  useEffect(() => {
    if (status === "recording" && previewCameraStream) {
      previewCameraStream.getTracks().forEach((t) => t.stop());
      setPreviewCameraStream(null);
    }
  }, [status, previewCameraStream]);

  const previewStream = isHybrid
    ? combinedStream
    : recorderStream ?? previewCameraStream;

  useEffect(() => {
    if (combinedHandleRef.current) {
      combinedHandleRef.current.setLayout(hybridLayout);
    }
  }, [hybridLayout]);

  useEffect(() => {
    if (combinedHandleRef.current) {
      combinedHandleRef.current.activeTab = activeTab;
    }
  }, [activeTab]);

  // ── Start logic ───────────────────────────────────────────────────────────

  const startPresencial = useCallback(async () => {
    await createRecoveryRecord(metadata, modo);
    await startRecorder();
  }, [createRecoveryRecord, metadata, modo, startRecorder]);

  const startHybrid = useCallback(async () => {
    const cameraConstraints: MediaStreamConstraints = {
      video: selectedCamera
        ? { deviceId: { ideal: selectedCamera }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: selectedMicrophone
        ? { deviceId: { ideal: selectedMicrophone } }
        : true,
    };

    let cameraStream: MediaStream;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
      setCameraOnlyStream(cameraStream);
    } catch {
      toast.error("Não foi possível acessar câmera/microfone.");
      return;
    }

    const screenStream = await startCapture();

    if (!screenStream) {
      setShowCancelCaptureModal(true);
      setCameraOnlyStream(cameraStream);
      return;
    }

    const handle = combineStreams(cameraStream, screenStream, hybridLayout);
    combinedHandleRef.current = handle as CombinedStreamHandle & { activeTab: "camera" | "screen" };
    setCombinedStream(handle.stream);

    await createRecoveryRecord(metadata, modo);
  }, [selectedCamera, selectedMicrophone, startCapture, hybridLayout, createRecoveryRecord, metadata, modo, toast]);

  const pendingStartRef = useRef(false);

  const startHybridWrapper = useCallback(async () => {
    pendingStartRef.current = true;
    await startHybrid();
  }, [startHybrid]);

  useEffect(() => {
    if (pendingStartRef.current && combinedStream && status === "idle") {
      pendingStartRef.current = false;
      startRecorder();
    }
  }, [combinedStream, status, startRecorder]);

  const handleCancelCaptureWithCameraOnly = useCallback(async () => {
    setShowCancelCaptureModal(false);
    if (cameraOnlyStream) {
      setCombinedStream(cameraOnlyStream);
      await createRecoveryRecord(metadata, modo);
      pendingStartRef.current = true;
    }
  }, [cameraOnlyStream, createRecoveryRecord, metadata, modo]);

  const handleCancelCaptureAbort = useCallback(() => {
    setShowCancelCaptureModal(false);
    cameraOnlyStream?.getTracks().forEach((t) => t.stop());
    setCameraOnlyStream(null);
  }, [cameraOnlyStream]);

  const start = isHybrid ? startHybridWrapper : startPresencial;

  // ── Stop logic ────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (status === "recording" || status === "paused") {
        // RecoveryRecord stays as "recording"
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status]);

  const handleStop = useCallback(() => {
    setShowStopModal(true);
  }, []);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const confirmStop = useCallback(async () => {
    setShowStopModal(false);
    const durationSec = Math.round(elapsedMs / 1000);
    await stop();

    if (combinedHandleRef.current) {
      combinedHandleRef.current.destroy();
      combinedHandleRef.current = null;
    }
    stopCapture();
    cameraOnlyStream?.getTracks().forEach((t) => t.stop());
    setCameraOnlyStream(null);
    setCombinedStream(null);

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

      const blob = consolidateChunks(chunks);

      await uploadConsolidated(gravacaoId, blob, {
        duracao: durationSec,
        onProgress: setUploadProgress,
      });

      await clearChunks();
      await clearRecoveryRecord();

      setIsUploading(false);
      toast.success("Gravação finalizada e enviada ao servidor com sucesso.");
      onComplete?.();
    } catch {
      toast.error(
        "Falha ao enviar gravação ao servidor. Os dados estão preservados localmente. Tente novamente."
      );
      setIsUploading(false);
    }
  }, [stop, elapsedMs, clearRecoveryRecord, toast, stopCapture, cameraOnlyStream, onComplete, getAllChunks, clearChunks, gravacaoId]);

  // ── Derived state ─────────────────────────────────────────────────────────

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
  const isActive = isRecording || isPaused;

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

      {/* Top bar - glass */}
      <header className="glass-panel relative z-10 flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          {/* Mode badge */}
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide ${
            isHybrid
              ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
              : "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30"
          }`}>
            {modoLabel}
          </span>

          {/* Process number */}
          <span className="text-sm font-medium text-white/90">
            {metadata.numeroProcesso}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <RecordingStatus
            status={status}
            elapsedMs={elapsedMs}
            chunkCount={chunkCount}
            totalBytes={totalBytes}
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
        {/* Video area */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Tabs selector for hybrid tabs mode */}
          {isHybrid && hybridLayout === "tabs" && isActive && (
            <div className="flex gap-1 px-4 pt-3">
              <button
                onClick={() => setActiveTab("camera")}
                className={`rounded-t-lg px-4 py-2 text-xs font-medium transition-all ${
                  activeTab === "camera"
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
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
                  activeTab === "screen"
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
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

          {/* Video preview */}
          <div className="min-h-0 flex-1 p-4">
            <VideoPreview stream={previewStream} isLoading={isDetecting || (!previewStream && status === "idle" && !deviceError)} />
          </div>

          {/* Controls - centered below video */}
          <div className="flex shrink-0 items-center justify-center gap-4 px-6 pb-5 pt-1">
            {isHybrid && isActive && (
              <LayoutSwitcher layout={hybridLayout} onLayoutChange={setHybridLayout} />
            )}

            <RecordingControls
              status={status}
              onStart={start}
              onPause={pause}
              onResume={resume}
              onStop={handleStop}
            />
          </div>
        </div>

        {/* Side panel - glass */}
        <aside className={`sidebar-panel relative shrink-0 transition-all duration-300 ${
          sidebarCollapsed ? "w-12" : "w-72"
        }`}>
          {/* Toggle button */}
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
                  {metadata.classeProcessual && (
                    <MetadataField label="Classe" value={metadata.classeProcessual} />
                  )}
                  {metadata.partes && (
                    <MetadataField label="Partes" value={metadata.partes} />
                  )}
                  {metadata.vara && (
                    <MetadataField label="Vara" value={metadata.vara} />
                  )}
                  {metadata.nomeJuiz && (
                    <MetadataField label="Juiz(a)" value={metadata.nomeJuiz} />
                  )}
                  {metadata.tipoAudiencia && (
                    <MetadataField label="Tipo" value={metadata.tipoAudiencia} />
                  )}
                  {metadata.dataAudiencia && (
                    <MetadataField label="Data" value={metadata.dataAudiencia} />
                  )}
                </div>
              </div>

              {/* Divider */}
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
                    icon={
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                    }
                    label={deviceInfo.camera}
                  />
                  <DeviceItem
                    icon={
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                      </svg>
                    }
                    label={deviceInfo.mic}
                  />
                </div>
              </div>

              {/* Divider */}
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
            <p className="text-lg font-semibold text-white">
              Enviando gravação
            </p>
            <p className="mt-1 text-sm text-white/50">
              Aguarde o envio completo ao servidor
            </p>
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
        <p>
          A seleção da janela do Teams foi cancelada. Deseja continuar a
          gravação apenas com a câmera local?
        </p>
      </Modal>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────

const MetadataField = ({ label, value }: { label: string; value: string }) => (
  <div className="group">
    <dt className="text-[10px] font-medium uppercase tracking-widest text-white/30">
      {label}
    </dt>
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
    <p className={`text-sm font-semibold tabular-nums ${active ? "text-emerald-400" : "text-white/80"}`}>
      {value}
    </p>
    <p className="text-[10px] uppercase tracking-wider text-white/30">{label}</p>
  </div>
);

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
