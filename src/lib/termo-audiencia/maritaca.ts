import { TERMO_JSON_SCHEMA, type TermoEstruturado } from "./schema";
import { getMaritacaConfig, type MaritacaConfig } from "./config";
import { MaritacaApiError, MaritacaConfigError } from "./errors";
import { isTermoEstruturado } from "./validation";

export { MaritacaApiError, MaritacaConfigError };

const ENDPOINT_PATH = "/chat/completions";
const TEMPERATURE = 0.2;
const MAX_TOKENS = 8000;

export interface ChamarMaritacaTermoParams {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}

interface MaritacaChoice {
  message?: { content?: string };
}

interface MaritacaResponse {
  choices?: MaritacaChoice[];
}

function buildRequestBody(model: string, params: ChamarMaritacaTermoParams) {
  return {
    model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: TERMO_JSON_SCHEMA,
    },
  };
}

async function postChatCompletion(
  config: MaritacaConfig,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  try {
    return await fetch(`${config.baseUrl}${ENDPOINT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new MaritacaApiError(
      `Falha de rede ao chamar Maritaca: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function ensureSuccessful(response: Response): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new MaritacaApiError(
    `Maritaca retornou HTTP ${response.status}: ${text.slice(0, 500)}`,
    response.status
  );
}

async function extractContent(response: Response): Promise<string> {
  let payload: MaritacaResponse;
  try {
    payload = (await response.json()) as MaritacaResponse;
  } catch (err) {
    throw new MaritacaApiError(
      `Resposta da Maritaca não é JSON válido: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new MaritacaApiError("Resposta da Maritaca não contém 'choices[0].message.content'.");
  }
  return content;
}

function parseTermoContent(content: string): TermoEstruturado {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new MaritacaApiError(
      `Conteúdo da Maritaca não é JSON válido: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isTermoEstruturado(parsed)) {
    throw new MaritacaApiError(
      "Conteúdo da Maritaca não corresponde ao schema esperado do termo."
    );
  }
  return parsed;
}

export async function chamarMaritacaTermo(
  params: ChamarMaritacaTermoParams
): Promise<TermoEstruturado> {
  const config = getMaritacaConfig();
  const body = buildRequestBody(config.model, params);
  const response = await postChatCompletion(config, body, params.signal);
  await ensureSuccessful(response);
  const content = await extractContent(response);
  return parseTermoContent(content);
}
