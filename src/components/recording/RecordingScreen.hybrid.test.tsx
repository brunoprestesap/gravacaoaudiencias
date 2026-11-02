// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const destroy = vi.fn();
const beginNewSegment = vi.fn();
const combinedStream = { id: "combinado", getAudioTracks: () => [], getTracks: () => [] };
const createRecoveryRecord = vi.fn(async () => {});
const multiCamera = {
  combinedStream: null as unknown,
  sourceStreams: [] as unknown[],
  start: vi.fn(),
  stop: vi.fn(),
  setLayout: vi.fn(),
};

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
    chunkCount: 2,
    totalBytes: 0,
    saveChunk: vi.fn(async () => {}),
    getAllChunks: vi.fn(async () => []),
    clearChunks: vi.fn(async () => {}),
    createRecoveryRecord,
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
  useMultiCameraStream: () => multiCamera,
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
  const cameraTrack = Object.assign(new EventTarget(), { kind: "video", stop: vi.fn() });
  const micTrack = Object.assign(new EventTarget(), { kind: "audio", stop: vi.fn() });
  const cameraStream = {
    id: "camera",
    getTracks: () => [cameraTrack, micTrack],
    getAudioTracks: () => [],
  };
  const screenTrack: { stop: () => void; onended: (() => void) | null } = {
    stop: vi.fn(),
    onended: null,
  };

  const renderHybrid = () =>
    render(
      <RecordingScreen
        gravacaoId="g1"
        metadata={{ numeroProcesso: "0001234-56.2026.4.01.3400" }}
        modo="HIBRIDO"
      />
    );

  const startAndEndScreenShare = async () => {
    renderHybrid();
    fireEvent.click(screen.getByTitle("Iniciar Gravação"));
    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    expect(FakeRecorder.instances[0].stream).toBe(combinedStream);

    act(() => screenTrack.onended?.());
    await screen.findByText("Compartilhamento de tela interrompido");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createRecoveryRecord.mockImplementation(async () => {});
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
    expect(beginNewSegment).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("começa a gravar mesmo quando salvar o registro de recuperação demora", async () => {
    createRecoveryRecord.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50))
    );
    renderHybrid();

    fireEvent.click(screen.getByTitle("Iniciar Gravação"));

    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    expect(FakeRecorder.instances[0].stream).toBe(combinedStream);
  });

  it("avisa quando o microfone da composição cai e permite retomar", async () => {
    renderHybrid();
    fireEvent.click(screen.getByTitle("Iniciar Gravação"));
    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));

    act(() => {
      micTrack.dispatchEvent(new Event("ended"));
    });

    await screen.findByText("Microfone desconectado");
    expect(FakeRecorder.instances[0].state).toBe("recording");

    fireEvent.click(screen.getByRole("button", { name: "Retomar" }));

    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(2));
    expect(FakeRecorder.instances[0].state).toBe("inactive");
    expect(FakeRecorder.instances[1].state).toBe("recording");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(beginNewSegment).toHaveBeenCalled();
  });
});

describe("RecordingScreen presencial: queda de dispositivo", () => {
  const track = (kind: string) => Object.assign(new EventTarget(), { kind, stop: vi.fn() });

  const renderPresencial = async () => {
    const video = track("video");
    const audio = track("audio");
    const stream = { getTracks: () => [video, audio], getAudioTracks: () => [] };
    FakeRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    render(
      <RecordingScreen
        gravacaoId="g1"
        metadata={{ numeroProcesso: "0001234-56.2026.4.01.3400" }}
        modo="PRESENCIAL"
      />
    );
    fireEvent.click(screen.getByTitle("Iniciar Gravação"));
    await waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    return { video, audio };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("deixa claro que a gravação segue sem áudio", async () => {
    const { audio } = await renderPresencial();

    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });

    await screen.findByText("Microfone desconectado");
    expect(screen.getByText(/sem áudio/i)).toBeTruthy();
  });

  it("deixa claro que a gravação parou quando tudo cai e ainda permite encerrar", async () => {
    await renderPresencial();

    act(() => {
      FakeRecorder.instances[0].state = "inactive";
      FakeRecorder.instances[0].onstop?.();
    });

    await screen.findByText("Câmera e microfone desconectados");
    fireEvent.click(screen.getByRole("button", { name: "Encerrar Gravação" }));

    await screen.findByText("Encerrar Gravação", { selector: "h2" });
  });

  it("oferece encerrar depois que a gravação parou, sem perder os chunks", async () => {
    await renderPresencial();

    act(() => {
      FakeRecorder.instances[0].state = "inactive";
      FakeRecorder.instances[0].onstop?.();
    });
    await screen.findByText("Câmera e microfone desconectados");
    fireEvent.click(screen.getByRole("button", { name: "Encerrar Gravação" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByTitle("Encerrar")).toBeTruthy();
  });
});
