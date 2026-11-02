import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionOrErrorMock = vi.fn();
const countMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  getSessionOrError: (...args: unknown[]) => getSessionOrErrorMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      count: (...args: unknown[]) => countMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

import { GET } from "./route";

const makeRequest = (query = "") =>
  ({ nextUrl: new URL(`http://localhost/api/gravacoes${query}`) }) as never;

const loginAs = (user: { id: string; role: "SERVIDOR" | "JUIZ"; vara?: string | null }) =>
  getSessionOrErrorMock.mockResolvedValue({ session: { user }, error: null });

describe("GET /api/gravacoes: escopo da listagem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([{ id: "gravacao-1" }]);
  });

  it.each([null, undefined, ""])(
    "juiz com vara %j recebe lista vazia sem consultar o banco",
    async (vara) => {
      loginAs({ id: "j1", role: "JUIZ", vara });

      const res = await GET(makeRequest("?search=123"));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ gravacoes: [], total: 0, page: 1, limit: 20 });
      expect(countMock).not.toHaveBeenCalled();
      expect(findManyMock).not.toHaveBeenCalled();
    }
  );

  it("juiz com vara lista apenas a própria vara", async () => {
    loginAs({ id: "j1", role: "JUIZ", vara: "1a Vara" });

    await GET(makeRequest());

    expect(countMock).toHaveBeenCalledWith({ where: { vara: "1a Vara" } });
    expect(findManyMock.mock.calls[0][0].where).toEqual({ vara: "1a Vara" });
  });

  it("servidor lista apenas as próprias gravações", async () => {
    loginAs({ id: "u1", role: "SERVIDOR", vara: "1a Vara" });

    await GET(makeRequest());

    expect(countMock).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("busca por processo combina com o escopo", async () => {
    loginAs({ id: "j1", role: "JUIZ", vara: "1a Vara" });

    await GET(makeRequest("?search=123"));

    expect(countMock).toHaveBeenCalledWith({
      where: {
        vara: "1a Vara",
        numeroProcesso: { contains: "123", mode: "insensitive" },
      },
    });
  });
});
