import { beforeEach, describe, expect, it, vi } from "vitest";

const updateManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

import { DEFAULT_MARITACA_TIMEOUT_MS } from "@/lib/termo-audiencia/config";
import {
  STALE_TERMO_REASON,
  STALE_TERMO_THRESHOLD_MS,
  isStaleTermoProcessando,
  recoverStuckTermos,
} from "./termo-recovery";

describe("termo-recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca como ERRO todo termo em PROCESSANDO no boot e retorna a contagem", async () => {
    updateManyMock.mockResolvedValue({ count: 2 });

    expect(await recoverStuckTermos()).toBe(2);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { termoStatus: "PROCESSANDO" },
      data: expect.objectContaining({ termoStatus: "ERRO", termoErro: STALE_TERMO_REASON }),
    });
  });

  it("considera obsoleto só depois que a chamada à Maritaca já teria expirado", () => {
    expect(STALE_TERMO_THRESHOLD_MS).toBeGreaterThan(DEFAULT_MARITACA_TIMEOUT_MS);

    const now = new Date("2026-05-04T15:00:00Z");
    const age = (ms: number) => new Date(now.getTime() - ms);

    expect(isStaleTermoProcessando(age(DEFAULT_MARITACA_TIMEOUT_MS), now)).toBe(false);
    expect(isStaleTermoProcessando(age(STALE_TERMO_THRESHOLD_MS), now)).toBe(true);
    expect(isStaleTermoProcessando(null, now)).toBe(true);
  });
});
