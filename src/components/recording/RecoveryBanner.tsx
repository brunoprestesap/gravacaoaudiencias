"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useRecovery } from "@/hooks/useRecovery";
import { useToast } from "@/hooks/useToast";

export const RecoveryBanner = () => {
  const router = useRouter();
  const toast = useToast();
  const {
    hasInterruptedRecording,
    recoveryData,
    isLoading,
    isConsolidating,
    retomar,
    finalizar,
  } = useRecovery();

  if (isLoading || !hasInterruptedRecording || !recoveryData) return null;

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return min > 0 ? `${min}min ${sec}s` : `${sec}s`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleRetomar = () => {
    const gravacaoId = retomar();
    if (gravacaoId) {
      router.push(`/gravacao/${gravacaoId}`);
    }
  };

  const handleFinalizar = async () => {
    const success = await finalizar();
    if (success) {
      toast.success("Gravação finalizada e enviada com sucesso.");
    } else {
      toast.error("Erro ao consolidar/enviar gravação. Tente novamente.");
    }
  };

  return (
    <div className="rounded-lg border-l-4 border-yellow-500 bg-yellow-50 p-4 shadow-card">
      <div className="flex items-start gap-3">
        {/* Alert icon */}
        <div className="mt-0.5 shrink-0 text-yellow-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        <div className="flex-1">
          <h3 className="text-sm font-semibold text-yellow-800">
            Gravação interrompida detectada
          </h3>

          <div className="mt-2 space-y-1 text-sm text-yellow-700">
            <p>
              <span className="font-medium">Processo:</span>{" "}
              {recoveryData.metadata.numeroProcesso}
            </p>
            <p>
              <span className="font-medium">Modo:</span>{" "}
              {recoveryData.modo === "HIBRIDO" ? "Híbrido (Teams)" : "Presencial"}
            </p>
            <p>
              <span className="font-medium">Interrompida em:</span>{" "}
              {formatDate(recoveryData.lastChunkAt)}
            </p>
            <p>
              <span className="font-medium">Chunks preservados:</span>{" "}
              {recoveryData.chunkCount} ({formatBytes(recoveryData.totalBytes)})
            </p>
            <p>
              <span className="font-medium">Duração estimada:</span>{" "}
              {formatDuration(recoveryData.estimatedDurationMs)}
            </p>
          </div>

          <div className="mt-4 flex gap-3">
            <Button size="sm" onClick={handleRetomar} disabled={isConsolidating}>
              Retomar Gravação
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleFinalizar}
              disabled={isConsolidating}
            >
              {isConsolidating ? "Consolidando..." : "Finalizar com Chunks Disponíveis"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
