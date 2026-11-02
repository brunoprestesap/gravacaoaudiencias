// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_MONITOR } from "@/lib/constants";
import { useStorageMonitor } from "./useStorageMonitor";

describe("useStorageMonitor", () => {
  const onLowStorage = vi.fn();
  const persist = vi.fn(async () => true);
  const estimate = vi.fn();
  const low = { quota: STORAGE_MONITOR.LOW_FREE_BYTES, usage: 1 };
  const plenty = { quota: STORAGE_MONITOR.LOW_FREE_BYTES * 10, usage: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persist, estimate },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
  });

  it("pede armazenamento persistente ao iniciar a gravação", async () => {
    estimate.mockResolvedValue(plenty);

    renderHook(() => useStorageMonitor(true, onLowStorage));

    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(onLowStorage).not.toHaveBeenCalled();
  });

  it("não faz nada enquanto não há gravação", async () => {
    renderHook(() => useStorageMonitor(false, onLowStorage));

    await act(async () => {});

    expect(persist).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });

  it("avisa uma vez quando falta espaço e de novo só se o espaço voltar e faltar", async () => {
    vi.useFakeTimers();
    estimate.mockResolvedValue(low);
    renderHook(() => useStorageMonitor(true, onLowStorage));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(onLowStorage).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(STORAGE_MONITOR.CHECK_INTERVAL_MS));
    expect(onLowStorage).toHaveBeenCalledTimes(1);

    estimate.mockResolvedValue(plenty);
    await act(() => vi.advanceTimersByTimeAsync(STORAGE_MONITOR.CHECK_INTERVAL_MS));
    estimate.mockResolvedValue(low);
    await act(() => vi.advanceTimersByTimeAsync(STORAGE_MONITOR.CHECK_INTERVAL_MS));
    expect(onLowStorage).toHaveBeenCalledTimes(2);
  });

  it("não quebra em navegador sem a API de armazenamento", async () => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });

    renderHook(() => useStorageMonitor(true, onLowStorage));

    await act(async () => {});
    expect(onLowStorage).not.toHaveBeenCalled();
  });
});
