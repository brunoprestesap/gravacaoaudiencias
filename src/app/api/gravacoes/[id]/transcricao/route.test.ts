import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionOrErrorMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const validateRuntimeMock = vi.fn();
const transcribeMock = vi.fn();

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

vi.mock("@/lib/transcription-local", () => ({
  validateLocalTranscriptionRuntime: (...args: unknown[]) => validateRuntimeMock(...args),
  transcribeLocalRecording: (...args: unknown[]) => transcribeMock(...args),
  LocalTranscriptionError: class LocalTranscriptionError extends Error {},
}));

import { GET, PATCH, POST } from "./route";

const makeContext = (id = "gravacao-1") =>
  ({
    params: Promise.resolve({ id }),
  }) as { params: Promise<{ id: string }> };

describe("API /api/gravacoes/[id]/transcricao", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionOrErrorMock.mockResolvedValue({
      session: { user: { id: "user-1", role: "SERVIDOR", vara: null } },
      error: null,
    });
  });

  it("GET retorna 404 quando gravação não existe", async () => {
    findUniqueMock.mockResolvedValue(null);

    const res = await GET({} as never, makeContext());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Gravação não encontrada.");
  });

  it("POST bloqueia acesso quando usuário não tem permissão", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "outro-user",
      vara: "1a Vara",
      status: "FINALIZADA",
      caminhoArquivo: "2026/03/vara/a.mp4",
      transcricaoStatus: "PENDENTE",
    });

    const res = await POST({} as never, makeContext());
    expect(res.status).toBe(403);
  });

  it("POST retorna estado atual quando já está processando", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
      status: "FINALIZADA",
      caminhoArquivo: "2026/03/vara/a.mp4",
      transcricaoStatus: "PROCESSANDO",
    });

    const res = await POST({} as never, makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.transcricao.status).toBe("PROCESSANDO");
  });

  it("POST conclui transcrição com sucesso", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
      status: "FINALIZADA",
      caminhoArquivo: "2026/03/vara/a.mp4",
      transcricaoStatus: "PENDENTE",
    });
    validateRuntimeMock.mockResolvedValue(undefined);
    transcribeMock.mockResolvedValue({
      text: "texto final da audiência",
      segments: [
        {
          id: "seg-1",
          text: "Estamos abrindo audiência do processo tal.",
          offsetMs: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    updateMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        transcricaoStatus: "CONCLUIDA",
        transcricaoTexto: "texto final da audiência",
        transcricaoErro: null,
      });

    const res = await POST({} as never, makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.transcricao.status).toBe("CONCLUIDA");
    expect(Array.isArray(json.transcricao.segmentos)).toBe(true);
    expect(transcribeMock).toHaveBeenCalled();
  });

  it("POST marca ERRO quando transcrição falha", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
      status: "FINALIZADA",
      caminhoArquivo: "2026/03/vara/a.mp4",
      transcricaoStatus: "PENDENTE",
    });
    validateRuntimeMock.mockRejectedValue(new Error("Falha no runtime"));
    updateMock.mockResolvedValue({});

    const res = await POST({} as never, makeContext());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.transcricao.status).toBe("ERRO");
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it("PATCH persiste segmentos diarizados em tempo real", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
      transcricaoTexto: null,
      transcricaoSegmentos: null,
      numeroProcesso: "0000000-00.0000.0.00.0000",
      classeProcessual: "Ação Civil",
      partes: "Maria vs João",
      nomeJuiz: "Ana Souza",
      tipoAudiencia: "Instrução",
      dataAudiencia: new Date("2026-03-01T00:00:00.000Z"),
    });
    updateMock.mockResolvedValue({
      transcricaoStatus: "PROCESSANDO",
      transcricaoTexto: "Boa tarde, excelência",
      transcricaoSegmentos: [
        {
          id: "seg-live-1",
          text: "Boa tarde, excelência",
          offsetMs: 1000,
          createdAt: new Date().toISOString(),
          role: "PARTE",
        },
      ],
      transcricaoAtualizadoEm: new Date(),
    });

    const req = {
      json: async () => ({
        isFinal: false,
        segments: [
          {
            id: "seg-live-1",
            text: "Boa tarde, excelência",
            offsetMs: 1000,
            createdAt: new Date().toISOString(),
            voiceFeatures: {
              pitchMeanHz: 208,
              energyMeanDb: -21,
              pauseRatio: 0.22,
              speechRateApprox: 132,
            },
          },
        ],
      }),
    } as never;

    const res = await PATCH(req, makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.transcricao.status).toBe("PROCESSANDO");
    expect(Array.isArray(json.transcricao.segmentos)).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("PATCH rejeita voiceFeatures inválido", async () => {
    findUniqueMock.mockResolvedValue({
      id: "gravacao-1",
      userId: "user-1",
      vara: "1a Vara",
      transcricaoTexto: null,
      transcricaoSegmentos: null,
      numeroProcesso: "0000000-00.0000.0.00.0000",
      classeProcessual: "Ação Civil",
      partes: "Maria vs João",
      nomeJuiz: "Ana Souza",
      tipoAudiencia: "Instrução",
      dataAudiencia: new Date("2026-03-01T00:00:00.000Z"),
    });

    const req = {
      json: async () => ({
        isFinal: false,
        segments: [
          {
            id: "seg-live-1",
            text: "Boa tarde, excelência",
            offsetMs: 1000,
            createdAt: new Date().toISOString(),
            voiceFeatures: {
              pitchMeanHz: "alto",
            },
          },
        ],
      }),
    } as never;

    const res = await PATCH(req, makeContext());
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("Payload inválido");
  });
});
