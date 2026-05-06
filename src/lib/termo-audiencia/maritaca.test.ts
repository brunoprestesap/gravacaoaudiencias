import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chamarMaritacaTermo,
  MaritacaApiError,
  MaritacaConfigError,
} from "./maritaca";

const originalEnv = { ...process.env };

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env = { ...originalEnv };
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
});

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeErrorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: text }),
    text: async () => text,
  } as Response;
}

const validTermo = {
  tipoSentenca: "extincao_sem_merito",
  presentes: { juiz: "Dr. X", autor: "Maria" },
  resumoFatos: "Resumo da instrução.",
  dispositivo: ["a) extingue o feito"],
  markdown: "# TERMO DE AUDIÊNCIA\n\nConteúdo.",
};

describe("chamarMaritacaTermo", () => {
  it("lança MaritacaConfigError quando MARITACA_API_KEY ausente", async () => {
    delete process.env.MARITACA_API_KEY;
    await expect(
      chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" })
    ).rejects.toBeInstanceOf(MaritacaConfigError);
  });

  it("envia header Authorization com prefixo 'Key ' (não Bearer)", async () => {
    process.env.MARITACA_API_KEY = "minhachave";
    fetchMock.mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: JSON.stringify(validTermo) } }] })
    );

    await chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key minhachave");
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("envia body com response_format json_schema", async () => {
    process.env.MARITACA_API_KEY = "k";
    fetchMock.mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: JSON.stringify(validTermo) } }] })
    );

    await chamarMaritacaTermo({ systemPrompt: "sys", userPrompt: "usr" });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("termo_audiencia");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("sys");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe("usr");
  });

  it("usa MARITACA_MODEL e MARITACA_BASE_URL do env quando setados", async () => {
    process.env.MARITACA_API_KEY = "k";
    process.env.MARITACA_MODEL = "sabia-3";
    process.env.MARITACA_BASE_URL = "https://custom.maritaca.test/api/";
    fetchMock.mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: JSON.stringify(validTermo) } }] })
    );

    await chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://custom.maritaca.test/api/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("sabia-3");
  });

  it("parseia o conteúdo JSON da resposta no schema TermoEstruturado", async () => {
    process.env.MARITACA_API_KEY = "k";
    fetchMock.mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: JSON.stringify(validTermo) } }] })
    );

    const result = await chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" });
    expect(result.tipoSentenca).toBe("extincao_sem_merito");
    expect(result.markdown).toContain("TERMO DE AUDIÊNCIA");
    expect(result.dispositivo).toEqual(["a) extingue o feito"]);
  });

  it("lança MaritacaApiError em HTTP 4xx", async () => {
    process.env.MARITACA_API_KEY = "k";
    fetchMock.mockResolvedValue(makeErrorResponse(401, "invalid api key"));
    await expect(
      chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" })
    ).rejects.toBeInstanceOf(MaritacaApiError);
  });

  it("lança MaritacaApiError quando o conteúdo não é JSON válido", async () => {
    process.env.MARITACA_API_KEY = "k";
    fetchMock.mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: "não é JSON" } }] })
    );
    await expect(
      chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" })
    ).rejects.toBeInstanceOf(MaritacaApiError);
  });

  it("lança MaritacaApiError quando JSON não tem campos obrigatórios", async () => {
    process.env.MARITACA_API_KEY = "k";
    fetchMock.mockResolvedValue(
      makeOkResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ tipoSentenca: "outra", markdown: "x" }),
            },
          },
        ],
      })
    );
    await expect(
      chamarMaritacaTermo({ systemPrompt: "s", userPrompt: "u" })
    ).rejects.toBeInstanceOf(MaritacaApiError);
  });
});
