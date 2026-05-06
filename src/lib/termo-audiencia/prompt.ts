import type { ProcessMetadata } from "@/types/recording";
import type { TranscriptSegment } from "@/lib/transcription-diarization";

const SYSTEM_PROMPT = `Você é um assistente jurídico especializado em redigir TERMO DE AUDIÊNCIA da Justiça Federal do Brasil (TRF1, modelo dos Juizados Especiais Federais).

Você recebe a transcrição diarizada de uma audiência (cada fala vem prefixada com [JUIZ], [PARTE], [PROCURADOR] ou [DESCONHECIDO]) e os metadados do processo.

Sua tarefa:
1. Identificar o que efetivamente aconteceu na audiência (fala do juiz manda).
2. Classificar a SENTENÇA em uma das categorias:
   - extincao_sem_merito: feito extinto sem resolução de mérito (CPC art. 485) — falta de pressuposto, complexidade probatória, necessidade de via administrativa, etc.
   - procedencia: pedido julgado procedente.
   - improcedencia: pedido julgado improcedente.
   - acordo: houve conciliação homologada.
   - outra: qualquer outra hipótese (designação de perícia, suspensão, etc.).
3. Listar quem esteve presente conforme as falas e os metadados (juiz, autor, réu, procuradores, MP).
4. Resumir a instrução em poucos parágrafos, FIEL ao que foi dito. NUNCA invente fatos, dispositivos legais ou nomes que não apareçam nem na transcrição nem nos metadados.
5. Redigir o DISPOSITIVO da sentença como uma lista de itens (a, b, c, d, ...) — só inclua os itens que realmente foram pronunciados.
6. Produzir o termo completo em Markdown no campo "markdown", seguindo este formato:

# TERMO DE AUDIÊNCIA

**Processo:** {numero}
**Autor(a):** ...
**Réu:** ...

Às {hora}, na sala de audiências de {vara}, presente o MM. Juiz Federal {nome}, foi aberta a Audiência de {tipo} referente ao processo acima identificado. Apregoadas as partes, compareceram ...

Iniciada a audiência, colheram-se os depoimentos da parte autora que foram registrados em gravação de áudio e vídeo.

[Resumo da instrução fiel à transcrição]

[Sobre conciliação, contestação, etc., se mencionado]

Encerrada a instrução, o MM. Juiz Federal proferiu a seguinte **SENTENÇA (TIPO A)**:

[Resumo dos fundamentos efetivamente expostos pelo juiz, sem inventar legislação]

## DISPOSITIVO

Ante o exposto:

a) ...
b) ...
c) ...

Encerrada a audiência, eu, lavrei e assinei o presente termo.

**{NOME DO JUIZ}**
Juiz Federal

7. NÃO use legislação que não foi mencionada na audiência. Se o juiz citou algum artigo, repita; se não, prefira linguagem genérica ("nos termos do CPC").
8. Mantenha tom formal e neutro, característico de termos judiciais.

Responda APENAS no formato JSON solicitado pelo schema. NÃO inclua texto fora do JSON.`;

const ROLE_LABEL: Record<string, string> = {
  JUIZ: "[JUIZ]",
  PARTE: "[PARTE]",
  PROCURADOR: "[PROCURADOR]",
  DESCONHECIDO: "[DESCONHECIDO]",
};

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

function formatMetadataBlock(metadata: ProcessMetadata): string {
  const linhas: string[] = ["METADADOS DO PROCESSO:"];
  linhas.push(`- Número do processo: ${metadata.numeroProcesso}`);
  if (metadata.classeProcessual) {
    linhas.push(`- Classe processual: ${metadata.classeProcessual}`);
  }
  if (metadata.partes) {
    linhas.push(`- Partes: ${metadata.partes}`);
  }
  if (metadata.vara) {
    linhas.push(`- Vara: ${metadata.vara}`);
  }
  if (metadata.nomeJuiz) {
    linhas.push(`- Juiz: ${metadata.nomeJuiz}`);
  }
  if (metadata.tipoAudiencia) {
    linhas.push(`- Tipo de audiência: ${metadata.tipoAudiencia}`);
  }
  if (metadata.dataAudiencia) {
    linhas.push(`- Data: ${metadata.dataAudiencia}`);
  }
  return linhas.join("\n");
}

function formatSegmentsBlock(segmentos: TranscriptSegment[]): string {
  if (segmentos.length === 0) {
    return "TRANSCRIÇÃO:\n(transcrição vazia)";
  }
  const linhas = segmentos.map((segmento) => {
    const role = ROLE_LABEL[segmento.role ?? "DESCONHECIDO"] ?? "[DESCONHECIDO]";
    return `${role} ${segmento.text.trim()}`;
  });
  return `TRANSCRIÇÃO DIARIZADA:\n${linhas.join("\n")}`;
}

export interface BuildUserPromptParams {
  metadata: ProcessMetadata;
  segmentos: TranscriptSegment[];
  fallbackTexto?: string | null;
}

export function buildUserPrompt({
  metadata,
  segmentos,
  fallbackTexto,
}: BuildUserPromptParams): string {
  const metadataBlock = formatMetadataBlock(metadata);
  const segmentosBlock = segmentos.length > 0
    ? formatSegmentsBlock(segmentos)
    : `TRANSCRIÇÃO (sem diarização):\n${(fallbackTexto ?? "").trim() || "(transcrição vazia)"}`;

  return [
    metadataBlock,
    "",
    segmentosBlock,
    "",
    "Gere o Termo de Audiência seguindo o schema JSON solicitado.",
  ].join("\n");
}
