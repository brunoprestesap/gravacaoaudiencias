import { access } from "fs/promises";
import { LocalTranscriptionError } from "./errors";
import { execFileAsync } from "./exec";
import { getLocalTranscriptionEngine } from "./engine";
import { getWhisperConfig } from "./whisper";
import { getTranscriptionPython, getWav2VecScriptPath } from "./wav2vec";
import { getLegalWhisperScriptPath } from "./legal-whisper";
import { getVadScriptPath, isVadEnabled } from "./vad";
import { createStorageClient, getGoogleTranscriptionConfig } from "./google/client";

async function validateGoogleRuntime() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialsPath) {
    throw new LocalTranscriptionError(
      "GOOGLE_CREDENTIALS_NOT_FOUND",
      "GOOGLE_APPLICATION_CREDENTIALS não está definido. Aponte para o JSON da Service Account."
    );
  }
  try {
    await access(credentialsPath);
  } catch {
    throw new LocalTranscriptionError(
      "GOOGLE_CREDENTIALS_NOT_FOUND",
      `Arquivo de credenciais Google não encontrado: ${credentialsPath}`
    );
  }

  // Lança GCS_BUCKET_NOT_CONFIGURED se faltar GCS_TRANSCRIPTION_BUCKET.
  const config = getGoogleTranscriptionConfig();

  // bucket.exists() exige storage.buckets.get, que NÃO está em
  // roles/storage.objectAdmin (escopo recomendado para a SA). Em vez disso,
  // tenta listar 1 objeto — usa apenas storage.objects.list, que objectAdmin
  // cobre. Bucket inexistente → 404; sem permissão → 403; ambos viram
  // GCS_BUCKET_INACCESSIBLE.
  const storage = createStorageClient();
  try {
    await storage
      .bucket(config.bucketName)
      .getFiles({ maxResults: 1, autoPaginate: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    throw new LocalTranscriptionError(
      "GCS_BUCKET_INACCESSIBLE",
      `Falha ao acessar bucket "${config.bucketName}": ${message}`
    );
  }
}

async function validateVadRuntime() {
  if (!isVadEnabled()) return;
  const scriptPath = getVadScriptPath();
  try {
    await access(scriptPath);
  } catch {
    throw new LocalTranscriptionError(
      "CONFIG_MISSING",
      `Script VAD não encontrado: ${scriptPath}`
    );
  }
  const pythonBin = getTranscriptionPython();
  try {
    await execFileAsync(pythonBin, [scriptPath, "--check"]);
  } catch {
    throw new LocalTranscriptionError(
      "PYTHON_NOT_AVAILABLE",
      "Pacote silero-vad indisponível para o Python configurado. " +
        "Instale com: pip install silero-vad (ou desabilite com TRANSCRIPTION_USE_VAD=0)."
    );
  }
}

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

  if (engine === "mock") {
    return;
  }

  if (engine === "google") {
    await validateGoogleRuntime();
    return;
  }

  await validateVadRuntime();

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

  if (engine === "legal-whisper") {
    const scriptPath = getLegalWhisperScriptPath();
    try {
      await access(scriptPath);
    } catch {
      throw new LocalTranscriptionError(
        "CONFIG_MISSING",
        `Script de transcrição Whisper PEFT não encontrado: ${scriptPath}`
      );
    }

    const pythonBin = getTranscriptionPython();
    try {
      await execFileAsync(pythonBin, [scriptPath, "--check"]);
    } catch {
      throw new LocalTranscriptionError(
        "PYTHON_NOT_AVAILABLE",
        "Python 3 com PyTorch, Transformers e PEFT não está disponível ou falhou na verificação (--check). " +
          "Instale as dependências em requirements-transcription.txt e defina TRANSCRIPTION_PYTHON se necessário."
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
