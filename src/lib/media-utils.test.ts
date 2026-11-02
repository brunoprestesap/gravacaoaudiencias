// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combineMultipleCameraStreams, combineStreams } from "./media-utils";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
}

const fakeStream = () =>
  ({ getAudioTracks: () => [], getVideoTracks: () => [] }) as unknown as MediaStream;

const combiners = [
  ["híbrido", () => combineStreams(fakeStream(), fakeStream(), "pip")],
  ["multicâmera", () => combineMultipleCameraStreams([fakeStream(), fakeStream()], null, "grid")],
] as const;

describe.each(combiners)("composição de vídeo: %s", (_name, combine) => {
  const drawImage = vi.fn();
  const requestFrame = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    vi.useFakeTimers();

    // Aba oculta: o navegador não dispara requestAnimationFrame.
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("MediaStream", class {
      getAudioTracks = () => [];
      getVideoTracks = () => [];
    });
    vi.stubGlobal("AudioContext", class {
      createMediaStreamDestination = () => ({ stream: fakeStream() });
      close = async () => {};
    });
    URL.createObjectURL = vi.fn(() => "blob:ticker");
    URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage,
      fillRect: vi.fn(),
    })) as never;
    HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({
      getVideoTracks: () => [{ requestFrame }],
    })) as never;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("publica quadros novos com a aba oculta, a cada aviso do worker", () => {
    combine();
    const worker = FakeWorker.instances[0];

    worker.onmessage?.();
    worker.onmessage?.();

    expect(drawImage).toHaveBeenCalled();
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("captura só os quadros pedidos, para o vídeo não depender do ritmo da aba", () => {
    combine();

    expect(HTMLCanvasElement.prototype.captureStream).toHaveBeenCalledWith(0);
  });

  it("encerra o worker e para de desenhar no destroy", () => {
    const handle = combine();
    const worker = FakeWorker.instances[0];

    handle.destroy();
    requestFrame.mockClear();
    worker.onmessage?.();

    expect(worker.terminated).toBe(true);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("usa setInterval quando o worker falha ao carregar", () => {
    const handle = combine();
    const worker = FakeWorker.instances[0];

    worker.onerror?.();
    vi.advanceTimersByTime(1000);

    expect(worker.terminated).toBe(true);
    expect(requestFrame).toHaveBeenCalled();

    handle.destroy();
    requestFrame.mockClear();
    vi.advanceTimersByTime(1000);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("usa setInterval quando o worker não pode ser criado", () => {
    vi.stubGlobal("Worker", class {
      constructor() {
        throw new Error("bloqueado");
      }
    });

    const handle = combine();
    vi.advanceTimersByTime(1000);
    expect(requestFrame).toHaveBeenCalled();

    handle.destroy();
    requestFrame.mockClear();
    vi.advanceTimersByTime(1000);
    expect(requestFrame).not.toHaveBeenCalled();
  });
});
