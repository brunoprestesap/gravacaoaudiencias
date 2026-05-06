export function getMockPort(): number {
  const raw = process.env.E2E_MARITACA_PORT ?? "39871";
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`E2E_MARITACA_PORT inválida: "${raw}"`);
  }
  return port;
}
