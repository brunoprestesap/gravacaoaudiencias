import { access, mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import {
  createBatchSegmentsFromText,
  harmonizeRolesByUpstreamSpeaker,
  type TranscriptSegment,
} from "@/lib/transcription-diarization";
import {
  collapseHallucinationCycles,
  collapseNearDuplicateLongSegments,
  collapseRepetitionsWithinSegments,
  filterWhisperHallucinations,
  mergeConsecutiveSameSpeakerSegments,
  rebuildTextFromSegments,
} from "@/lib/transcription-cleanup";
import { extractSegmentVoiceFeatures } from "@/lib/voice-features";
import { LocalTranscriptionError } from "./errors";
import { getLocalTranscriptionEngine } from "./engine";
import { findTranscriptionAudioSibling, normalizeAudio } from "./audio";
import { getWhisperConfig, runWhisperCpp, parseVttToSegments } from "./whisper";
import { runWav2VecPython, segmentsFromWav2VecPayload, parseWav2VecTranscriptionOutput } from "./wav2vec";
import {
  runLegalWhisperPython,
  segmentsFromLegalWhisperPayload,
  parseLegalWhisperTranscriptionOutput,
} from "./legal-whisper";
import { transcribeNormalizedWavWithGoogle } from "./google";
import { transcribeWithMock } from "./mock";
import { isVadEnabled, mapSegmentsToOriginalTimeline, runVadPreprocess } from "./vad";
import type { ProcessMetadata } from "@/types/recording";
import type { TranscribeLocalRecordingInput, TranscribeLocalRecordingResult } from "./types";

async function transcribeNormalizedWavWithWhisper(
  normalizedWavPath: string,
  tempDir: string,
  language: string
): Promise<{ text: string; baseSegments: TranscriptSegment[] }> {
  const { whisperBin, whisperModelPath } = getWhisperConfig();
  const outputBasePath = path.join(tempDir, "transcricao");
  const outputTextPath = `${outputBasePath}.txt`;
  const outputVttPath = `${outputBasePath}.vtt`;

  await runWhisperCpp(whisperBin, whisperModelPath, normalizedWavPath, outputBasePath, language);
  const text = (await readFile(outputTextPath, "utf-8")).trim();

  let baseSegments: TranscriptSegment[];
  try {
    const vttContent = await readFile(outputVttPath, "utf-8");
    const vttSegments = parseVttToSegments(vttContent);
    baseSegments = vttSegments.length > 0 ? vttSegments : createBatchSegmentsFromText(text);
  } catch {
    baseSegments = createBatchSegmentsFromText(text);
  }

  return { text, baseSegments };
}

async function transcribeNormalizedWavWithWav2Vec(
  normalizedWavPath: string,
  tempDir: string
): Promise<{ text: string; baseSegments: TranscriptSegment[] }> {
  const jsonOutPath = path.join(tempDir, "transcricao.json");
  await runWav2VecPython(normalizedWavPath, jsonOutPath);

  const raw = await readFile(jsonOutPath, "utf-8");
  const payload = parseWav2VecTranscriptionOutput(raw);
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const fromModel = segmentsFromWav2VecPayload(payload);
  return { text, baseSegments: fromModel ?? createBatchSegmentsFromText(text) };
}

async function transcribeNormalizedWavWithLegalWhisper(
  normalizedWavPath: string,
  tempDir: string
): Promise<{ text: string; baseSegments: TranscriptSegment[] }> {
  const jsonOutPath = path.join(tempDir, "transcricao.json");
  await runLegalWhisperPython(normalizedWavPath, jsonOutPath);

  const raw = await readFile(jsonOutPath, "utf-8");
  const payload = parseLegalWhisperTranscriptionOutput(raw);
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const fromModel = segmentsFromLegalWhisperPayload(payload);
  return { text, baseSegments: fromModel ?? createBatchSegmentsFromText(text) };
}

async function dispatchEngine(
  engine: ReturnType<typeof getLocalTranscriptionEngine>,
  asrInputWavPath: string,
  tempDir: string,
  language: string,
  metadata?: ProcessMetadata
): Promise<{ text: string; baseSegments: TranscriptSegment[] }> {
  if (engine === "mock") {
    return transcribeWithMock();
  }
  if (engine === "whisper") {
    return transcribeNormalizedWavWithWhisper(asrInputWavPath, tempDir, language);
  }
  if (engine === "wav2vec2") {
    return transcribeNormalizedWavWithWav2Vec(asrInputWavPath, tempDir);
  }
  if (engine === "legal-whisper") {
    return transcribeNormalizedWavWithLegalWhisper(asrInputWavPath, tempDir);
  }
  return transcribeNormalizedWavWithGoogle(asrInputWavPath, metadata);
}

export async function transcribeLocalRecording({
  inputVideoPath,
  language = "pt",
  metadata,
}: TranscribeLocalRecordingInput): Promise<TranscribeLocalRecordingResult> {
  const engine = getLocalTranscriptionEngine();

  try {
    await access(inputVideoPath);
  } catch {
    throw new LocalTranscriptionError("INPUT_NOT_FOUND", "Arquivo da gravação não encontrado.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audiencia-transcricao-"));
  const normalizedWavPath = path.join(tempDir, "audio.wav");

  try {
    // Prefere o WAV pré-extraído (sibling .transcricao.wav). Vem direto do
    // WebM original (Opus → PCM, uma só decode lossy), evitando a 2ª
    // compressão do MP4/AAC que apaga ~7-8kHz do espectro entregue ao Chirp.
    const audioSourcePath =
      (await findTranscriptionAudioSibling(inputVideoPath)) ?? inputVideoPath;

    // Doc oficial Speech-to-Text v2 (best-practices): "All noise reduction
    // processing should be disabled". Isso fala de DENOISING (highpass,
    // lowpass, supressão espectral) — loudnorm puro é apenas ajuste de
    // ganho e ajuda em audiências com mics a distâncias diferentes.
    // Para o engine `google`: aceita `basic` e `loudness`; rebaixa `full`
    // (que inclui highpass/lowpass) para `loudness`.
    if (engine === "google") {
      const envMode = (process.env.TRANSCRIPTION_AUDIO_PREPROCESS ?? "basic").trim().toLowerCase();
      const safeMode = envMode === "loudness" ? "loudness" : "basic";
      await normalizeAudio(audioSourcePath, normalizedWavPath, { mode: safeMode });
    } else {
      await normalizeAudio(audioSourcePath, normalizedWavPath);
    }

    let asrInputWavPath = normalizedWavPath;
    let vadMapping: Awaited<ReturnType<typeof runVadPreprocess>> = null;

    // VAD é específico de motores locais — Chirp 2 já faz VAD interno,
    // e adicionar um round-trip de Python só pra esse caso não compensa.
    if (engine !== "google" && isVadEnabled()) {
      const speechWavPath = path.join(tempDir, "audio-speech.wav");
      const vadJsonPath = path.join(tempDir, "vad.json");
      vadMapping = await runVadPreprocess(normalizedWavPath, speechWavPath, vadJsonPath);
      // Se VAD não detectou fala, mantém o áudio original (fallback seguro).
      if (vadMapping && vadMapping.segments.length > 0) {
        asrInputWavPath = speechWavPath;
      }
    }

    const { text, baseSegments } = await dispatchEngine(
      engine,
      asrInputWavPath,
      tempDir,
      language,
      metadata
    );

    if (!text) {
      throw new LocalTranscriptionError(
        "EMPTY_TRANSCRIPTION",
        "A transcrição foi concluída, mas o texto retornou vazio."
      );
    }

    const remappedSegments =
      vadMapping && vadMapping.segments.length > 0
        ? mapSegmentsToOriginalTimeline(baseSegments, vadMapping.segments)
        : baseSegments;

    // Pipeline de cleanup:
    // 1. mergeConsecutiveSameSpeakerSegments: junta segmentos vizinhos do
    //    mesmo speakerId upstream (Chirp 3 fragmenta a cada ~15s mesmo no
    //    mesmo speaker — hallucinations cíclicas escapam das fronteiras).
    //    No-op para engines sem speakerId (whisper local).
    // 2. collapseRepetitionsWithinSegments: colapsa ciclos DENTRO do texto
    //    de um segmento ("o que que é..." x N → 1).
    // 3. filterWhisperHallucinations: frases-âncora do corpus do Whisper
    //    (YouTube etc). Pulado para `google` (Chirp não tem essas).
    // 4. collapseHallucinationCycles + collapseNearDuplicateLongSegments:
    //    detectam loops ENTRE segmentos. Modelo-agnósticos.
    const merged = mergeConsecutiveSameSpeakerSegments(remappedSegments);
    const mergeChanged = merged.length !== remappedSegments.length;

    const intraDeduped = collapseRepetitionsWithinSegments(merged);
    const intraChanged = intraDeduped.some((s, i) => s !== merged[i]);

    const filteredSegments =
      engine === "google" ? intraDeduped : filterWhisperHallucinations(intraDeduped);
    const filterChanged = filteredSegments.length !== intraDeduped.length;

    const dedupedSegments = collapseNearDuplicateLongSegments(
      collapseHallucinationCycles(filteredSegments)
    );
    const dedupeChanged = dedupedSegments.length !== filteredSegments.length;

    // Detecta QUALQUER mudança no pipeline (não só remoção de segmentos),
    // incluindo modificações in-place do texto (intra-collapse). Antes este
    // check só comparava length, e o texto cleaned era descartado em favor
    // do `text` original com a hallucination intacta.
    const cleanupChanged = mergeChanged || intraChanged || filterChanged || dedupeChanged;
    const finalText = cleanupChanged ? rebuildTextFromSegments(dedupedSegments) : text;

    console.info(
      `[transcricao] engine=${engine} ` +
        `vad=${vadMapping ? vadMapping.segments.length : 0} ` +
        `segments=${remappedSegments.length}→${dedupedSegments.length} ` +
        `chars=${finalText.length}`
    );

    // Voice features sempre extraídas do áudio original normalizado para preservar
    // pitch/energia reais; se rodássemos sobre o WAV concatenado pelo VAD, prosódia
    // seria distorcida nos boundaries.
    const segmentsWithVoice = await extractSegmentVoiceFeatures(dedupedSegments, normalizedWavPath);

    // Quando o engine entrega speakerId upstream (Chirp 3), agrupa por speaker
    // e estampa o papel dominante (JUIZ/PARTE/PROCURADOR) em todos os segmentos
    // do mesmo speaker. Evita "JUIZCorreto" / "PARTEDe quem que é a casa?" —
    // inferência por segmento isolado oscila com o conteúdo textual.
    // No-op para engines sem speakerId.
    const harmonized = harmonizeRolesByUpstreamSpeaker(segmentsWithVoice, metadata);

    return {
      text: finalText,
      segments: harmonized,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
