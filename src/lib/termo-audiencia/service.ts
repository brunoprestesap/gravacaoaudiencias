import type { ProcessMetadata } from "@/types/recording";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import { chamarMaritacaTermo } from "./maritaca";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { TermoEstruturado } from "./schema";

export interface GerarTermoParams {
  metadata: ProcessMetadata;
  segmentos: TranscriptSegment[];
  fallbackTexto: string;
}

export async function gerarTermoAudiencia(
  params: GerarTermoParams
): Promise<TermoEstruturado> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    metadata: params.metadata,
    segmentos: params.segmentos,
    fallbackTexto: params.fallbackTexto,
  });
  return chamarMaritacaTermo({ systemPrompt, userPrompt });
}
