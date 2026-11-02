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
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
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

describe("useMediaRecorder: duração entre trechos", () => {
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  const startRecording = async (options: Partial<Parameters<typeof useMediaRecorder>[0]> = {}) => {
    const view = renderHook(() => useMediaRecorder({ onChunk: vi.fn(), ...options }));
    await act(() => view.result.current.start());
    return view;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => makeStream(makeTrack("audio"), makeTrack("video"))),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("soma os trechos e ignora o tempo em que nada foi gravado", async () => {
    const { result } = await startRecording();
    advance(10_000);

    await act(() => result.current.stop());
    expect(result.current.elapsedMs).toBe(10_000);

    advance(60_000);
    await act(() => result.current.start());
    expect(result.current.elapsedMs).toBe(10_000);

    advance(5_000);
    expect(result.current.elapsedMs).toBe(15_000);
  });

  it("guarda o trecho quando o gravador para sozinho", async () => {
    const { result } = await startRecording();
    advance(8_000);

    act(() => {
      FakeRecorder.instances[0].state = "inactive";
      FakeRecorder.instances[0].onstop?.();
    });
    advance(30_000);
    await act(() => result.current.start());
    advance(2_000);

    expect(result.current.elapsedMs).toBe(10_000);
  });

  it("não conta duas vezes um trecho encerrado durante a pausa", async () => {
    const { result } = await startRecording();
    advance(4_000);
    act(() => result.current.pause());
    advance(10_000);

    await act(() => result.current.stop());
    await act(() => result.current.start());
    advance(1_000);

    expect(result.current.elapsedMs).toBe(5_000);
  });

  it("parte do que já estava gravado antes de recarregar a tela", async () => {
    const view = renderHook(() =>
      useMediaRecorder({ onChunk: vi.fn(), priorElapsedMs: 30_000 })
    );
    expect(view.result.current.elapsedMs).toBe(30_000);

    await act(() => view.result.current.start());
    advance(2_000);

    expect(view.result.current.elapsedMs).toBe(32_000);
  });

  it("não perde o tempo anterior se ele chegar depois de começar", async () => {
    const view = renderHook(
      ({ priorElapsedMs }) => useMediaRecorder({ onChunk: vi.fn(), priorElapsedMs }),
      { initialProps: { priorElapsedMs: 0 } }
    );
    await act(() => view.result.current.start());
    advance(2_000);

    view.rerender({ priorElapsedMs: 30_000 });

    expect(view.result.current.elapsedMs).toBe(32_000);
  });
});
