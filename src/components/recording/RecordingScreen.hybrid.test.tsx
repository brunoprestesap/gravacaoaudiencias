// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const destroy = vi.fn();
const beginNewSegment = vi.fn();
const combinedStream = { id: "combinado", getAudioTracks: () => [] };

vi.mock("@/lib/media-utils", () => ({
  combineStreams: () => ({ stream: combinedStream, canvas: {}, setLayout: vi.fn(), destroy }),
}));
vi.mock("@/hooks/useDeviceDetection", () => ({
  useDeviceDetection: () => ({
    selectedCamera: "cam",
    selectedMicrophone: "mic",
    selectedCameras: ["cam"],
    cameras: [],
    microphones: [],
    isDetecting: false,
    error: null,
    toggleCamera: vi.fn(),
  }),
}));
vi.mock("@/hooks/useChunkStorage", () => ({
  useChunkStorage: () => ({
    chunkCount: 0,
    totalBytes: 0,
    saveChunk: vi.fn(async () => {}),
    getAllChunks: vi.fn(async () => []),
    clearChunks: vi.fn(async () => {}),
    createRecoveryRecord: vi.fn(async () => {}),
    beginNewSegment,
    clearRecoveryRecord: vi.fn(async () => {}),
    error: null,
  }),
}));
const speech = {
  isSupported: false,
  unsupportedReason: "sem suporte",
  isRunning: false,
  interimText: "",
  finalSegments: [],
  transcriptText: "",
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
};
vi.mock("@/hooks/useSpeechRecognition", () => ({ useSpeechRecognition: () => speech }));
const toast = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() };
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
const emptyRef = { current: undefined };
const zeroRef = { current: 0 };
vi.mock("@/hooks/useAudioAnalyser", () => ({ useAudioAnalyser: () => emptyRef }));
vi.mock("@/hooks/useAudioLevel", () => ({ useAudioLevel: () => zeroRef }));
const flush = vi.fn(async () => true);
vi.mock("@/hooks/useLiveTranscription", () => ({ useLiveTranscription: () => ({ flush }) }));
vi.mock("@/hooks/useMultiCameraStream", () => ({
  useMultiCameraStream: () => ({
    combinedStream: null,
    start: vi.fn(),
    stop: vi.fn(),
    setLayout: vi.fn(),
  }),
}));

import { RecordingScreen } from "./RecordingScreen";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  onstop: (() => void) | null = null;
  ondataavailable = null;
  onerror = null;
  constructor(public stream: unknown) {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  }
}

describe("RecordingScreen híbrido: tela encerrada durante a gravação", () => {
  const cameraTrack = { stop: vi.fn() };
  const cameraStream = { id: "camera", getTracks: () => [cameraTrack], getAudioTracks: () => [] };
  const screenTrack: { stop: () => void; onended: (() => void) | null } = {
    stop: vi.fn(),
    onended: null,
  };

  const startAndEndScreenShare = async () => {
    render(
      <RecordingScreen
        gravacaoId="g1"
        metadata={{ numeroProcesso: "0001234-56.2026.4.01.3400" }}
        modo="HIBRIDO"
      />
    );
    fireEvent.click(screen.getByTitle("Iniciar Gravação"));
    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    expect(FakeRecorder.instances[0].stream).toBe(combinedStream);

    act(() => screenTrack.onended?.());
    await screen.findByText("Compartilhamento de tela interrompido");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    FakeRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => cameraStream),
        getDisplayMedia: vi.fn(async () => ({
          getVideoTracks: () => [screenTrack],
          getTracks: () => [screenTrack],
        })),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mantém câmera e microfone gravando enquanto o servidor decide", async () => {
    await startAndEndScreenShare();

    expect(destroy).not.toHaveBeenCalled();
    expect(FakeRecorder.instances[0].state).toBe("recording");
  });

  it("Retomar com Câmera inicia um novo segmento gravando a câmera", async () => {
    await startAndEndScreenShare();

    fireEvent.click(screen.getByRole("button", { name: "Retomar com Câmera" }));

    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(2));
    expect(FakeRecorder.instances[0].state).toBe("inactive");
    expect(FakeRecorder.instances[1].stream).toBe(cameraStream);
    expect(FakeRecorder.instances[1].state).toBe("recording");
    expect(beginNewSegment).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
