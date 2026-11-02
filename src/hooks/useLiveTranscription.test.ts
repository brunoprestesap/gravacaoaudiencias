// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechSegment } from "./useSpeechRecognition";
import { useLiveTranscription } from "./useLiveTranscription";

const segment = (id: string): SpeechSegment => ({
  id,
  text: `fala ${id}`,
  offsetMs: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  role: "DESCONHECIDO",
  confidence: 0.28,
});

describe("useLiveTranscription", () => {
  const fetchMock = vi.fn();
  const ok = () => Promise.resolve(new Response("{}", { status: 200 }));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockImplementation(ok);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("envia a cada 4 s mesmo com a tela renderizando o tempo todo", async () => {
    const { rerender } = renderHook(
      ({ segments }) => useLiveTranscription("g1", segments, true),
      { initialProps: { segments: [segment("a")] } }
    );

    for (let i = 0; i < 25; i += 1) {
      await act(() => vi.advanceTimersByTimeAsync(200));
      rerender({ segments: [segment("a")] });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não envia o papel inferido no navegador: quem decide é o servidor", async () => {
    const { result } = renderHook(() => useLiveTranscription("g1", [segment("a")], false));

    await act(() => result.current.flush({ force: true }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).segments[0];
    expect(sent).not.toHaveProperty("role");
    expect(sent).not.toHaveProperty("confidence");
  });

  it("nunca sobrepõe dois envios, que apagariam segmentos no servidor", async () => {
    let release = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Response("{}", { status: 200 }));
        })
    );
    const { result, rerender } = renderHook(
      ({ segments }) => useLiveTranscription("g1", segments, false),
      { initialProps: { segments: [segment("a")] } }
    );

    let first: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      first = result.current.flush({ force: true });
    });
    rerender({ segments: [segment("a"), segment("b")] });
    let second: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      second = result.current.flush({ force: true, isFinal: true });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await first;
      await second;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.isFinal).toBe(true);
    expect(body.segments.map((s: { id: string }) => s.id)).toEqual(["b"]);
  });
});
