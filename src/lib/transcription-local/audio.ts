import { LocalTranscriptionError } from "./errors";
import { execFileAsync } from "./exec";

export async function normalizeAudio(inputVideoPath: string, outputWavPath: string) {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputVideoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputWavPath,
    ]);
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao normalizar áudio da gravação."
    );
  }
}
