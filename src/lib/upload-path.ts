import path from "path";

/**
 * Converte um caminho relativo guardado no banco em caminho absoluto dentro de
 * UPLOAD_DIR. Retorna `null` se ele apontar para fora (ou para o próprio diretório).
 */
export function resolveUploadPath(relativePath: string): string | null {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
  const absolutePath = path.resolve(uploadDir, relativePath);
  return absolutePath.startsWith(uploadDir + path.sep) ? absolutePath : null;
}
