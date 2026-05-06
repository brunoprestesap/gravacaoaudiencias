import type { TranscriptSegment } from "@/lib/transcription-diarization";
import type { ProcessMetadata } from "@/types/recording";

export interface TranscribeLocalRecordingInput {
  inputVideoPath: string;
  /** Código de idioma passado ao whisper.cpp (padrão: pt). */
  language?: string;
  /** Metadados do processo — usados como bias léxico no motor `google` (phrase hints). */
  metadata?: ProcessMetadata;
}

export interface TranscribeLocalRecordingResult {
  text: string;
  segments: TranscriptSegment[];
}
