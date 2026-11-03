import type { ChunkRecord, ModoGravacao, ProcessMetadata } from "@/types/recording";
import { PROCESSO_REGEX } from "@/types/metadata";

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
    qualityReduced: boolean;
    maxHeight: number | null;
  } | null;
  warning?: string | null;
  pje?: {
    maxBytes: number;
    apto: boolean;
  };
}

/**
 * Cria o registro da gravação no servidor. Lança erro se não conseguir.
 */
export async function createGravacaoRecord(
  gravacaoId: string,
  metadata: ProcessMetadata,
  modo: ModoGravacao
): Promise<void> {
  const res = await fetch("/api/gravacoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: gravacaoId, metadata, modo }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao criar o registro da gravação (status ${res.status}).`);
  }
}

/**
 * Garante que o registro existe antes do upload. A gravação pode ter começado com o
 * servidor fora do ar, e sem o registro o upload responderia 404 para sempre.
 */
export async function ensureGravacaoRecord(
  gravacaoId: string,
  metadata: ProcessMetadata,
  modo: ModoGravacao
): Promise<void> {
  const res = await fetch(`/api/gravacoes/${encodeURIComponent(gravacaoId)}`);
  if (res.ok) return;
  if (res.status !== 404) {
    throw new Error(`Falha ao consultar o registro da gravação (status ${res.status}).`);
  }
  // A tela de retomada usa um número provisório enquanto carrega os dados locais.
  if (!PROCESSO_REGEX.test(metadata.numeroProcesso)) {
    throw new Error("Dados do processo indisponíveis para criar o registro da gravação.");
  }
  await createGravacaoRecord(gravacaoId, metadata, modo);
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
 * Tenta converter de novo o WebM guardado no servidor depois de uma conversão que falhou.
 * Retorna `null` quando não há nada guardado para esse tamanho, e aí é preciso enviar.
 * Depois de uma falha aqui, o servidor deixa de oferecer esse arquivo, então a tentativa
 * seguinte cai no envio completo.
 */
export async function retryPendingConversion(
  gravacaoId: string,
  inputBytes: number,
  duracao?: number
): Promise<UploadResult | null> {
  const formData = new FormData();
  formData.append("mode", "retryConversion");
  formData.append("gravacaoId", gravacaoId);
  formData.append("inputBytes", String(inputBytes));
  if (duracao) {
    formData.append("duracao", String(Math.round(duracao)));
  }

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error((await res.text()) || `Conversão falhou com status ${res.status}`);
  }
  return (await res.json()) as UploadResult;
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

  const inputBytes = segments.reduce((sum, segment) => sum + segment.size, 0);
  const retried = await retryPendingConversion(gravacaoId, inputBytes, options?.duracao);
  if (retried) return retried;

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
