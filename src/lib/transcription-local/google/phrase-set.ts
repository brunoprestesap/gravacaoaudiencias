import type { ProcessMetadata } from "@/types/recording";

export interface PhraseHint {
  value: string;
  boost: number;
}

// Boost values calibrados conforme doc oficial Speech-to-Text v2:
// - Range válido: > 0 e <= 20.
// - Recomendação: 15–20 para entidades raras / nomes próprios; 10 para
//   vocabulário comum mas relevante; 12 para vocabulário técnico ainda
//   relativamente raro (medicamentos, termos clínicos).
// Refs:
//   https://cloud.google.com/speech-to-text/v2/docs/adaptation-model
//
// PROCESS_BOOST=15 deixa headroom (até 20) para empurrar termos específicos
// se necessário sem brigar com a calibração de outros termos. Boost=18/20
// satura a influência relativa entre múltiplos termos do processo.
const PROCESS_BOOST = 15;
const TECHNICAL_BOOST = 12;
const VOCABULARY_BOOST = 10;

// Limite alinhado à recomendação do model card do Chirp 3 (~1000 phrases),
// mas mantido conservador para reduzir latência no batch.
const MAX_PHRASES = 200;

const LEGAL_VOCABULARY: ReadonlyArray<string> = [
  // Tratamentos / vocativos
  "Excelência",
  "Vossa Excelência",
  "Excelentíssimo",
  "Excelentíssima",
  "Magistrado",
  "Magistrada",
  "doutor",
  "doutora",
  "Senhor Juiz",
  "Senhora Juíza",

  // Atores processuais
  "Ministério Público",
  "promotor",
  "promotora",
  "advogado",
  "advogada",
  "procurador",
  "procuradora",
  "defensor público",
  "defensora pública",
  "requerente",
  "requerido",
  "autor",
  "ré",
  "réu",
  "testemunha",
  "depoente",
  "perito",
  "perita",
  "perito médico",
  "perícia médica",

  // Atos / momentos da audiência
  "audiência de instrução",
  "audiência de conciliação",
  "audiência una",
  "alegações finais",
  "réplica",
  "tréplica",
  "exordial",
  "petição inicial",
  "contestação",
  "depoimento pessoal",
  "oitiva de testemunha",
  "interrogatório",
  "compromisso de dizer a verdade",
  "advertência",
  "indeferido",
  "deferido",

  // Estrutura judiciária
  "Vara",
  "Vara Federal",
  "Tribunal Regional Federal",
  "Justiça Federal",
  "comarca",
  "secretaria",
];

// Vocabulário previdenciário / assistencial — frequentíssimo em audiências
// de BPC/LOAS, auxílio-doença, aposentadoria por invalidez. Boost mais alto
// porque são termos específicos pouco comuns no corpus geral.
const SOCIAL_SECURITY_VOCABULARY: ReadonlyArray<string> = [
  "INSS",
  "BPC",
  "LOAS",
  "benefício assistencial",
  "benefício de prestação continuada",
  "auxílio-doença",
  "aposentadoria por invalidez",
  "aposentadoria por idade",
  "incapacidade laboral",
  "incapacidade laborativa",
  "incapacidade total",
  "incapacidade parcial",
  "incapacidade temporária",
  "incapacidade permanente",
  "incapacidade definitiva",
  "deficiente",
  "deficiência",
  "reabilitação profissional",
  "carência",
  "vínculo empregatício",
  "carteira assinada",
  "salário-mínimo",
  "renda per capita",
  "miserabilidade",
  "perícia social",
  "estudo social",
  "DCB",
  "DII",
  "DID",
];

// Vocabulário médico recorrente em audiências de BPC / auxílio-doença.
const MEDICAL_VOCABULARY: ReadonlyArray<string> = [
  // Patologias frequentes
  "cervicalgia",
  "lombalgia",
  "lombociatalgia",
  "hérnia de disco",
  "hérnia discal",
  "discopatia",
  "artrose",
  "artrite",
  "fibromialgia",
  "tendinite",
  "bursite",
  "depressão",
  "transtorno depressivo",
  "transtorno de ansiedade",
  "esquizofrenia",
  "transtorno bipolar",
  "diabetes",
  "hipertensão",
  "neoplasia",
  "AVC",

  // Anatomia
  "coluna vertebral",
  "coluna cervical",
  "coluna lombar",
  "vértebra",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "L4",
  "L5",
  "S1",

  // Tratamentos / serviços
  "fisioterapia",
  "psicoterapia",
  "terapia ocupacional",
  "ortopedista",
  "neurologista",
  "psiquiatra",
  "reumatologista",
  "cardiologista",
  "CAPS",
  "Centro de Atenção Psicossocial",
  "Unidade Básica de Saúde",
  "UBS",
  "ambulatório",
  "internação",
  "cirurgia",
];

// Medicamentos comuns — se aparecem em uma audiência de incapacidade,
// vão aparecer várias vezes. Boost maior porque são extremamente raros
// no corpus geral.
const MEDICATIONS: ReadonlyArray<string> = [
  "Tramal",
  "Tramadol",
  "Pregabalina",
  "Lyrica",
  "Gabapentina",
  "Dipirona",
  "Paracetamol",
  "Ibuprofeno",
  "Diclofenaco",
  "Amitriptilina",
  "Fluoxetina",
  "Sertralina",
  "Clonazepam",
  "Rivotril",
  "Diazepam",
  "Carbamazepina",
  "Risperidona",
  "Quetiapina",
];

function splitParties(partes: string | undefined): string[] {
  if (!partes) return [];
  return partes
    .split(/[,;]+|\s+vs\.?\s+|\s+e\s+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Variações de contexto para nomes de partes — aumentam casamento sem
 *  exigir custom classes (que a UI da Google ainda trata como avançado). */
function partyContextPhrases(partyNames: string[]): string[] {
  const out: string[] = [];
  for (const name of partyNames) {
    out.push(name);
    out.push(`Senhor ${name}`);
    out.push(`Senhora ${name}`);
    out.push(`advogado da parte ${name}`);
    out.push(`depoimento de ${name}`);
  }
  return out;
}

/** Variações de contexto para o juiz. */
function judgeContextPhrases(judgeName: string): string[] {
  return [
    judgeName,
    `Excelentíssimo ${judgeName}`,
    `Magistrado ${judgeName}`,
  ];
}

export function buildPhraseHints(metadata?: ProcessMetadata): PhraseHint[] {
  const highBoostTerms: string[] = [];

  // Entidades raras / específicas do processo (boost máximo 18/20).
  if (metadata?.numeroProcesso) highBoostTerms.push(metadata.numeroProcesso);
  if (metadata?.classeProcessual) highBoostTerms.push(metadata.classeProcessual);
  if (metadata?.vara) highBoostTerms.push(metadata.vara);
  if (metadata?.tipoAudiencia) highBoostTerms.push(metadata.tipoAudiencia);

  if (metadata?.nomeJuiz) {
    for (const variant of judgeContextPhrases(metadata.nomeJuiz)) {
      highBoostTerms.push(variant);
    }
  }

  const partyNames = splitParties(metadata?.partes);
  for (const variant of partyContextPhrases(partyNames)) {
    highBoostTerms.push(variant);
  }

  const processHints = dedupePreservingOrder(highBoostTerms).map((value) => ({
    value,
    boost: PROCESS_BOOST,
  }));
  const technicalHints = dedupePreservingOrder([
    ...SOCIAL_SECURITY_VOCABULARY,
    ...MEDICATIONS,
  ]).map((value) => ({ value, boost: TECHNICAL_BOOST }));
  const vocabularyHints = dedupePreservingOrder([
    ...LEGAL_VOCABULARY,
    ...MEDICAL_VOCABULARY,
  ] as string[]).map((value) => ({ value, boost: VOCABULARY_BOOST }));

  // Garante prefixo dos termos do processo (sempre cabem) e depois intercala
  // técnico ↔ vocabulário até atingir MAX_PHRASES. Antes a ordem fixa
  // [processo → técnico → vocabulário] cortava o vocabulário médico/jurídico
  // quando havia muitas partes nomeadas, deixando o ASR sem hints comuns.
  const reservedForProcess = Math.min(processHints.length, MAX_PHRASES);
  const remaining = MAX_PHRASES - reservedForProcess;
  const interleaved: PhraseHint[] = [];
  let ti = 0;
  let vi = 0;
  while (interleaved.length < remaining && (ti < technicalHints.length || vi < vocabularyHints.length)) {
    if (ti < technicalHints.length) interleaved.push(technicalHints[ti++]);
    if (interleaved.length >= remaining) break;
    if (vi < vocabularyHints.length) interleaved.push(vocabularyHints[vi++]);
  }

  return [...processHints.slice(0, reservedForProcess), ...interleaved];
}
