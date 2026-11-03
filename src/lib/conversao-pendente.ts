import { mkdir, readdir, rename, rm, stat } from "fs/promises";
import path from "path";
import { resolveUploadPath } from "@/lib/upload-path";

const PENDING_DIR = "conversoes-pendentes";
const CONVERTING_SUFFIX = ".convertendo.webm";
const ATTEMPTED_SUFFIX = ".ja-tentado.webm";

function withSuffix(pendingPath: string, suffix: string): string {
  return pendingPath.replace(/\.webm$/, suffix);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * WebM guardado depois de uma conversão que falhou, para tentar de novo sem novo envio.
 * O tamanho enviado faz parte do nome: quem retomou a gravação tem mais chunks, envia
 * outro tamanho e não encontra o arquivo antigo, que não tem o trecho novo.
 */
export function pendingConversionPath(gravacaoId: string, inputBytes: number): string | null {
  return resolveUploadPath(path.join(PENDING_DIR, `${gravacaoId}.${inputBytes}.webm`));
}

/**
 * Destino do WebM quando a nova tentativa também falha. Com outro nome, a tentativa
 * seguinte não o encontra e o navegador envia os chunks, em vez de insistir no mesmo
 * arquivo para sempre. O WebM continua no disco até ser substituído por esse envio.
 */
export function attemptedConversionPath(pendingPath: string): string {
  return withSuffix(pendingPath, ATTEMPTED_SUFFIX);
}

/**
 * Reserva o WebM guardado para uma única conversão. Renomear é atômico, então entre
 * duas tentativas simultâneas só uma consegue, e elas não gravam o mesmo MP4 juntas.
 * Retorna `null` quando não há nada para reservar.
 */
export async function claimPendingConversion(pendingPath: string): Promise<string | null> {
  const claimedPath = withSuffix(pendingPath, CONVERTING_SUFFIX);
  try {
    await rename(pendingPath, claimedPath);
    return claimedPath;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function isConversionRunning(pendingPath: string): Promise<boolean> {
  return stat(withSuffix(pendingPath, CONVERTING_SUFFIX)).then(
    () => true,
    () => false
  );
}

export async function removePendingConversions(
  gravacaoId: string,
  exceptPath?: string
): Promise<void> {
  const dir = resolveUploadPath(PENDING_DIR);
  if (!dir) return;
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${gravacaoId}.`))
      .map((name) => path.join(dir, name))
      .filter((filePath) => filePath !== exceptPath)
      .map((filePath) => rm(filePath, { force: true }))
  );
}

/** Guarda o WebM em `targetPath` e só então apaga o de um envio anterior. */
export async function keepForRetry(
  webmPath: string,
  targetPath: string,
  gravacaoId: string
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await rename(webmPath, targetPath);
  } catch (error) {
    // A gravação pode ter sido excluída durante a conversão.
    if (isMissingFile(error)) return;
    throw error;
  }
  await removePendingConversions(gravacaoId, targetPath);
}

/** Uma queda do servidor no meio da conversão não pode deixar o WebM reservado para sempre. */
export async function restoreInterruptedConversions(): Promise<number> {
  const dir = resolveUploadPath(PENDING_DIR);
  if (!dir) return 0;
  const names = await readdir(dir).catch(() => [] as string[]);
  const interrupted = names.filter((name) => name.endsWith(CONVERTING_SUFFIX));
  await Promise.all(
    interrupted.map((name) =>
      rename(path.join(dir, name), path.join(dir, name.slice(0, -CONVERTING_SUFFIX.length) + ".webm"))
    )
  );
  return interrupted.length;
}
