export type LocalTranscriptionErrorCode =
  | "CONFIG_MISSING"
  | "INPUT_NOT_FOUND"
  | "FFMPEG_NOT_AVAILABLE"
  | "WHISPER_NOT_AVAILABLE"
  | "PYTHON_NOT_AVAILABLE"
  | "TRANSCRIPTION_FAILED"
  | "EMPTY_TRANSCRIPTION"
  | "GOOGLE_CREDENTIALS_NOT_FOUND"
  | "GCS_BUCKET_NOT_CONFIGURED"
  | "GCS_BUCKET_INACCESSIBLE";

export class LocalTranscriptionError extends Error {
  code: LocalTranscriptionErrorCode;

  constructor(code: LocalTranscriptionErrorCode, message: string) {
    super(message);
    this.name = "LocalTranscriptionError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
