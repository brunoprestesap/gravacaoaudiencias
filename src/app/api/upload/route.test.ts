import { beforeEach, describe, expect, it, vi } from "vitest";

const mkdirMock = vi.fn();

vi.mock("fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs/promises")>()),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

vi.mock("@/lib/api-auth", () => ({
  getSessionOrError: async () => ({
    session: { user: { id: "user-1", role: "SERVIDOR", vara: null } },
    error: null,
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      findUnique: async () => ({
        id: "../../../../../fora",
        userId: "user-1",
        vara: null,
        numeroProcesso: "0001234-56.2026.4.01.3400",
      }),
    },
  },
}));

import { POST } from "./route";

describe("POST /api/upload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não grava nada quando o id antigo levaria o arquivo para fora de UPLOAD_DIR", async () => {
    const formData = new FormData();
    formData.append("gravacaoId", "qualquer");
    formData.append("file", new File(["x"], "a.webm", { type: "video/webm" }));

    const res = await POST({ formData: async () => formData } as never);

    expect(res.status).toBe(400);
    expect(mkdirMock).not.toHaveBeenCalled();
  });
});
