import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMaritacaConfig } from "./config";
import { MaritacaConfigError } from "./errors";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.MARITACA_API_KEY;
  delete process.env.MARITACA_MODEL;
  delete process.env.MARITACA_BASE_URL;
  delete process.env.MARITACA_API_URL;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getMaritacaConfig", () => {
  it("lança MaritacaConfigError quando MARITACA_API_KEY ausente", () => {
    expect(() => getMaritacaConfig()).toThrow(MaritacaConfigError);
  });

  it("lança MaritacaConfigError quando MARITACA_API_KEY é apenas espaços", () => {
    process.env.MARITACA_API_KEY = "   ";
    expect(() => getMaritacaConfig()).toThrow(MaritacaConfigError);
  });

  it("usa modelo default 'sabia-4' quando MARITACA_MODEL não setado", () => {
    process.env.MARITACA_API_KEY = "k";
    expect(getMaritacaConfig().model).toBe("sabia-4");
  });

  it("usa MARITACA_MODEL quando setado", () => {
    process.env.MARITACA_API_KEY = "k";
    process.env.MARITACA_MODEL = "sabia-3";
    expect(getMaritacaConfig().model).toBe("sabia-3");
  });

  it("usa baseUrl default quando MARITACA_BASE_URL e MARITACA_API_URL ausentes", () => {
    process.env.MARITACA_API_KEY = "k";
    expect(getMaritacaConfig().baseUrl).toBe("https://chat.maritaca.ai/api");
  });

  it("usa MARITACA_BASE_URL quando setado", () => {
    process.env.MARITACA_API_KEY = "k";
    process.env.MARITACA_BASE_URL = "https://custom.test/api";
    expect(getMaritacaConfig().baseUrl).toBe("https://custom.test/api");
  });

  it("aceita MARITACA_API_URL como alias de MARITACA_BASE_URL", () => {
    process.env.MARITACA_API_KEY = "k";
    process.env.MARITACA_API_URL = "https://alias.test/api";
    expect(getMaritacaConfig().baseUrl).toBe("https://alias.test/api");
  });

  it("dá precedência a MARITACA_BASE_URL quando ambos setados", () => {
    process.env.MARITACA_API_KEY = "k";
    process.env.MARITACA_BASE_URL = "https://primary.test/api";
    process.env.MARITACA_API_URL = "https://secondary.test/api";
    expect(getMaritacaConfig().baseUrl).toBe("https://primary.test/api");
  });

  it("remove trailing slash do baseUrl", () => {
    process.env.MARITACA_API_KEY = "k";
    process.env.MARITACA_BASE_URL = "https://x.test/api/";
    expect(getMaritacaConfig().baseUrl).toBe("https://x.test/api");
  });

  it("aplica trim na API key", () => {
    process.env.MARITACA_API_KEY = "  abc  ";
    expect(getMaritacaConfig().apiKey).toBe("abc");
  });
});
