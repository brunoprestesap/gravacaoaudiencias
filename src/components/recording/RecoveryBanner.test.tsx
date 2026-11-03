// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryBanner } from "./RecoveryBanner";

const finalizar = vi.fn();
const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/hooks/useRecovery", () => ({
  useRecovery: () => ({
    hasInterruptedRecording: true,
    isLoading: false,
    isConsolidating: false,
    retomar: vi.fn(),
    finalizar,
    recoveryData: {
      gravacaoId: "grav-1",
      metadata: { numeroProcesso: "0000000-00.2026.4.01.3100" },
      modo: "PRESENCIAL",
      startedAt: 1,
      lastChunkAt: 2,
      chunkCount: 1,
      totalBytes: 1,
      estimatedDurationMs: 5000,
    },
  }),
}));

describe("RecoveryBanner ao finalizar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const clickFinalizar = () =>
    fireEvent.click(screen.getByRole("button", { name: "Finalizar com Chunks Disponíveis" }));

  it("mostra o aviso no lugar do sucesso", async () => {
    finalizar.mockResolvedValue({ ok: true, warning: "Aviso do servidor" });
    render(<RecoveryBanner />);

    clickFinalizar();

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Aviso do servidor"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("mostra sucesso quando não há aviso", async () => {
    finalizar.mockResolvedValue({ ok: true, warning: null });
    render(<RecoveryBanner />);

    clickFinalizar();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("mostra erro quando a finalização falha", async () => {
    finalizar.mockResolvedValue({ ok: false });
    render(<RecoveryBanner />);

    clickFinalizar();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
