// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaRecorder } from "./useMediaRecorder";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  onstop: (() => void) | null = null;
  ondataavailable = null;
  onerror = null;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

const makeTrack = (kind: "audio" | "video") =>
  Object.assign(new EventTarget(), { kind, stop: vi.fn() });

const makeStream = (...tracks: ReturnType<typeof makeTrack>[]) =>
  ({ getTracks: () => tracks }) as unknown as MediaStream;

describe("useMediaRecorder: queda de dispositivo", () => {
  const onDeviceLost = vi.fn();
  let audio: ReturnType<typeof makeTrack>;
  let video: ReturnType<typeof makeTrack>;

  const startRecording = async (options: Partial<Parameters<typeof useMediaRecorder>[0]> = {}) => {
    const view = renderHook(() => useMediaRecorder({ onChunk: vi.fn(), onDeviceLost, ...options }));
    await act(() => view.result.current.start());
    return view;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    FakeRecorder.instances = [];
    audio = makeTrack("audio");
    video = makeTrack("video");
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => makeStream(audio, video)) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["audio", "video"])("avisa quando só a trilha %s cai e segue gravando o resto", async (kind) => {
    const { result } = await startRecording();

    act(() => {
      (kind === "audio" ? audio : video).dispatchEvent(new Event("ended"));
    });

    expect(onDeviceLost).toHaveBeenCalledWith(kind);
    expect(result.current.status).toBe("recording");
    expect(FakeRecorder.instances[0].state).toBe("recording");
  });

  it("marca como parada e avisa quando o gravador para sozinho", async () => {
    const { result } = await startRecording();

    act(() => {
      FakeRecorder.instances[0].state = "inactive";
      FakeRecorder.instances[0].onstop?.();
    });

    expect(onDeviceLost).toHaveBeenCalledWith("all");
    expect(result.current.status).toBe("stopped");
    expect(result.current.stream).toBeNull();
  });

  it("para o timer quando o gravador para sozinho", async () => {
    vi.useFakeTimers();
    try {
      const { result } = await startRecording();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const elapsed = result.current.elapsedMs;
      act(() => {
        FakeRecorder.instances[0].state = "inactive";
        FakeRecorder.instances[0].onstop?.();
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current.elapsedMs).toBe(elapsed);
    } finally {
      vi.useRealTimers();
    }
  });

  it("vigia também as fontes de um stream composto", async () => {
    const sourceMic = makeTrack("audio");
    await startRecording({
      externalStream: makeStream(makeTrack("video")),
      monitoredStreams: [makeStream(sourceMic)],
    });

    act(() => {
      sourceMic.dispatchEvent(new Event("ended"));
    });

    expect(onDeviceLost).toHaveBeenCalledWith("audio");
  });

  it("não avisa quando o encerramento foi pedido pelo usuário", async () => {
    const { result } = await startRecording();

    await act(() => result.current.stop());
    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });

    expect(result.current.status).toBe("stopped");
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("não avisa ao desmontar a tela", async () => {
    const { unmount } = await startRecording();

    unmount();
    audio.dispatchEvent(new Event("ended"));

    expect(onDeviceLost).not.toHaveBeenCalled();
  });
});
