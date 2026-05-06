// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTermoAutoSave } from "./useTermoAutoSave";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

const okResponse = { ok: true } as Response;
const failResponse = { ok: false, status: 500 } as Response;

describe("useTermoAutoSave", () => {
  it("começa em estado idle", () => {
    const { result } = renderHook(() => useTermoAutoSave("g1"));
    expect(result.current.saveState).toBe("idle");
  });

  it("transita para saving ao agendar e para saved após PATCH ok", async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { result } = renderHook(() => useTermoAutoSave("g1"));

    act(() => result.current.scheduleSave("# texto"));
    expect(result.current.saveState).toBe("saving");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.saveState).toBe("saved");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.saveState).toBe("idle");
  });

  it("envia PATCH com método e body corretos", async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { result } = renderHook(() => useTermoAutoSave("grav-42"));

    act(() => result.current.scheduleSave("# editado"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/gravacoes/grav-42/termo");
    expect((init as RequestInit).method).toBe("PATCH");
    expect((init as RequestInit).headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      texto: "# editado",
    });
  });

  it("debouncing: múltiplas chamadas em sequência só disparam um PATCH", async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { result } = renderHook(() => useTermoAutoSave("g1"));

    act(() => result.current.scheduleSave("v1"));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => result.current.scheduleSave("v2"));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => result.current.scheduleSave("v3"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.texto).toBe("v3");
  });

  it("volta a idle quando PATCH falha", async () => {
    fetchMock.mockResolvedValue(failResponse);
    const { result } = renderHook(() => useTermoAutoSave("g1"));

    act(() => result.current.scheduleSave("x"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.saveState).toBe("idle");
  });

  it("volta a idle quando fetch lança", async () => {
    fetchMock.mockRejectedValue(new Error("rede caiu"));
    const { result } = renderHook(() => useTermoAutoSave("g1"));

    act(() => result.current.scheduleSave("x"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.saveState).toBe("idle");
  });

  it("limpa timers ao desmontar (não dispara PATCH após unmount)", async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { result, unmount } = renderHook(() => useTermoAutoSave("g1"));

    act(() => result.current.scheduleSave("x"));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
