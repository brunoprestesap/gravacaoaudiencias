"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { StepIndicator } from "./StepIndicator";
import { RecordingScreen } from "./RecordingScreen";
import { MetadataForm } from "@/components/metadata/MetadataForm";
import { ProcessMetadataCard } from "@/components/metadata/ProcessMetadataCard";
import { useDeviceDetection } from "@/hooks/useDeviceDetection";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/Button";
import type { ProcessMetadata } from "@/types/metadata";
import type { ModoGravacao } from "@/types/recording";

const STEPS = ["Dados do Processo", "Configuração", "Gravação"];

export const RecordingWizard = () => {
  const router = useRouter();
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [metadata, setMetadata] = useState<ProcessMetadata | null>(null);
  const [modo, setModo] = useState<ModoGravacao>("PRESENCIAL");
  const [gravacaoId, setGravacaoId] = useState<string | null>(null);

  const {
    cameras,
    microphones,
    selectedMicrophone,
    selectedCameras,
    isDetecting,
    error: deviceError,
    refresh: refreshDevices,
    toggleCamera,
    selectMicrophone,
  } = useDeviceDetection(currentStep >= 2);

  const hasCameras = cameras.length > 0;
  const hasMicrophones = microphones.length > 0;
  const devicesReady = hasCameras && hasMicrophones && !isDetecting;

  // ── Step 1: Metadata form ─────────────────────────────────────────────────

  const handleMetadataSubmit = useCallback((data: ProcessMetadata) => {
    setMetadata(data);
    setCurrentStep(2);
  }, []);

  // ── Step 2: Configuration ─────────────────────────────────────────────────

  const handleStartRecording = useCallback(async () => {
    if (!metadata) return;

    // Generate a unique gravacao ID
    const id = `grav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setGravacaoId(id);

    // Create gravação record via API (best-effort, don't block)
    try {
      await fetch("/api/gravacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          metadata,
          modo,
        }),
      });
    } catch {
      // API might not exist yet — continue anyway
    }

    setCurrentStep(3);
  }, [metadata, modo]);

  // ── Step 3: Recording complete callback ───────────────────────────────────

  const handleRecordingComplete = useCallback(() => {
    toast.success("Gravação finalizada e salva com sucesso.");
    router.push("/dashboard");
  }, [toast, router]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Step 3 is immersive — no wizard chrome
  if (currentStep === 3 && gravacaoId && metadata) {
    return (
      <RecordingScreen
        gravacaoId={gravacaoId}
        metadata={metadata}
        modo={modo}
        initialSelectedCameras={selectedCameras}
        initialSelectedMicrophone={selectedMicrophone ?? undefined}
        onComplete={handleRecordingComplete}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Step indicator */}
      <div className="mb-8">
        <StepIndicator currentStep={currentStep} steps={STEPS} />
      </div>

      {/* Step 1: Metadata */}
      {currentStep === 1 && (
        <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
          <h2 className="mb-6 text-lg font-semibold text-text-primary">
            Dados do Processo
          </h2>
          <MetadataForm
            initialData={metadata ?? undefined}
            onSubmit={handleMetadataSubmit}
          />
        </div>
      )}

      {/* Step 2: Configuration */}
      {currentStep === 2 && metadata && (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left column: Metadata confirmation */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-secondary">
                  Dados do Processo
                </h3>
                <button
                  onClick={() => setCurrentStep(1)}
                  className="text-sm text-secondary hover:text-secondary/80 hover:underline"
                >
                  ← Editar dados
                </button>
              </div>
              <ProcessMetadataCard metadata={metadata} />
            </div>

            {/* Right column: Recording config */}
            <div className="space-y-6">
              {/* Modo de gravação */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-text-secondary">
                  Modo de Gravação
                </h3>
                <div className="grid gap-3 grid-cols-2">
                  <ModoCard
                    label="Presencial"
                    description="Gravação com câmera e microfone na sala de audiência"
                    selected={modo === "PRESENCIAL"}
                    onClick={() => setModo("PRESENCIAL")}
                  />
                  <ModoCard
                    label="Híbrido"
                    description="Câmera local + captura de tela do Microsoft Teams"
                    selected={modo === "HIBRIDO"}
                    onClick={() => setModo("HIBRIDO")}
                  />
                </div>

                {modo === "HIBRIDO" && (
                  <div className="mt-3 rounded border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-accent">
                    Ao iniciar, você precisará selecionar a janela do Microsoft
                    Teams para captura de tela.
                  </div>
                )}
              </div>

              {/* Dispositivos detectados */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-secondary">
                    Dispositivos Detectados
                  </h3>
                  <button
                    onClick={refreshDevices}
                    disabled={isDetecting}
                    className="text-xs text-secondary hover:text-secondary/80 hover:underline disabled:opacity-50"
                  >
                    {isDetecting ? "Verificando..." : "Verificar novamente"}
                  </button>
                </div>

                <div className="space-y-2">
                  {/* Cameras — checkboxes when multiple, status when single */}
                  {isDetecting ? (
                    <DeviceStatus label="Câmera" detected={false} loading={true} />
                  ) : cameras.length === 0 ? (
                    <DeviceStatus label="Câmera" detected={false} loading={false} />
                  ) : cameras.length === 1 ? (
                    <DeviceStatus
                      label="Câmera"
                      detected={true}
                      name={cameras[0].label}
                      loading={false}
                    />
                  ) : (
                    <div className="rounded border border-border px-3 py-2">
                      <p className="mb-2 text-xs font-medium text-text-primary">
                        Câmeras{" "}
                        <span className="ml-1 text-text-muted">
                          ({selectedCameras.length} de {cameras.length} selecionada{selectedCameras.length !== 1 ? "s" : ""})
                        </span>
                      </p>
                      <div className="space-y-1.5">
                        {cameras.map((cam, index) => {
                          const isSelected = selectedCameras.includes(cam.deviceId);
                          const isLast = selectedCameras.length === 1 && isSelected;
                          return (
                            <button
                              key={cam.deviceId}
                              onClick={() => toggleCamera(cam.deviceId)}
                              disabled={isLast}
                              title={isLast ? "Pelo menos uma câmera deve estar selecionada" : undefined}
                              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                                isSelected
                                  ? "bg-primary/8 text-text-primary"
                                  : "text-text-muted hover:bg-bg-page hover:text-text-secondary"
                              } ${isLast ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                isSelected ? "border-primary bg-primary/20" : "border-border bg-transparent"
                              }`}>
                                {isSelected && (
                                  <svg className="h-2.5 w-2.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                  </svg>
                                )}
                              </span>
                              <span className="truncate">
                                {cam.label || `Câmera ${index + 1}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Microphone — radio selection when multiple, status when single */}
                  {isDetecting ? (
                    <DeviceStatus label="Microfone" detected={false} loading={true} />
                  ) : microphones.length === 0 ? (
                    <DeviceStatus label="Microfone" detected={false} loading={false} />
                  ) : microphones.length === 1 ? (
                    <DeviceStatus
                      label="Microfone"
                      detected={true}
                      name={microphones[0].label}
                      loading={false}
                    />
                  ) : (
                    <div className="rounded border border-border px-3 py-2">
                      <p className="mb-2 text-xs font-medium text-text-primary">
                        Microfone{" "}
                        <span className="ml-1 text-text-muted">
                          (selecione o microfone a usar)
                        </span>
                      </p>
                      <div className="space-y-1.5">
                        {microphones.map((mic, index) => {
                          const isSelected = selectedMicrophone === mic.deviceId;
                          return (
                            <button
                              key={mic.deviceId}
                              onClick={() => selectMicrophone(mic.deviceId)}
                              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                                isSelected
                                  ? "bg-primary/8 text-text-primary"
                                  : "text-text-muted hover:bg-bg-page hover:text-text-secondary"
                              }`}
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                isSelected ? "border-primary" : "border-border"
                              }`}>
                                {isSelected && (
                                  <span className="h-2 w-2 rounded-full bg-primary" />
                                )}
                              </span>
                              <span className="truncate">
                                {mic.label || `Microfone ${index + 1}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {deviceError && (
                  <p className="mt-2 text-xs text-error">{deviceError}</p>
                )}

                {!isDetecting && (!hasCameras || !hasMicrophones) && (
                  <div className="mt-3 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                    Conecte os dispositivos ausentes para iniciar a gravação.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-between border-t border-border pt-6">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>
              ← Voltar
            </Button>

            <button
              onClick={handleStartRecording}
              disabled={!devicesReady}
              className="inline-flex items-center gap-2 rounded-[4px] bg-[#b91c1c] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#991b1b] focus:outline-none focus:ring-2 focus:ring-error focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              Iniciar Gravação
              <span className="inline-block h-3 w-3 rounded-full bg-white/80" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const ModoCard = ({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`rounded-lg border-2 p-4 text-left transition-colors ${
      selected
        ? "border-primary bg-primary/5"
        : "border-border hover:border-border/80 hover:bg-bg-page"
    }`}
  >
    <div className="flex items-center gap-2">
      <div
        className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
          selected ? "border-primary" : "border-border"
        }`}
      >
        {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
      </div>
      <span className="text-sm font-semibold text-text-primary">{label}</span>
    </div>
    <p className="mt-1.5 pl-6 text-xs text-text-muted">{description}</p>
  </button>
);

const DeviceStatus = ({
  label,
  detected,
  name,
  loading,
}: {
  label: string;
  detected: boolean;
  name?: string;
  loading: boolean;
}) => (
  <div className="flex items-center gap-2 rounded border border-border px-3 py-2">
    {loading ? (
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-secondary" />
    ) : detected ? (
      <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    ) : (
      <svg className="h-4 w-4 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    )}
    <div className="flex-1">
      <span className="text-xs font-medium text-text-primary">{label}: </span>
      <span className={`text-xs ${detected ? "text-text-secondary" : "text-error"}`}>
        {loading
          ? "Detectando..."
          : detected
            ? name || "Detectado"
            : `${label} não detectado`}
      </span>
    </div>
  </div>
);
