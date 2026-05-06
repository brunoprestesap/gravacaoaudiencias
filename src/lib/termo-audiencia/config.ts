import { MaritacaConfigError } from "./errors";

const DEFAULT_BASE_URL = "https://chat.maritaca.ai/api";
const DEFAULT_MODEL = "sabia-4";

export interface MaritacaConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
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
  return { apiKey, model, baseUrl: rawBaseUrl.replace(/\/$/, "") };
}
