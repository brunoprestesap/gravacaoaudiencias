import { beforeEach, describe, expect, it, vi } from "vitest";

const updateManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

import {
  STALE_TRANSCRICAO_REASON,
  STALE_TRANSCRICAO_THRESHOLD_MS,
  isStaleProcessando,
  recoverStuckTranscriptions,
} from "./transcricao-recovery";

describe("transcricao-recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("recoverStuckTranscriptions", () => {
    it("marca todas PROCESSANDO como ERRO e retorna a contagem", async () => {
      updateManyMock.mockResolvedValue({ count: 3 });

      const count = await recoverStuckTranscriptions();

      expect(count).toBe(3);
      expect(updateManyMock).toHaveBeenCalledWith({
        where: { transcricaoStatus: "PROCESSANDO" },
        data: expect.objectContaining({
          transcricaoStatus: "ERRO",
          transcricaoErro: STALE_TRANSCRICAO_REASON,
        }),
      });
    });

    it("retorna 0 quando não há linhas zumbis", async () => {
      updateManyMock.mockResolvedValue({ count: 0 });
      expect(await recoverStuckTranscriptions()).toBe(0);
    });
  });

  describe("isStaleProcessando", () => {
    it("considera null/undefined como stale", () => {
      expect(isStaleProcessando(null)).toBe(true);
      expect(isStaleProcessando(undefined)).toBe(true);
    });

    it("não é stale quando atualizado recentemente", () => {
      const now = new Date("2026-05-04T15:00:00Z");
      const recent = new Date(now.getTime() - 5 * 60 * 1000);
      expect(isStaleProcessando(recent, now)).toBe(false);
    });

    it("é stale quando supera o threshold", () => {
      const now = new Date("2026-05-04T15:00:00Z");
      const old = new Date(now.getTime() - STALE_TRANSCRICAO_THRESHOLD_MS - 1);
      expect(isStaleProcessando(old, now)).toBe(true);
    });

    it("é stale exatamente no threshold (limite inclusivo)", () => {
      const now = new Date("2026-05-04T15:00:00Z");
      const onLimit = new Date(now.getTime() - STALE_TRANSCRICAO_THRESHOLD_MS);
      expect(isStaleProcessando(onLimit, now)).toBe(true);
    });
  });
});
