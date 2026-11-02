export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { recoverStuckTranscriptions } = await import("@/lib/transcricao-recovery");
    await recoverStuckTranscriptions();
    const { recoverStuckTermos } = await import("@/lib/termo-recovery");
    await recoverStuckTermos();
  } catch (err) {
    console.error("[instrumentation] falha ao recuperar transcrições e termos zumbis no boot:", err);
  }
}
