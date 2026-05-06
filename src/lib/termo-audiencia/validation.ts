import type { TermoEstruturado } from "./schema";

export function isTermoEstruturado(value: unknown): value is TermoEstruturado {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tipoSentenca === "string"
    && typeof v.markdown === "string"
    && typeof v.resumoFatos === "string"
    && Array.isArray(v.dispositivo)
    && typeof v.presentes === "object"
    && v.presentes !== null
  );
}
