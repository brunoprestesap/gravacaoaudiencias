import type { TranscriptSegment } from "@/lib/transcription-diarization";

export interface TranscribeLocalRecordingInput {
  inputVideoPath: string;
  /** Código de idioma passado ao whisper.cpp (padrão: pt). */
  language?: string;
}

export interface TranscribeLocalRecordingResult {
  text: string;
  segments: TranscriptSegment[];
}
