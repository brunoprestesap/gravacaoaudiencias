import type { HybridLayout, MultiCameraLayout } from "@/types/recording";
import { RECORDING, HYBRID_CANVAS, MULTI_CAMERA_CANVAS } from "@/lib/constants";

// ─── Multi-Camera Stream Combiner ────────────────────────────────────────────

export interface MultiCameraStreamHandle {
  stream: MediaStream;
  canvas: HTMLCanvasElement;
  setLayout: (layout: MultiCameraLayout) => void;
  destroy: () => void;
}

/**
 * Combines N camera streams into one using an offscreen Canvas.
 * Supports side-by-side, stacked, grid and main-pip layouts with crossfade transitions.
 * @param cameraStreams  Video-only streams, one per camera
 * @param micStream     Audio-only stream for the microphone (may be null)
 */
export function combineMultipleCameraStreams(
  cameraStreams: MediaStream[],
  micStream: MediaStream | null,
  initialLayout: MultiCameraLayout = "side-by-side"
): MultiCameraStreamHandle {
  const W = RECORDING.RECORD_WIDTH;
  const H = RECORDING.RECORD_HEIGHT;
  const FPS = RECORDING.RECORD_FPS;
  const { PIP_WIDTH, PIP_HEIGHT, PIP_MARGIN, BORDER_WIDTH, DIVIDER_WIDTH } = MULTI_CAMERA_CANVAS;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Hidden <video> elements to render frames from each camera
  const videos = cameraStreams.map((stream) => {
    const v = document.createElement("video");
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    v.play();
    return v;
  });

  const N = videos.length;

  // ── Layout state ────────────────────────────────────────────────────────────
  let currentLayout: MultiCameraLayout = initialLayout;
  let destroyed = false;

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  /**
   * Draws a video into the given cell preserving its natural aspect ratio (object-fit: contain).
   * The area not covered by the video is filled with black.
   */
  function drawCell(video: HTMLVideoElement, x: number, y: number, w: number, h: number) {
    // Fill cell background
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);

    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const scale = Math.min(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);
  }

  function drawDividerH(x: number) {
    ctx.fillStyle = "#0a0f1e";
    ctx.fillRect(x, 0, DIVIDER_WIDTH, H);
  }

  function drawDividerV(y: number) {
    ctx.fillStyle = "#0a0f1e";
    ctx.fillRect(0, y, W, DIVIDER_WIDTH);
  }

  function drawSideBySide() {
    const cellW = Math.floor((W - DIVIDER_WIDTH * (N - 1)) / N);
    for (let i = 0; i < N; i++) {
      const x = i * (cellW + DIVIDER_WIDTH);
      drawCell(videos[i], x, 0, cellW, H);
      if (i < N - 1) drawDividerH(x + cellW);
    }
  }

  function drawStacked() {
    const cellH = Math.floor((H - DIVIDER_WIDTH * (N - 1)) / N);
    for (let i = 0; i < N; i++) {
      const y = i * (cellH + DIVIDER_WIDTH);
      drawCell(videos[i], 0, y, W, cellH);
      if (i < N - 1) drawDividerV(y + cellH);
    }
  }

  function drawGrid() {
    const cols = Math.ceil(Math.sqrt(N));
    const rows = Math.ceil(N / cols);
    const cellW = Math.floor((W - DIVIDER_WIDTH * (cols - 1)) / cols);
    const cellH = Math.floor((H - DIVIDER_WIDTH * (rows - 1)) / rows);
    for (let i = 0; i < N; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawCell(videos[i], col * (cellW + DIVIDER_WIDTH), row * (cellH + DIVIDER_WIDTH), cellW, cellH);
    }
    for (let c = 1; c < cols; c++) drawDividerH(c * (cellW + DIVIDER_WIDTH) - DIVIDER_WIDTH);
    for (let r = 1; r < rows; r++) drawDividerV(r * (cellH + DIVIDER_WIDTH) - DIVIDER_WIDTH);
  }

  function drawMainPip() {
    drawCell(videos[0], 0, 0, W, H);
    for (let i = 1; i < N; i++) {
      const pipX = W - PIP_WIDTH - PIP_MARGIN - (i - 1) * (PIP_WIDTH + PIP_MARGIN);
      const pipY = H - PIP_HEIGHT - PIP_MARGIN;
      if (pipX < 0) break;
      ctx.fillStyle = "#1B3A5C";
      ctx.fillRect(pipX - BORDER_WIDTH, pipY - BORDER_WIDTH, PIP_WIDTH + BORDER_WIDTH * 2, PIP_HEIGHT + BORDER_WIDTH * 2);
      drawCell(videos[i], pipX, pipY, PIP_WIDTH, PIP_HEIGHT);
    }
  }

  function drawLayout(layout: MultiCameraLayout) {
    switch (layout) {
      case "side-by-side": drawSideBySide(); break;
      case "stacked":      drawStacked();    break;
      case "grid":         drawGrid();       break;
      case "main-pip":     drawMainPip();    break;
    }
  }

  // ── Audio ───────────────────────────────────────────────────────────────────
  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  if (micStream) {
    const micAudioTracks = micStream.getAudioTracks();
    if (micAudioTracks.length > 0) {
      const source = audioCtx.createMediaStreamSource(new MediaStream(micAudioTracks));
      source.connect(destination);
    }
  }

  // ── Canvas capture stream ────────────────────────────────────────────────────
  // captureStream(0): frames are sent only via explicit requestFrame() calls,
  // giving us full control over what gets recorded.
  const canvasStream = canvas.captureStream(0);
  const captureTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

  // ── Combined stream ─────────────────────────────────────────────────────────
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  // ── Draw + capture ───────────────────────────────────────────────────────────
  // setInterval ensures the draw loop keeps running even when the tab is hidden.
  // requestFrame() explicitly pushes each drawn frame into the MediaRecorder.
  let intervalId: ReturnType<typeof setInterval>;

  function drawAndCapture() {
    if (destroyed) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    drawLayout(currentLayout);
    captureTrack.requestFrame();
  }

  intervalId = setInterval(drawAndCapture, 1000 / FPS);

  // ── setLayout: update variable + push an immediate frame into the recording ──
  const setLayout = (layout: MultiCameraLayout) => {
    currentLayout = layout;
    // Draw and push a frame immediately so the change appears in the recording
    // without waiting for the next interval tick.
    drawAndCapture();
  };

  return {
    stream: combined,
    canvas,
    setLayout,
    destroy: () => {
      destroyed = true;
      clearInterval(intervalId);
      audioCtx.close().catch(() => {});
      videos.forEach((v) => { v.srcObject = null; });
    },
  };
}

// ─── Canvas Stream Combiner ───────────────────────────────────────────────────

const CANVAS_WIDTH = RECORDING.RECORD_WIDTH;
const CANVAS_HEIGHT = RECORDING.RECORD_HEIGHT;
const FPS = RECORDING.RECORD_FPS;

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
    const pipX = CANVAS_WIDTH - HYBRID_CANVAS.PIP_WIDTH - HYBRID_CANVAS.PIP_MARGIN;
    const pipY = CANVAS_HEIGHT - HYBRID_CANVAS.PIP_HEIGHT - HYBRID_CANVAS.PIP_MARGIN;
    // PiP border
    ctx.fillStyle = "#1B3A5C";
    ctx.fillRect(pipX - 2, pipY - 2, HYBRID_CANVAS.PIP_WIDTH + 4, HYBRID_CANVAS.PIP_HEIGHT + 4);
    ctx.drawImage(cameraVideo, pipX, pipY, HYBRID_CANVAS.PIP_WIDTH, HYBRID_CANVAS.PIP_HEIGHT);
    ctx.globalAlpha = 1;
  }

  function drawSideBySide(alpha: number) {
    ctx.globalAlpha = alpha;
    const halfWidth = (CANVAS_WIDTH - HYBRID_CANVAS.DIVIDER_WIDTH) / 2;
    // Camera on left
    ctx.drawImage(cameraVideo, 0, 0, halfWidth, CANVAS_HEIGHT);
    // Divider
    ctx.fillStyle = "#1B3A5C";
    ctx.fillRect(halfWidth, 0, HYBRID_CANVAS.DIVIDER_WIDTH, CANVAS_HEIGHT);
    // Screen on right
    ctx.drawImage(screenVideo, halfWidth + HYBRID_CANVAS.DIVIDER_WIDTH, 0, halfWidth, CANVAS_HEIGHT);
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
      transitionProgress = Math.min(elapsed / HYBRID_CANVAS.CROSSFADE_DURATION_MS, 1);
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
