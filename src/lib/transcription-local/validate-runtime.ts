import { access } from "fs/promises";
import { LocalTranscriptionError } from "./errors";
import { execFileAsync } from "./exec";
import { getLocalTranscriptionEngine } from "./engine";
import { getWhisperConfig } from "./whisper";
import { getTranscriptionPython, getWav2VecScriptPath } from "./wav2vec";

export async function validateLocalTranscriptionRuntime() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    throw new LocalTranscriptionError(
      "FFMPEG_NOT_AVAILABLE",
      "FFmpeg não está disponível no servidor."
    );
  }

  const engine = getLocalTranscriptionEngine();

  if (engine === "whisper") {
    const { whisperBin, whisperModelPath } = getWhisperConfig();
    try {
      await access(whisperModelPath);
    } catch {
      throw new LocalTranscriptionError(
        "CONFIG_MISSING",
        "Modelo Whisper não encontrado no caminho configurado."
      );
    }

    try {
      await execFileAsync(whisperBin, ["--help"]);
    } catch {
      throw new LocalTranscriptionError(
        "WHISPER_NOT_AVAILABLE",
        "Binário do whisper.cpp não está disponível ou não é executável."
      );
    }
    return;
  }

  const scriptPath = getWav2VecScriptPath();
  try {
    await access(scriptPath);
  } catch {
    throw new LocalTranscriptionError(
      "CONFIG_MISSING",
      `Script de transcrição Wav2Vec2 não encontrado: ${scriptPath}`
    );
  }

  const pythonBin = getTranscriptionPython();
  try {
    await execFileAsync(pythonBin, [scriptPath, "--check"]);
  } catch {
    throw new LocalTranscriptionError(
      "PYTHON_NOT_AVAILABLE",
      "Python 3 com PyTorch e Transformers não está disponível ou falhou na verificação (--check). " +
        "Instale as dependências em requirements-transcription.txt e defina TRANSCRIPTION_PYTHON se necessário."
    );
  }
}
