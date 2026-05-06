export type TipoSentenca =
  | "extincao_sem_merito"
  | "procedencia"
  | "improcedencia"
  | "acordo"
  | "outra";

export interface PresentesAudiencia {
  juiz?: string;
  autor?: string;
  reu?: string;
  procuradorAutor?: string;
  procuradorReu?: string;
  mp?: string;
  outros?: string[];
}

export interface TermoEstruturado {
  tipoSentenca: TipoSentenca;
  presentes: PresentesAudiencia;
  resumoFatos: string;
  dispositivo: string[];
  proximaProvidencia?: string;
  markdown: string;
}

export const TERMO_JSON_SCHEMA = {
  name: "termo_audiencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "tipoSentenca",
      "presentes",
      "resumoFatos",
      "dispositivo",
      "markdown",
    ],
    properties: {
      tipoSentenca: {
        type: "string",
        enum: [
          "extincao_sem_merito",
          "procedencia",
          "improcedencia",
          "acordo",
          "outra",
        ],
        description:
          "Classificação da sentença proferida pelo juiz com base no que foi decidido em audiência.",
      },
      presentes: {
        type: "object",
        additionalProperties: false,
        description: "Pessoas que participaram efetivamente da audiência.",
        properties: {
          juiz: { type: "string" },
          autor: { type: "string" },
          reu: { type: "string" },
          procuradorAutor: { type: "string" },
          procuradorReu: { type: "string" },
          mp: { type: "string" },
          outros: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      resumoFatos: {
        type: "string",
        description:
          "Resumo objetivo do que aconteceu na instrução, fiel à transcrição. Não inferir o que não foi dito.",
      },
      dispositivo: {
        type: "array",
        description:
          "Itens (a, b, c, ...) do dispositivo da sentença, na ordem em que apareceram.",
        items: { type: "string" },
      },
      proximaProvidencia: {
        type: "string",
        description:
          "Próxima providência mencionada pelo juiz (intimação, prazo, audiência futura). Omitir se não houver.",
      },
      markdown: {
        type: "string",
        description:
          "Termo de Audiência completo em Markdown, pronto para edição. Deve seguir o template TRF1: cabeçalho, presentes, resumo da instrução, conciliação, sentença com tipo (TIPO A/B/C), dispositivo numerado.",
      },
    },
  },
} as const;
