import type { ChunkRecord } from "@/types/recording";

export interface UploadResult {
  success: boolean;
  filePath: string;
  fileSize: number;
  encoding?: {
    inputBitrateKbps: number | null;
    targetVideoKbps: number;
    audioKbps: number;
    durationSeconds: number;
    inputBytes: number;
    outputBytes: number;
  } | null;
  warning?: string | null;
  pje?: {
    maxBytes: number;
    apto: boolean;
  };
}

/**
 * Concatena chunks ordenados por chunkIndex em um único Blob video/webm.
 */
export function consolidateChunks(chunks: ChunkRecord[]): Blob {
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  return new Blob(
    sorted.map((c) => c.data),
    { type: "video/webm" }
  );
}

/**
 * Faz upload do Blob consolidado para o servidor via /api/upload.
 * Suporta callback de progresso via XMLHttpRequest.
 */
export async function uploadConsolidated(
  gravacaoId: string,
  blob: Blob,
  options?: {
    duracao?: number;
    onProgress?: (percent: number) => void;
  }
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", blob, `${gravacaoId}.webm`);
  formData.append("gravacaoId", gravacaoId);
  if (options?.duracao) {
    formData.append("duracao", String(Math.round(options.duracao)));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && options?.onProgress) {
        options.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          reject(new Error("Resposta inválida do servidor."));
        }
      } else {
        reject(new Error(xhr.responseText || `Upload falhou com status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Falha na conexão durante o upload."));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelado."));
    });

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  });
}

/**
 * Faz upload dos segmentos de recuperação para remux no backend.
 * Cada segmento deve ser um WebM válido (ex.: uma sessão de gravação).
 */
export async function uploadRecoverySegments(
  gravacaoId: string,
  segments: Blob[],
  options?: {
    duracao?: number;
    onProgress?: (percent: number) => void;
  }
): Promise<UploadResult> {
  if (segments.length === 0) {
    throw new Error("Nenhum segmento disponível para upload.");
  }

  const formData = new FormData();
  formData.append("mode", "recoverySegments");
  formData.append("gravacaoId", gravacaoId);
  if (options?.duracao) {
    formData.append("duracao", String(Math.round(options.duracao)));
  }

  segments.forEach((segment, index) => {
    const paddedIndex = String(index).padStart(6, "0");
    formData.append("segments", segment, `segment-${paddedIndex}.webm`);
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && options?.onProgress) {
        options.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          reject(new Error("Resposta inválida do servidor."));
        }
      } else {
        reject(new Error(xhr.responseText || `Upload falhou com status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Falha na conexão durante o upload de recuperação."));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload de recuperação cancelado."));
    });

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  });
}
