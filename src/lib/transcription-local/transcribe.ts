import { access, mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { createBatchSegmentsFromText, type TranscriptSegment } from "@/lib/transcription-diarization";
import { extractSegmentVoiceFeatures } from "@/lib/voice-features";
import { LocalTranscriptionError } from "./errors";
import { getLocalTranscriptionEngine } from "./engine";
import { normalizeAudio } from "./audio";
import { getWhisperConfig, runWhisperCpp, parseVttToSegments } from "./whisper";
import { runWav2VecPython, segmentsFromWav2VecPayload, parseWav2VecTranscriptionOutput } from "./wav2vec";
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

export async function transcribeLocalRecording({
  inputVideoPath,
  language = "pt",
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
    await normalizeAudio(inputVideoPath, normalizedWavPath);

    const { text, baseSegments } =
      engine === "whisper"
        ? await transcribeNormalizedWavWithWhisper(normalizedWavPath, tempDir, language)
        : await transcribeNormalizedWavWithWav2Vec(normalizedWavPath, tempDir);

    if (!text) {
      throw new LocalTranscriptionError(
        "EMPTY_TRANSCRIPTION",
        "A transcrição foi concluída, mas o texto retornou vazio."
      );
    }

    const segmentsWithVoice = await extractSegmentVoiceFeatures(baseSegments, normalizedWavPath);

    return {
      text,
      segments: segmentsWithVoice,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
