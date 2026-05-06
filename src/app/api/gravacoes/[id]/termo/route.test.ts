import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionOrErrorMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const chamarMaritacaTermoMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  getSessionOrError: (...args: unknown[]) => getSessionOrErrorMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

vi.mock("@/lib/termo-audiencia/maritaca", () => ({
  chamarMaritacaTermo: (...args: unknown[]) => chamarMaritacaTermoMock(...args),
  MaritacaApiError: class MaritacaApiError extends Error {},
  MaritacaConfigError: class MaritacaConfigError extends Error {},
}));

import { GET, PATCH, POST } from "./route";

const makeContext = (id = "gravacao-1") =>
  ({
    params: Promise.resolve({ id }),
  }) as { params: Promise<{ id: string }> };

const baseGravacao = {
  id: "gravacao-1",
  userId: "user-1",
  vara: "1a Vara",
  numeroProcesso: "0001-00.0000",
  classeProcessual: null,
  partes: null,
  nomeJuiz: null,
  tipoAudiencia: null,
  dataAudiencia: null,
};

describe("API /api/gravacoes/[id]/termo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionOrErrorMock.mockResolvedValue({
      session: { user: { id: "user-1", role: "SERVIDOR", vara: null } },
      error: null,
    });
    process.env.MARITACA_API_KEY = "test-key";
  });

  it("GET retorna 404 quando gravação não existe", async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await GET({} as never, makeContext());
    expect(res.status).toBe(404);
  });

  it("GET retorna estado do termo para servidor dono", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      termoStatus: "CONCLUIDA",
      termoTexto: "# Termo",
      termoEstruturado: { tipoSentenca: "outra" },
      termoTipo: "outra",
      termoErro: null,
      termoAtualizadoEm: new Date(),
    });
    const res = await GET({} as never, makeContext());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.termo.status).toBe("CONCLUIDA");
    expect(json.termo.texto).toBe("# Termo");
  });

  it("GET retorna 403 para juiz de outra vara", async () => {
    getSessionOrErrorMock.mockResolvedValue({
      session: { user: { id: "user-x", role: "JUIZ", vara: "Outra Vara" } },
      error: null,
    });
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      termoStatus: "CONCLUIDA",
      termoTexto: null,
      termoEstruturado: null,
      termoTipo: null,
      termoErro: null,
      termoAtualizadoEm: null,
    });
    const res = await GET({} as never, makeContext());
    expect(res.status).toBe(403);
  });

  it("POST nega para juiz (não é servidor dono)", async () => {
    getSessionOrErrorMock.mockResolvedValue({
      session: { user: { id: "user-juiz", role: "JUIZ", vara: "1a Vara" } },
      error: null,
    });
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "texto",
      transcricaoSegmentos: [],
      termoStatus: "PENDENTE",
    });
    const res = await POST({} as never, makeContext());
    expect(res.status).toBe(403);
  });

  it("POST exige transcricaoStatus CONCLUIDA", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      transcricaoStatus: "PROCESSANDO",
      transcricaoTexto: null,
      transcricaoSegmentos: null,
      termoStatus: "PENDENTE",
    });
    const res = await POST({} as never, makeContext());
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("transcrição");
  });

  it("POST exige transcricaoTexto não vazio", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "   ",
      transcricaoSegmentos: [],
      termoStatus: "PENDENTE",
    });
    const res = await POST({} as never, makeContext());
    expect(res.status).toBe(400);
  });

  it("POST retorna 500 quando MARITACA_API_KEY ausente", async () => {
    delete process.env.MARITACA_API_KEY;
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "texto",
      transcricaoSegmentos: [],
      termoStatus: "PENDENTE",
    });
    const res = await POST({} as never, makeContext());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toContain("MARITACA_API_KEY");
  });

  it("POST inicia geração e retorna PROCESSANDO", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "texto",
      transcricaoSegmentos: [],
      termoStatus: "PENDENTE",
    });
    chamarMaritacaTermoMock.mockResolvedValue({
      tipoSentenca: "outra",
      presentes: {},
      resumoFatos: "ok",
      dispositivo: ["a)"],
      markdown: "# Termo",
    });
    updateMock.mockResolvedValue({});

    const res = await POST({} as never, makeContext());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.termo.status).toBe("PROCESSANDO");
    expect(updateMock).toHaveBeenCalled();
  });

  it("POST retorna estado atual quando termo já está PROCESSANDO", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseGravacao,
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "texto",
      transcricaoSegmentos: [],
      termoStatus: "PROCESSANDO",
    });
    const res = await POST({} as never, makeContext());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.termo.status).toBe("PROCESSANDO");
    expect(json.message).toContain("já está em geração");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("PATCH salva edição manual do texto", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
    });
    updateMock.mockResolvedValue({
      termoStatus: "CONCLUIDA",
      termoTexto: "# Editado",
      termoTipo: "outra",
      termoAtualizadoEm: new Date(),
    });

    const req = { json: async () => ({ texto: "# Editado" }) } as never;
    const res = await PATCH(req, makeContext());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.termo.texto).toBe("# Editado");
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("PATCH rejeita texto vazio", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
    });
    const req = { json: async () => ({ texto: "" }) } as never;
    const res = await PATCH(req, makeContext());
    expect(res.status).toBe(400);
  });

  it("PATCH nega para juiz", async () => {
    getSessionOrErrorMock.mockResolvedValue({
      session: { user: { id: "user-juiz", role: "JUIZ", vara: "1a Vara" } },
      error: null,
    });
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
    });
    const req = { json: async () => ({ texto: "x" }) } as never;
    const res = await PATCH(req, makeContext());
    expect(res.status).toBe(403);
  });
});
