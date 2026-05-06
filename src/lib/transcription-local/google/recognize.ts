import type { google } from "@google-cloud/speech/build/protos/protos";
import { LocalTranscriptionError } from "../errors";
import { buildPhraseHints, type PhraseHint } from "./phrase-set";
import type { GoogleTranscriptionConfig, SpeechV2Client } from "./client";
import type { ProcessMetadata } from "@/types/recording";

type IBatchRecognizeFileResult = google.cloud.speech.v2.IBatchRecognizeFileResult;

interface RunBatchRecognizeOptions {
  client: SpeechV2Client;
  config: GoogleTranscriptionConfig;
  projectId: string;
  audioGcsUri: string;
  metadata?: ProcessMetadata;
}

function adaptationFromPhrases(phrases: PhraseHint[]) {
  if (phrases.length === 0) return undefined;
  return {
    phraseSets: [
      {
        inlinePhraseSet: {
          phrases: phrases.map((hint) => ({ value: hint.value, boost: hint.boost })),
        },
      },
    ],
  };
}

export async function runBatchRecognize({
  client,
  config,
  projectId,
  audioGcsUri,
  metadata,
}: RunBatchRecognizeOptions): Promise<IBatchRecognizeFileResult> {
  const recognizer = `projects/${projectId}/locations/${config.region}/recognizers/_`;
  // Flags de diagnóstico — para isolar quando algo falha com "internal error":
  //   GOOGLE_TRANSCRIPTION_DISABLE_PHRASES=1 → manda sem phrase set
  //   GOOGLE_TRANSCRIPTION_FORCE_NO_DIAR=1   → ignora DIARIZATION_ENABLED
  const disablePhrases = process.env.GOOGLE_TRANSCRIPTION_DISABLE_PHRASES === "1";
  const forceNoDiar = process.env.GOOGLE_TRANSCRIPTION_FORCE_NO_DIAR === "1";

  const phrases = disablePhrases ? [] : buildPhraseHints(metadata);

  const features: google.cloud.speech.v2.IRecognitionFeatures = {
    enableAutomaticPunctuation: true,
    enableWordTimeOffsets: true,
  };
  if (config.diarizationEnabled && !forceNoDiar) {
    features.diarizationConfig = {
      minSpeakerCount: config.diarization.minSpeakerCount,
      maxSpeakerCount: config.diarization.maxSpeakerCount,
    };
  }

  const request: google.cloud.speech.v2.IBatchRecognizeRequest = {
    recognizer,
    config: {
      autoDecodingConfig: {},
      languageCodes: [config.language],
      model: config.model,
      features,
      adaptation: phrases.length > 0 ? adaptationFromPhrases(phrases) : undefined,
    },
    files: [{ uri: audioGcsUri }],
    recognitionOutputConfig: {
      inlineResponseConfig: {},
    },
  };

  let response: google.cloud.speech.v2.IBatchRecognizeResponse;
  try {
    console.info("[google] batchRecognize request:", {
      recognizer,
      model: config.model,
      language: config.language,
      audioGcsUri,
      phraseSetSize: phrases.length,
      diarization: config.diarization,
    });
    const [operation] = await client.batchRecognize(request);
    console.info("[google] LRO started:", operation.name);
    const [completed] = await operation.promise();
    response = completed;
  } catch (err) {
    const e = err as Record<string, unknown> & { stack?: string };
    console.error("[google] batchRecognize falhou — propriedades:", {
      message: e.message,
      code: e.code,
      details: e.details,
      status: e.status,
      reason: e.reason,
      cause: e.cause,
      note: e.note,
      statusDetails: e.statusDetails,
      ownProps: Object.getOwnPropertyNames(err as object),
    });
    if (e.stack) console.error("[google] stack:", e.stack);
    const detail =
      (typeof e.details === "string" && e.details) ||
      (typeof e.message === "string" && e.message) ||
      (typeof e.reason === "string" && e.reason) ||
      "Falha desconhecida na API Speech-to-Text.";
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      `Falha ao executar batchRecognize: ${detail}`
    );
  }

  const fileResult = response.results?.[audioGcsUri];
  if (!fileResult) {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Resposta da API Speech-to-Text não contém resultado para o áudio enviado."
    );
  }

  if (fileResult.error?.code) {
    const message = fileResult.error.message ?? "erro sem mensagem";
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      `API Speech-to-Text retornou erro: ${message}`
    );
  }

  return fileResult;
}

export async function resolveProjectId(client: SpeechV2Client): Promise<string> {
  const projectId = await client.getProjectId();
  if (!projectId) {
    throw new LocalTranscriptionError(
      "GOOGLE_CREDENTIALS_NOT_FOUND",
      "Não foi possível resolver o projectId via credenciais Google."
    );
  }
  return projectId;
}
