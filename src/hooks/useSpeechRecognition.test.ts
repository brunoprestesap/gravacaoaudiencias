// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "./useSpeechRecognition";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  start = vi.fn();
  stop = vi.fn();
  onend = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

describe("useSpeechRecognition", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("não derruba o reconhecimento quando as opções mudam a cada render", () => {
    const { result, rerender } = renderHook(
      ({ numero }) =>
        useSpeechRecognition({
          getVoiceFeatures: () => undefined,
          onError: () => {},
          processMetadata: { numeroProcesso: numero },
        }),
      { initialProps: { numero: "provisorio" } }
    );

    act(() => {
      result.current.start();
    });
    rerender({ numero: "0001234-56.2026.4.01.3400" });

    expect(FakeRecognition.instances).toHaveLength(1);
    expect(FakeRecognition.instances[0].start).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.instances[0].stop).not.toHaveBeenCalled();
  });

  it("desligado: nem cria o reconhecedor nem inicia", () => {
    const { result } = renderHook(() => useSpeechRecognition({ enabled: false }));

    let started = true;
    act(() => {
      started = result.current.start();
    });

    expect(started).toBe(false);
    expect(result.current.isSupported).toBe(false);
    expect(result.current.unsupportedReason).toBeNull();
    expect(FakeRecognition.instances).toHaveLength(0);
  });
});
