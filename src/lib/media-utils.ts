import type { ChunkRecord } from "@/types/recording";
import type { HybridLayout } from "@/types/recording";

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
): Promise<{ success: boolean; filePath: string; fileSize: number }> {
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
          resolve(JSON.parse(xhr.responseText));
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

// ─── Canvas Stream Combiner ───────────────────────────────────────────────────

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const PIP_WIDTH = 320;
const PIP_HEIGHT = 180;
const PIP_MARGIN = 16;
const DIVIDER_WIDTH = 4;
const FPS = 30;
const CROSSFADE_DURATION_MS = 300;

export interface CombinedStreamHandle {
  /** The combined MediaStream (video from canvas + mixed audio) to feed into MediaRecorder */
  stream: MediaStream;
  /** The canvas element used for preview (attach to a <video> or use directly) */
  canvas: HTMLCanvasElement;
  /** Update the layout at runtime */
  setLayout: (layout: HybridLayout) => void;
  /** Stop drawing loop and release resources */
  destroy: () => void;
}

/**
 * Combines a camera stream and a screen capture stream into one
 * using an offscreen Canvas for video and AudioContext for audio mixing.
 */
export function combineStreams(
  cameraStream: MediaStream,
  screenStream: MediaStream,
  initialLayout: HybridLayout = "pip"
): CombinedStreamHandle {
  // ── Canvas setup ──────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // Hidden <video> elements to draw frames from
  const cameraVideo = document.createElement("video");
  cameraVideo.srcObject = cameraStream;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  cameraVideo.play();

  const screenVideo = document.createElement("video");
  screenVideo.srcObject = screenStream;
  screenVideo.muted = true;
  screenVideo.playsInline = true;
  screenVideo.play();

  // ── Layout state ──────────────────────────────────────────────────────────
  let currentLayout: HybridLayout = initialLayout;
  let targetLayout: HybridLayout = initialLayout;
  let transitionProgress = 1; // 1 = fully transitioned
  let transitionStart = 0;
  let destroyed = false;

  const setLayout = (layout: HybridLayout) => {
    if (layout === currentLayout && transitionProgress >= 1) return;
    targetLayout = layout;
    transitionProgress = 0;
    transitionStart = performance.now();
  };

  // ── Drawing functions ─────────────────────────────────────────────────────

  function drawPip(alpha: number) {
    ctx.globalAlpha = alpha;
    // Screen as main
    ctx.drawImage(screenVideo, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    // Camera as PiP in bottom-right
    const pipX = CANVAS_WIDTH - PIP_WIDTH - PIP_MARGIN;
    const pipY = CANVAS_HEIGHT - PIP_HEIGHT - PIP_MARGIN;
    // PiP border
    ctx.fillStyle = "#1B3A5C";
    ctx.fillRect(pipX - 2, pipY - 2, PIP_WIDTH + 4, PIP_HEIGHT + 4);
    ctx.drawImage(cameraVideo, pipX, pipY, PIP_WIDTH, PIP_HEIGHT);
    ctx.globalAlpha = 1;
  }

  function drawSideBySide(alpha: number) {
    ctx.globalAlpha = alpha;
    const halfWidth = (CANVAS_WIDTH - DIVIDER_WIDTH) / 2;
    // Camera on left
    ctx.drawImage(cameraVideo, 0, 0, halfWidth, CANVAS_HEIGHT);
    // Divider
    ctx.fillStyle = "#1B3A5C";
    ctx.fillRect(halfWidth, 0, DIVIDER_WIDTH, CANVAS_HEIGHT);
    // Screen on right
    ctx.drawImage(screenVideo, halfWidth + DIVIDER_WIDTH, 0, halfWidth, CANVAS_HEIGHT);
    ctx.globalAlpha = 1;
  }

  function drawTabs(alpha: number, showCamera: boolean) {
    ctx.globalAlpha = alpha;
    if (showCamera) {
      ctx.drawImage(cameraVideo, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      ctx.drawImage(screenVideo, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    ctx.globalAlpha = 1;
  }

  // For tabs mode we default to showing screen (the "active tab" is managed
  // by the UI component; here we just draw whichever tab is active)
  let activeTab: "camera" | "screen" = "screen";

  function drawLayout(layout: HybridLayout, alpha: number) {
    switch (layout) {
      case "pip":
        drawPip(alpha);
        break;
      case "side-by-side":
        drawSideBySide(alpha);
        break;
      case "tabs":
        drawTabs(alpha, activeTab === "camera");
        break;
    }
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  let rafId: number;

  function draw() {
    if (destroyed) return;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (transitionProgress < 1) {
      const elapsed = performance.now() - transitionStart;
      transitionProgress = Math.min(elapsed / CROSSFADE_DURATION_MS, 1);
      const ease = transitionProgress; // linear is fine for 300ms

      // Crossfade: draw old layout fading out, new layout fading in
      drawLayout(currentLayout, 1 - ease);
      drawLayout(targetLayout, ease);

      if (transitionProgress >= 1) {
        currentLayout = targetLayout;
      }
    } else {
      drawLayout(currentLayout, 1);
    }

    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);

  // ── Audio mixing ──────────────────────────────────────────────────────────
  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  const cameraAudioTracks = cameraStream.getAudioTracks();
  if (cameraAudioTracks.length > 0) {
    const cameraAudioStream = new MediaStream(cameraAudioTracks);
    const cameraSource = audioCtx.createMediaStreamSource(cameraAudioStream);
    cameraSource.connect(destination);
  }

  const screenAudioTracks = screenStream.getAudioTracks();
  if (screenAudioTracks.length > 0) {
    const screenAudioStream = new MediaStream(screenAudioTracks);
    const screenSource = audioCtx.createMediaStreamSource(screenAudioStream);
    screenSource.connect(destination);
  }

  // ── Combined stream ───────────────────────────────────────────────────────
  const canvasStream = canvas.captureStream(FPS);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  // ── Public handle ─────────────────────────────────────────────────────────
  return {
    stream: combinedStream,
    canvas,
    setLayout: (layout: HybridLayout) => {
      setLayout(layout);
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(rafId);
      audioCtx.close().catch(() => {});
      cameraVideo.srcObject = null;
      screenVideo.srcObject = null;
    },
    // Expose for tabs mode: allow switching active tab
    set activeTab(tab: "camera" | "screen") {
      activeTab = tab;
    },
    get activeTab() {
      return activeTab;
    },
  } as CombinedStreamHandle & { activeTab: "camera" | "screen" };
}
