export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { recoverStuckTranscriptions } = await import("@/lib/transcricao-recovery");
    await recoverStuckTranscriptions();
  } catch (err) {
    console.error("[instrumentation] falha ao recuperar transcrições zumbi no boot:", err);
  }
}
