import { MaritacaConfigError } from "./errors";

const DEFAULT_BASE_URL = "https://chat.maritaca.ai/api";
const DEFAULT_MODEL = "sabia-4";
export const DEFAULT_MARITACA_TIMEOUT_MS = 5 * 60 * 1000;

export interface MaritacaConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

function readEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function getMaritacaConfig(): MaritacaConfig {
  const apiKey = readEnv("MARITACA_API_KEY");
  if (!apiKey) {
    throw new MaritacaConfigError(
      "MARITACA_API_KEY não está configurada. Defina a chave da Maritaca AI no .env."
    );
  }
  const model = readEnv("MARITACA_MODEL") ?? DEFAULT_MODEL;
  const rawBaseUrl =
    readEnv("MARITACA_BASE_URL") ?? readEnv("MARITACA_API_URL") ?? DEFAULT_BASE_URL;
  const parsedTimeout = Number(readEnv("MARITACA_TIMEOUT_MS"));
  const timeoutMs = parsedTimeout > 0 ? parsedTimeout : DEFAULT_MARITACA_TIMEOUT_MS;
  return { apiKey, model, baseUrl: rawBaseUrl.replace(/\/$/, ""), timeoutMs };
}
