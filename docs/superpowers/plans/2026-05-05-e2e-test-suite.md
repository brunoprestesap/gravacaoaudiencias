# Suite e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o smoke atual por uma suite Playwright que cobre auth, gravação, upload, consulta, transcrição, termo e exports — hermética, sem custo externo, < 5 min local.

**Architecture:** Mock server local da Maritaca (HTTP via `node:http`, porta efêmera) + motor `mock` em `LOCAL_TRANSCRIPTION_ENGINE` para transcrição. Banco PostgreSQL dedicado por `E2E_DATABASE_URL`; teardown via `DELETE WHERE id LIKE 'e2e-%'`. Storage states autenticados gerados uma vez no `globalSetup`. Specs rodam em paralelo (Chromium headless com `--use-fake-device-for-media-stream`).

**Tech Stack:** Playwright 1.58, Prisma client, `node:http`, FFmpeg local, Chromium.

**Spec base:** [docs/superpowers/specs/2026-05-05-e2e-test-suite-design.md](2026-05-05-e2e-test-suite-design.md)

---

## File Structure

| Path | Responsabilidade |
|------|------------------|
| [src/lib/transcription-local/mock.ts](../../src/lib/transcription-local/mock.ts) | Motor mock que retorna segmentos/texto fixos sem dependências externas |
| [src/lib/transcription-local/engine.ts](../../src/lib/transcription-local/engine.ts) | Adicionar `"mock"` ao tipo e ao parser de env var |
| [src/lib/transcription-local/transcribe.ts](../../src/lib/transcription-local/transcribe.ts) | Branch `engine === "mock"` no dispatcher |
| [src/lib/transcription-local/validate-runtime.ts](../../src/lib/transcription-local/validate-runtime.ts) | Branch `engine === "mock"` que pula validação |
| [e2e/fixtures/maritaca-mock.ts](../../e2e/fixtures/maritaca-mock.ts) | HTTP server stub do endpoint `/chat/completions` |
| [e2e/fixtures/db.ts](../../e2e/fixtures/db.ts) | Helpers Prisma (criar/limpar gravações, seedar transcrição/termo) |
| [e2e/fixtures/files.ts](../../e2e/fixtures/files.ts) | Path helper para fixtures binárias |
| [e2e/fixtures/sample.webm](../../e2e/fixtures/sample.webm) | Vídeo de teste binário (~50KB) |
| [e2e/fixtures/sample.mp4](../../e2e/fixtures/sample.mp4) | Vídeo MP4 simulando upload já processado |
| [e2e/support/global-setup.ts](../../e2e/support/global-setup.ts) | Validação de env, sobe mock, gera storageStates |
| [e2e/support/global-teardown.ts](../../e2e/support/global-teardown.ts) | Para mock, limpa DB, remove uploads |
| [e2e/support/test.ts](../../e2e/support/test.ts) | Custom `test` com fixtures `db`, `mockMaritaca` |
| [e2e/support/maritaca-mock-port.ts](../../e2e/support/maritaca-mock-port.ts) | Helper que lê/escreve a porta do mock em arquivo temp |
| [e2e/auth.spec.ts](../../e2e/auth.spec.ts) | Login, logout, redirects |
| [e2e/access-control.spec.ts](../../e2e/access-control.spec.ts) | Middleware roles + autorização API |
| [e2e/dashboard.spec.ts](../../e2e/dashboard.spec.ts) | Painel SERVIDOR/JUIZ |
| [e2e/gravacao-crud.spec.ts](../../e2e/gravacao-crud.spec.ts) | API CRUD via `request.fetch` |
| [e2e/consulta.spec.ts](../../e2e/consulta.spec.ts) | Lista, busca debounced, paginação, delete |
| [e2e/upload.spec.ts](../../e2e/upload.spec.ts) | POST /api/upload com WebM real |
| [e2e/transcricao.spec.ts](../../e2e/transcricao.spec.ts) | API + UI da transcrição |
| [e2e/reproducao.spec.ts](../../e2e/reproducao.spec.ts) | Player, range request |
| [e2e/termo.spec.ts](../../e2e/termo.spec.ts) | Geração via mock Maritaca, edição |
| [e2e/termo-export.spec.ts](../../e2e/termo-export.spec.ts) | Export PDF/DOCX |
| [playwright.config.ts](../../playwright.config.ts) | Config atualizado: globalSetup, env, args browser |
| [.env.e2e.example](../../.env.e2e.example) | Template do env de teste |
| [package.json](../../package.json) | Scripts `test:e2e:setup` e `test:e2e` ajustados |

---

## Task 1: Motor de transcrição `mock`

**Files:**
- Create: `src/lib/transcription-local/mock.ts`
- Create: `src/lib/transcription-local/mock.test.ts`
- Modify: `src/lib/transcription-local/engine.ts`
- Modify: `src/lib/transcription-local/transcribe.ts:86-103`
- Modify: `src/lib/transcription-local/validate-runtime.ts:73-90`

- [ ] **Step 1.1: Criar teste do mock engine (falhando)**

Conteúdo de `src/lib/transcription-local/mock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { transcribeWithMock } from "./mock";

describe("transcribeWithMock", () => {
  it("retorna texto e segmentos fixos sem depender de IO real", async () => {
    const result = await transcribeWithMock();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.baseSegments.length).toBeGreaterThanOrEqual(3);
    expect(result.baseSegments[0]).toMatchObject({
      text: expect.any(String),
      offsetMs: expect.any(Number),
    });
  });

  it("produz segmentos com offsets monotonicamente crescentes", async () => {
    const { baseSegments } = await transcribeWithMock();
    for (let i = 1; i < baseSegments.length; i += 1) {
      expect(baseSegments[i].offsetMs).toBeGreaterThan(baseSegments[i - 1].offsetMs);
    }
  });
});
```

- [ ] **Step 1.2: Rodar teste e confirmar falha**

Run: `npx vitest run src/lib/transcription-local/mock.test.ts`
Expected: FAIL com erro de import (módulo `./mock` não existe).

- [ ] **Step 1.3: Implementar o motor mock**

Conteúdo de `src/lib/transcription-local/mock.ts`:

```ts
import type { TranscriptSegment } from "@/lib/transcription-diarization";

const FIXED_SEGMENTS: Array<{ text: string; offsetMs: number; speakerId: string }> = [
  { text: "Está aberta a audiência.", offsetMs: 0, speakerId: "S1" },
  { text: "Boa tarde, excelência.", offsetMs: 2000, speakerId: "S2" },
  { text: "Vamos prosseguir com a oitiva.", offsetMs: 4000, speakerId: "S1" },
];

export async function transcribeWithMock(): Promise<{
  text: string;
  baseSegments: TranscriptSegment[];
}> {
  const baseSegments: TranscriptSegment[] = FIXED_SEGMENTS.map((seg, idx) => ({
    id: `mock-${idx}`,
    text: seg.text,
    offsetMs: seg.offsetMs,
    createdAt: new Date(0).toISOString(),
    speakerId: seg.speakerId,
    startMs: seg.offsetMs,
    endMs: seg.offsetMs + 1500,
    confidence: 0.99,
  }));
  const text = baseSegments.map((s) => s.text).join(" ");
  return { text, baseSegments };
}
```

- [ ] **Step 1.4: Atualizar tipo e parser em [engine.ts](../../src/lib/transcription-local/engine.ts)**

Substituir o conteúdo inteiro do arquivo por:

```ts
export type LocalTranscriptionEngine =
  | "whisper"
  | "wav2vec2"
  | "legal-whisper"
  | "google"
  | "mock";

export function getLocalTranscriptionEngine(): LocalTranscriptionEngine {
  const raw = (process.env.LOCAL_TRANSCRIPTION_ENGINE ?? "whisper").trim().toLowerCase();
  if (raw === "wav2vec2" || raw === "wav2vec") {
    return "wav2vec2";
  }
  if (raw === "legal-whisper" || raw === "legalwhisper" || raw === "legal_whisper") {
    return "legal-whisper";
  }
  if (raw === "google" || raw === "gcp" || raw === "chirp" || raw === "chirp_2") {
    return "google";
  }
  if (raw === "mock") {
    return "mock";
  }
  return "whisper";
}
```

- [ ] **Step 1.5: Adicionar dispatch em [transcribe.ts](../../src/lib/transcription-local/transcribe.ts)**

No topo do arquivo, adicionar import (após linha 28):

```ts
import { transcribeWithMock } from "./mock";
```

Substituir a função `dispatchEngine` (linhas 86–103 do arquivo atual) por:

```ts
async function dispatchEngine(
  engine: ReturnType<typeof getLocalTranscriptionEngine>,
  asrInputWavPath: string,
  tempDir: string,
  language: string,
  metadata?: ProcessMetadata
): Promise<{ text: string; baseSegments: TranscriptSegment[] }> {
  if (engine === "mock") {
    return transcribeWithMock();
  }
  if (engine === "whisper") {
    return transcribeNormalizedWavWithWhisper(asrInputWavPath, tempDir, language);
  }
  if (engine === "wav2vec2") {
    return transcribeNormalizedWavWithWav2Vec(asrInputWavPath, tempDir);
  }
  if (engine === "legal-whisper") {
    return transcribeNormalizedWavWithLegalWhisper(asrInputWavPath, tempDir);
  }
  return transcribeNormalizedWavWithGoogle(asrInputWavPath, metadata);
}
```

- [ ] **Step 1.6: Pular validação para `mock` em [validate-runtime.ts](../../src/lib/transcription-local/validate-runtime.ts)**

Logo após a linha que verifica FFmpeg (após o bloco `try { await execFileAsync("ffmpeg", ["-version"]); } catch { ... }`), substituir o bloco que começa com `const engine = getLocalTranscriptionEngine();` por:

```ts
  const engine = getLocalTranscriptionEngine();

  if (engine === "mock") {
    return;
  }

  if (engine === "google") {
    await validateGoogleRuntime();
    return;
  }
```

(O resto do arquivo permanece igual.)

- [ ] **Step 1.7: Rodar teste do mock e os testes adjacentes**

Run: `npx vitest run src/lib/transcription-local/mock.test.ts`
Expected: PASS

Run: `npx vitest run src/lib/transcription-local/`
Expected: todos os testes existentes da pasta passam (zero regressão).

- [ ] **Step 1.8: Type-check**

Run: `npm run type-check`
Expected: nenhum erro novo.

- [ ] **Step 1.9: Commit**

```bash
git add src/lib/transcription-local/mock.ts src/lib/transcription-local/mock.test.ts \
  src/lib/transcription-local/engine.ts src/lib/transcription-local/transcribe.ts \
  src/lib/transcription-local/validate-runtime.ts
git commit -m "$(cat <<'EOF'
feat(transcription): add mock engine for e2e tests

Allows LOCAL_TRANSCRIPTION_ENGINE=mock to bypass Python/Whisper
without affecting production behavior (gated by env var).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Mock server da Maritaca

**Files:**
- Create: `e2e/fixtures/maritaca-mock.ts`
- Create: `e2e/support/maritaca-mock-port.ts`

**Estratégia de porta:** o mock escuta em porta FIXA passada via env var `E2E_MARITACA_PORT` (default `39871`). Tanto o `globalSetup` (que arranca o mock) quanto o `webServer` do Next.js (que recebe `MARITACA_BASE_URL=http://127.0.0.1:<porta>`) leem a mesma var, garantindo determinismo sem precisar de arquivo temp ou ordem de boot.

- [ ] **Step 2.1: Helper de leitura da porta**

Conteúdo de `e2e/support/maritaca-mock-port.ts`:

```ts
export function getMockPort(): number {
  const raw = process.env.E2E_MARITACA_PORT ?? "39871";
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`E2E_MARITACA_PORT inválida: "${raw}"`);
  }
  return port;
}
```

- [ ] **Step 2.2: Implementar mock server**

Conteúdo de `e2e/fixtures/maritaca-mock.ts`:

```ts
import http from "http";
import { AddressInfo } from "net";

interface RecordedCall {
  systemPrompt: string;
  userPrompt: string;
  authorization?: string;
}

export interface MaritacaMock {
  baseUrl: string;
  port: number;
  calls: RecordedCall[];
  stop(): Promise<void>;
}

interface IncomingBody {
  messages?: Array<{ role: string; content: string }>;
}

const TERMO_PADRAO = {
  tipoSentenca: "procedencia",
  presentes: {
    juiz: "Dr. Carlos Oliveira",
    autor: "João da Silva",
    reu: "Empresa XYZ Ltda",
  },
  resumoFatos:
    "Audiência de instrução realizada conforme transcrição apresentada. Partes presentes apresentaram suas razões.",
  dispositivo: [
    "a) Julgo procedente o pedido inicial.",
    "b) Condeno o réu ao pagamento das custas.",
  ],
  proximaProvidencia: "Intimação das partes para ciência da sentença.",
  markdown:
    "# Termo de Audiência\n\n**Processo:** ${processo}\n\nAudiência realizada com partes presentes.\n\n## Dispositivo\n\na) Julgo procedente.\nb) Custas pelo réu.",
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export async function startMaritacaMock(): Promise<MaritacaMock> {
  const calls: RecordedCall[] = [];

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      res.writeHead(400).end();
      return;
    }

    let parsed: IncomingBody;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }

    const messages = parsed.messages ?? [];
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
    const userPrompt = messages.find((m) => m.role === "user")?.content ?? "";
    calls.push({
      systemPrompt,
      userPrompt,
      authorization: req.headers.authorization,
    });

    if (userPrompt.includes("ERRO_FORCADO")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "forced_error_for_test" }));
      return;
    }

    const content = JSON.stringify(TERMO_PADRAO);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content },
          },
        ],
      })
    );
  });

  const desiredPort = Number.parseInt(process.env.E2E_MARITACA_PORT ?? "39871", 10);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(desiredPort, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    calls,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 2.3: Commit**

```bash
git add e2e/fixtures/maritaca-mock.ts e2e/support/maritaca-mock-port.ts
git commit -m "$(cat <<'EOF'
test(e2e): add Maritaca mock server fixture

HTTP server stub bound to E2E_MARITACA_PORT (default 39871) so the
Next.js webServer can resolve MARITACA_BASE_URL deterministically.
Records calls and supports ERRO_FORCADO trigger to test error paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Helpers de banco de dados

**Files:**
- Create: `e2e/fixtures/db.ts`

- [ ] **Step 3.1: Implementar helpers Prisma**

Conteúdo de `e2e/fixtures/db.ts`:

```ts
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";

let _client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_client) {
    const url = process.env.E2E_DATABASE_URL;
    if (!url) {
      throw new Error(
        "E2E_DATABASE_URL não está definido. Configure-o em .env.e2e antes de rodar a suite."
      );
    }
    _client = new PrismaClient({ datasources: { db: { url } } });
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}

export function e2eId(prefix: string = "grav"): string {
  return `e2e-${prefix}-${randomUUID()}`;
}

export interface SeedGravacaoInput {
  id?: string;
  ownerUsername: "servidor1" | "servidor2";
  numeroProcesso?: string;
  vara?: string | null;
  status?: "EM_ANDAMENTO" | "PAUSADA" | "FINALIZADA" | "INTERROMPIDA";
  caminhoArquivo?: string | null;
  modo?: "PRESENCIAL" | "HIBRIDO";
  transcricaoStatus?: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";
  transcricaoTexto?: string | null;
  transcricaoSegmentos?: unknown;
  termoStatus?: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";
  termoTexto?: string | null;
}

export async function seedGravacao(input: SeedGravacaoInput) {
  const prisma = getPrisma();
  const owner = await prisma.user.findUnique({ where: { username: input.ownerUsername } });
  if (!owner) {
    throw new Error(
      `Usuário ${input.ownerUsername} não encontrado. Rode 'npm run test:e2e:setup' primeiro.`
    );
  }
  return prisma.gravacao.create({
    data: {
      id: input.id ?? e2eId(),
      numeroProcesso: input.numeroProcesso ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      modo: input.modo ?? "PRESENCIAL",
      status: input.status ?? "EM_ANDAMENTO",
      vara: input.vara === undefined ? owner.vara : input.vara,
      caminhoArquivo: input.caminhoArquivo ?? null,
      transcricaoStatus: input.transcricaoStatus ?? "PENDENTE",
      transcricaoTexto: input.transcricaoTexto ?? null,
      transcricaoSegmentos:
        input.transcricaoSegmentos === undefined
          ? Prisma.JsonNull
          : (input.transcricaoSegmentos as Prisma.InputJsonValue),
      termoStatus: input.termoStatus ?? "PENDENTE",
      termoTexto: input.termoTexto ?? null,
      userId: owner.id,
    },
  });
}

export const SEED_TRANSCRICAO_SEGMENTOS = [
  {
    id: "seg-1",
    text: "Está aberta a audiência.",
    offsetMs: 0,
    createdAt: new Date(0).toISOString(),
    role: "JUIZ",
    speakerId: "S1",
    startMs: 0,
    endMs: 1500,
  },
  {
    id: "seg-2",
    text: "Boa tarde, excelência.",
    offsetMs: 2000,
    createdAt: new Date(0).toISOString(),
    role: "PARTE",
    speakerId: "S2",
    startMs: 2000,
    endMs: 3500,
  },
];

export async function cleanupE2eData(): Promise<void> {
  const prisma = getPrisma();
  await prisma.gravacao.deleteMany({ where: { id: { startsWith: "e2e-" } } });
}

export async function ensureUploadDir(uploadDir: string): Promise<void> {
  await fs.mkdir(uploadDir, { recursive: true });
}

export async function placeMp4Fixture(uploadDir: string, fixturePath: string, relativePath: string): Promise<void> {
  const target = path.join(uploadDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(fixturePath, target);
}
```

- [ ] **Step 3.2: Type-check**

Run: `npm run type-check`
Expected: nenhum erro novo (alguns imports podem reclamar de paths até criarmos o resto da infra; se reclamar de algo dentro de `e2e/`, ajustar).

- [ ] **Step 3.3: Commit**

```bash
git add e2e/fixtures/db.ts
git commit -m "test(e2e): add Prisma helpers for seeding and cleanup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fixtures binárias (sample.webm, sample.mp4)

**Files:**
- Create: `e2e/fixtures/sample.webm` (binário)
- Create: `e2e/fixtures/sample.mp4` (binário)
- Create: `e2e/fixtures/files.ts`

- [ ] **Step 4.1: Gerar `sample.webm`**

Run:
```bash
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=320x240:rate=10" \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -c:v libvpx -b:v 64k -c:a libopus -b:a 24k \
  e2e/fixtures/sample.webm
```

Expected: arquivo criado em `e2e/fixtures/sample.webm` com ~30-80 KB.

Verificar:
```bash
ffprobe -v error -show_entries stream=codec_name e2e/fixtures/sample.webm
```

Expected: lista codecs `vp8` e `opus`.

- [ ] **Step 4.2: Gerar `sample.mp4`**

Run:
```bash
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=320x240:rate=10" \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -b:v 64k \
  -c:a aac -b:a 32k -movflags +faststart \
  e2e/fixtures/sample.mp4
```

Expected: arquivo `e2e/fixtures/sample.mp4` com ~30-80 KB.

- [ ] **Step 4.3: Helper de paths**

Conteúdo de `e2e/fixtures/files.ts`:

```ts
import path from "path";

const FIXTURES_DIR = path.join(__dirname);

export const SAMPLE_WEBM = path.join(FIXTURES_DIR, "sample.webm");
export const SAMPLE_MP4 = path.join(FIXTURES_DIR, "sample.mp4");
```

- [ ] **Step 4.4: Commit**

```bash
git add e2e/fixtures/sample.webm e2e/fixtures/sample.mp4 e2e/fixtures/files.ts
git commit -m "test(e2e): add WebM and MP4 sample fixtures

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Global setup e teardown do Playwright

**Files:**
- Create: `e2e/support/global-setup.ts`
- Create: `e2e/support/global-teardown.ts`
- Create: `.env.e2e.example`
- Create diretório: `e2e/.auth/` (com `.gitignore`)

- [ ] **Step 5.1: Criar `.gitignore` em `e2e/.auth/`**

Run:
```bash
mkdir -p e2e/.auth && printf '*\n!.gitignore\n' > e2e/.auth/.gitignore
```

- [ ] **Step 5.2: Criar template do env**

Conteúdo de `.env.e2e.example`:

```env
# Banco PostgreSQL exclusivo para e2e (NÃO use o de dev)
E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/audiencia_e2e

# Diretório onde a suite escreve uploads (limpo no teardown)
E2E_UPLOAD_DIR=/tmp/audiencia-e2e-uploads
```

- [ ] **Step 5.3: Implementar `global-setup.ts`**

Conteúdo de `e2e/support/global-setup.ts`:

```ts
import { request } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import { startMaritacaMock } from "../fixtures/maritaca-mock";
import { cleanupE2eData, disconnectPrisma, ensureUploadDir, getPrisma } from "../fixtures/db";

const AUTH_DIR = path.join(__dirname, "..", ".auth");

const USERS = [
  { username: "servidor1", password: "senha123", file: "servidor1.json" },
  { username: "servidor2", password: "senha123", file: "servidor2.json" },
  { username: "juiz1", password: "senha123", file: "juiz1.json" },
] as const;

async function loginAndSaveStorageState(
  baseURL: string,
  username: string,
  password: string,
  outputFile: string
): Promise<void> {
  const ctx = await request.newContext({ baseURL });

  const csrfRes = await ctx.get("/api/auth/csrf");
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };

  const callbackRes = await ctx.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrfBody.csrfToken,
      username,
      password,
      callbackUrl: `${baseURL}/dashboard`,
      json: "true",
    },
  });

  if (callbackRes.status() >= 400) {
    const text = await callbackRes.text();
    throw new Error(`Login falhou para ${username}: HTTP ${callbackRes.status()} ${text.slice(0, 200)}`);
  }

  const sessionRes = await ctx.get("/api/auth/session");
  const sessionBody = (await sessionRes.json()) as { user?: { username?: string } };
  if (!sessionBody.user?.username) {
    throw new Error(`Sessão de ${username} não foi estabelecida.`);
  }

  await ctx.storageState({ path: path.join(AUTH_DIR, outputFile) });
  await ctx.dispose();
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.E2E_DATABASE_URL) {
    throw new Error(
      "E2E_DATABASE_URL não está definido. Copie .env.e2e.example para .env.e2e e ajuste."
    );
  }

  // Smoke check: DB acessível e usuários do seed presentes.
  const prisma = getPrisma();
  const servidor = await prisma.user.findUnique({ where: { username: "servidor1" } });
  if (!servidor) {
    throw new Error(
      "Usuário 'servidor1' não encontrado. Rode 'npm run test:e2e:setup' antes da suite."
    );
  }

  // Limpa qualquer registro residual de runs anteriores (não toca em users).
  await cleanupE2eData();

  // Garante upload dir.
  const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
  await ensureUploadDir(uploadDir);

  // Sobe mock Maritaca na porta fixa de E2E_MARITACA_PORT.
  const mock = await startMaritacaMock();

  // Mantém referência global pra parar no teardown.
  (globalThis as { __maritacaMock?: typeof mock }).__maritacaMock = mock;

  // Login programático para cada usuário e salva storageState.
  await fs.mkdir(AUTH_DIR, { recursive: true });
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

  // Aguarda webServer subir antes de tentar login. O Playwright já espera o
  // baseURL responder antes de chamar globalSetup (via webServer.url).
  for (const u of USERS) {
    await loginAndSaveStorageState(baseURL, u.username, u.password, u.file);
  }

  await disconnectPrisma();
}
```

- [ ] **Step 5.4: Implementar `global-teardown.ts`**

Conteúdo de `e2e/support/global-teardown.ts`:

```ts
import { promises as fs } from "fs";
import { cleanupE2eData, disconnectPrisma } from "../fixtures/db";

export default async function globalTeardown(): Promise<void> {
  const mock = (globalThis as { __maritacaMock?: { stop(): Promise<void> } }).__maritacaMock;
  if (mock) {
    await mock.stop();
  }

  if (process.env.E2E_DATABASE_URL) {
    try {
      await cleanupE2eData();
    } catch (err) {
      console.warn("[e2e] cleanup falhou:", err);
    }
    await disconnectPrisma();
  }

  const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
  await fs.rm(uploadDir, { recursive: true, force: true });
}
```

- [ ] **Step 5.5: Commit**

```bash
git add e2e/support/global-setup.ts e2e/support/global-teardown.ts e2e/.auth/.gitignore .env.e2e.example
git commit -m "$(cat <<'EOF'
test(e2e): add Playwright global setup and teardown

Validates E2E_DATABASE_URL, starts Maritaca mock, generates per-role
storageStates via NextAuth credentials login, cleans DB and mock on
teardown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Custom test fixture e atualização do `playwright.config.ts`

**Files:**
- Create: `e2e/support/test.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json` (scripts e devDep `dotenv-cli`)

- [ ] **Step 6.1: Custom test**

Conteúdo de `e2e/support/test.ts`:

```ts
import { test as base, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { getPrisma, cleanupE2eData } from "../fixtures/db";
import { getMockPort } from "./maritaca-mock-port";

interface E2eFixtures {
  db: PrismaClient;
  maritacaPort: number;
}

export const test = base.extend<E2eFixtures>({
  db: async ({}, use) => {
    await use(getPrisma());
  },
  maritacaPort: async ({}, use) => {
    await use(getMockPort());
  },
});

export { expect, cleanupE2eData };
```

- [ ] **Step 6.2: Atualizar `playwright.config.ts`**

Substituir conteúdo inteiro de [playwright.config.ts](../../playwright.config.ts) por:

```ts
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.join(__dirname, ".env.e2e") });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";
const maritacaPort = process.env.E2E_MARITACA_PORT ?? "39871";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts$/,
  testIgnore: ["**/fixtures/**", "**/support/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: require.resolve("./e2e/support/global-setup.ts"),
  globalTeardown: require.resolve("./e2e/support/global-teardown.ts"),
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      UPLOAD_DIR: uploadDir,
      LOCAL_TRANSCRIPTION_ENGINE: "mock",
      MARITACA_API_KEY: "test-key",
      MARITACA_BASE_URL: `http://127.0.0.1:${maritacaPort}`,
      E2E_MARITACA_PORT: maritacaPort,
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-secret-do-not-use-in-prod",
    },
  },
});
```

- [ ] **Step 6.3: Instalar deps e atualizar `package.json`**

Run:
```bash
npm install --save-dev dotenv dotenv-cli
```

Editar [package.json](../../package.json) — adicionar nos `scripts`, depois da linha `"test:e2e": ...`:

```json
"test:e2e:setup": "dotenv -e .env.e2e -- bash -c 'DATABASE_URL=$E2E_DATABASE_URL npx prisma migrate deploy && DATABASE_URL=$E2E_DATABASE_URL npx prisma db seed'",
"test:e2e:reset": "dotenv -e .env.e2e -- bash -c 'DATABASE_URL=$E2E_DATABASE_URL npx prisma migrate reset --force --skip-seed && DATABASE_URL=$E2E_DATABASE_URL npx prisma db seed'",
```

`dotenv` é necessário para o `import { config as loadEnv } from "dotenv"` em `playwright.config.ts`; `dotenv-cli` provê o binário `dotenv` usado pelos scripts de setup.

- [ ] **Step 6.4: Type-check**

Run: `npm run type-check`
Expected: nenhum erro novo.

- [ ] **Step 6.5: Smoke run da infra**

Pré-requisitos:
1. Postgres local com banco `audiencia_e2e` criado.
2. `.env.e2e` configurado a partir do `.env.e2e.example`.

Run:
```bash
npm run test:e2e:setup
E2E_MARITACA_PORT=39871 npx playwright test e2e/smoke.spec.ts
```

Expected: 2 testes do smoke passam, suite finaliza, mock mata, DB limpo.

- [ ] **Step 6.6: Commit**

```bash
git add e2e/support/test.ts e2e/support/maritaca-mock-port.ts \
  e2e/support/global-setup.ts e2e/support/global-teardown.ts \
  playwright.config.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
test(e2e): wire Playwright config with global setup and custom fixture

Uses fixed E2E_MARITACA_PORT (default 39871) so Next.js webServer can
resolve MARITACA_BASE_URL deterministically without an init race with
globalSetup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `auth.spec.ts`

**Files:**
- Create: `e2e/auth.spec.ts`

- [ ] **Step 7.1: Escrever spec**

Conteúdo de `e2e/auth.spec.ts`:

```ts
import { test, expect } from "./support/test";

test.describe("Autenticação", () => {
  test("login válido como SERVIDOR redireciona para o dashboard de servidor", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/Usuário/i).fill("servidor1");
    await page.getByLabel(/Senha/i).fill("senha123");
    await page.getByRole("button", { name: /Entrar/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Painel do Servidor/i })).toBeVisible();
  });

  test("login válido como JUIZ mostra painel do juiz", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/Usuário/i).fill("juiz1");
    await page.getByLabel(/Senha/i).fill("senha123");
    await page.getByRole("button", { name: /Entrar/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Painel do Juiz/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Nova Gravação/i })).not.toBeVisible();
  });

  test("senha errada exibe mensagem de erro", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/Usuário/i).fill("servidor1");
    await page.getByLabel(/Senha/i).fill("errada");
    await page.getByRole("button", { name: /Entrar/i }).click();
    await expect(page.getByText(/Usuário ou senha inválidos/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("acesso anônimo a rota protegida redireciona para /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/consulta");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/gravacao/nova");
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout via botão Sair limpa a sessão", async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: "e2e/.auth/servidor1.json",
    });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Servidor/i })).toBeVisible();
    await page.getByRole("button", { name: /Sair/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});
```

- [ ] **Step 7.2: Rodar a spec**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/auth.spec.ts`
Expected: 5 testes passam.

- [ ] **Step 7.3: Commit**

```bash
git add e2e/auth.spec.ts
git commit -m "test(e2e): cover login, logout and anonymous redirects

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `access-control.spec.ts`

**Files:**
- Create: `e2e/access-control.spec.ts`

- [ ] **Step 8.1: Escrever spec**

Conteúdo de `e2e/access-control.spec.ts`:

```ts
import { test, expect } from "./support/test";
import { seedGravacao, cleanupE2eData } from "../e2e/fixtures/db";

test.describe("Controle de acesso", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("JUIZ é redirecionado ao tentar /gravacao/nova", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/juiz1.json" });
    const page = await ctx.newPage();
    await page.goto("/gravacao/nova");
    await expect(page).toHaveURL(/\/dashboard$/);
    await ctx.close();
  });

  test("JUIZ recebe 403 ao tentar criar gravação via API", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await api.post("/api/gravacoes", {
      data: { metadata: { numeroProcesso: "0000-X" }, modo: "PRESENCIAL" },
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("SERVIDOR2 não consegue alterar gravação criada por SERVIDOR1", async ({ playwright }) => {
    const owned = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const patch = await api.patch(`/api/gravacoes/${owned.id}`, {
      data: { numeroProcesso: "ALTERADO" },
    });
    expect(patch.status()).toBe(403);
    const del = await api.delete(`/api/gravacoes/${owned.id}`);
    expect(del.status()).toBe(403);
    await api.dispose();
  });

  test("SERVIDOR2 não vê gravações de SERVIDOR1 na listagem", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "GRAV-DO-SERVIDOR1",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await api.get("/api/gravacoes?limit=100");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { gravacoes: Array<{ id: string }> };
    expect(body.gravacoes.find((g) => g.id === grav.id)).toBeUndefined();
    await api.dispose();
  });

  test("JUIZ vê gravações de qualquer servidor da sua vara", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "GRAV-VISIVEL-AO-JUIZ",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await api.get("/api/gravacoes?limit=100");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { gravacoes: Array<{ id: string }> };
    expect(body.gravacoes.find((g) => g.id === grav.id)).toBeDefined();
    await api.dispose();
  });
});
```

- [ ] **Step 8.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/access-control.spec.ts`
Expected: 5 testes passam.

- [ ] **Step 8.3: Commit**

```bash
git add e2e/access-control.spec.ts
git commit -m "test(e2e): role-based access on UI middleware and APIs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `dashboard.spec.ts`

**Files:**
- Create: `e2e/dashboard.spec.ts`

- [ ] **Step 9.1: Escrever spec**

Conteúdo de `e2e/dashboard.spec.ts`:

```ts
import { test, expect } from "./support/test";

test.describe("Dashboard", () => {
  test("SERVIDOR vê CTA Nova Gravação e nome", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/servidor1.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Servidor/i })).toBeVisible();
    await expect(page.getByText(/Maria Silva/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Nova Gravação/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Iniciar Audiência/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Consultar Acervo/i })).toBeVisible();
    await ctx.close();
  });

  test("JUIZ não vê CTA de gravação", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/juiz1.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Juiz/i })).toBeVisible();
    await expect(page.getByText(/Carlos Oliveira/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Nova Gravação/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Iniciar Audiência/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Buscar Gravações/i })).toBeVisible();
    await ctx.close();
  });
});
```

- [ ] **Step 9.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/dashboard.spec.ts`
Expected: 2 testes passam.

- [ ] **Step 9.3: Commit**

```bash
git add e2e/dashboard.spec.ts
git commit -m "test(e2e): dashboard differentiates SERVIDOR vs JUIZ UI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `gravacao-crud.spec.ts`

**Files:**
- Create: `e2e/gravacao-crud.spec.ts`

- [ ] **Step 10.1: Escrever spec**

Conteúdo de `e2e/gravacao-crud.spec.ts`:

```ts
import { test, expect } from "./support/test";
import { cleanupE2eData, e2eId } from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("API gravações — CRUD", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("POST /api/gravacoes cria registro com campos válidos", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const id = e2eId();
    const res = await api.post("/api/gravacoes", {
      data: {
        id,
        metadata: { numeroProcesso: "001-CRIADO", classeProcessual: "Cível" },
        modo: "PRESENCIAL",
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { gravacao: { id: string; numeroProcesso: string } };
    expect(body.gravacao.id).toBe(id);
    expect(body.gravacao.numeroProcesso).toBe("001-CRIADO");
    await api.dispose();
  });

  test("POST /api/gravacoes retorna 400 sem numeroProcesso", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.post("/api/gravacoes", {
      data: { id: e2eId(), metadata: {}, modo: "PRESENCIAL" },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("PATCH /api/gravacoes/:id atualiza metadados do dono", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const id = e2eId();
    await api.post("/api/gravacoes", {
      data: { id, metadata: { numeroProcesso: "ANTES" }, modo: "PRESENCIAL" },
    });
    const res = await api.patch(`/api/gravacoes/${id}`, {
      data: { numeroProcesso: "DEPOIS" },
    });
    expect(res.status()).toBe(200);
    const get = await api.get(`/api/gravacoes/${id}`);
    const body = (await get.json()) as { gravacao: { numeroProcesso: string } };
    expect(body.gravacao.numeroProcesso).toBe("DEPOIS");
    await api.dispose();
  });

  test("DELETE remove gravação do dono", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const id = e2eId();
    await api.post("/api/gravacoes", {
      data: { id, metadata: { numeroProcesso: "PRA-DELETAR" }, modo: "PRESENCIAL" },
    });
    const del = await api.delete(`/api/gravacoes/${id}`);
    expect(del.status()).toBe(200);
    const get = await api.get(`/api/gravacoes/${id}`);
    expect(get.status()).toBe(404);
    await api.dispose();
  });
});
```

- [ ] **Step 10.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/gravacao-crud.spec.ts`
Expected: 4 testes passam.

- [ ] **Step 10.3: Commit**

```bash
git add e2e/gravacao-crud.spec.ts
git commit -m "test(e2e): API CRUD coverage for gravações

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `consulta.spec.ts`

**Files:**
- Create: `e2e/consulta.spec.ts`

- [ ] **Step 11.1: Escrever spec**

Conteúdo de `e2e/consulta.spec.ts`:

```ts
import { test, expect } from "./support/test";
import { cleanupE2eData, getPrisma, seedGravacao } from "./fixtures/db";

test.describe("Consulta de gravações", () => {
  test.use({ storageState: "e2e/.auth/servidor1.json" });

  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("vazio mostra empty state", async ({ page }) => {
    await page.goto("/consulta");
    await expect(page.getByText(/Nenhuma gravação encontrada/i)).toBeVisible();
  });

  test("lista gravações próprias após seed", async ({ page }) => {
    await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "PROC-VISIVEL",
      status: "FINALIZADA",
    });
    await page.goto("/consulta");
    await expect(page.getByText("PROC-VISIVEL")).toBeVisible();
  });

  test("busca por numeroProcesso filtra a tabela (debounced)", async ({ page }) => {
    await seedGravacao({ ownerUsername: "servidor1", numeroProcesso: "AAAA-111" });
    await seedGravacao({ ownerUsername: "servidor1", numeroProcesso: "BBBB-222" });
    await page.goto("/consulta");
    await expect(page.getByText("AAAA-111")).toBeVisible();
    await expect(page.getByText("BBBB-222")).toBeVisible();
    await page.getByPlaceholder(/Buscar por número do processo/i).fill("AAAA");
    await expect.poll(async () => (await page.getByText("BBBB-222").count())).toBe(0);
    await expect(page.getByText("AAAA-111")).toBeVisible();
  });

  test("modal de exclusão remove gravação", async ({ page }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "PARA-EXCLUIR",
      status: "FINALIZADA",
    });
    await page.goto("/consulta");
    await expect(page.getByText("PARA-EXCLUIR")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "PARA-EXCLUIR" });
    await row.getByRole("button", { name: /Excluir/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Excluir/i }).click();
    await expect(page.getByText("PARA-EXCLUIR")).toHaveCount(0);
    const stillThere = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(stillThere).toBeNull();
  });

  test("paginação aparece com 25 gravações", async ({ page }) => {
    for (let i = 0; i < 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedGravacao({
        ownerUsername: "servidor1",
        numeroProcesso: `PAGE-${String(i).padStart(3, "0")}`,
      });
    }
    await page.goto("/consulta");
    await expect(page.getByText(/Página 1 de 2/i)).toBeVisible();
    await page.getByRole("button", { name: /Próximo/i }).click();
    await expect(page.getByText(/Página 2 de 2/i)).toBeVisible();
  });
});
```

- [ ] **Step 11.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/consulta.spec.ts`
Expected: 5 testes passam.

- [ ] **Step 11.3: Commit**

```bash
git add e2e/consulta.spec.ts
git commit -m "test(e2e): list, search, pagination, delete on consulta page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `upload.spec.ts`

**Files:**
- Create: `e2e/upload.spec.ts`

- [ ] **Step 12.1: Escrever spec**

Conteúdo de `e2e/upload.spec.ts`:

```ts
import { promises as fs } from "fs";
import path from "path";
import { test, expect } from "./support/test";
import { cleanupE2eData, getPrisma, seedGravacao } from "./fixtures/db";
import { SAMPLE_WEBM } from "./fixtures/files";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Upload de gravação", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("POST /api/upload com WebM válido converte para MP4 e atualiza Gravacao", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1", status: "EM_ANDAMENTO" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const res = await api.post("/api/upload", {
      multipart: {
        gravacaoId: grav.id,
        duracao: "2",
        file: {
          name: "sample.webm",
          mimeType: "video/webm",
          buffer: fileBuffer,
        },
      },
    });
    expect(res.status()).toBe(200);
    const updated = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(updated?.status).toBe("FINALIZADA");
    expect(updated?.caminhoArquivo).toMatch(/\.mp4$/);
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    await expect.poll(async () => {
      try {
        const stat = await fs.stat(path.join(uploadDir, updated!.caminhoArquivo!));
        return stat.size > 0;
      } catch {
        return 0;
      }
    }).toBeGreaterThan(0);
    await api.dispose();
  });

  test("upload sem ser dono retorna 403", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const res = await api.post("/api/upload", {
      multipart: {
        gravacaoId: grav.id,
        file: { name: "sample.webm", mimeType: "video/webm", buffer: fileBuffer },
      },
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("upload sem arquivo retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.post("/api/upload", {
      multipart: { gravacaoId: grav.id },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("upload sem gravacaoId retorna 400", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const res = await api.post("/api/upload", {
      multipart: {
        file: { name: "sample.webm", mimeType: "video/webm", buffer: fileBuffer },
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });
});
```

- [ ] **Step 12.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/upload.spec.ts`
Expected: 4 testes passam. Caso o transcode demore, aumentar `expect.poll` timeout.

- [ ] **Step 12.3: Commit**

```bash
git add e2e/upload.spec.ts
git commit -m "test(e2e): upload pipeline with FFmpeg transcode

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `reproducao.spec.ts`

**Files:**
- Create: `e2e/reproducao.spec.ts`

- [ ] **Step 13.1: Escrever spec**

Conteúdo de `e2e/reproducao.spec.ts`:

```ts
import path from "path";
import { test, expect } from "./support/test";
import { cleanupE2eData, placeMp4Fixture, seedGravacao } from "./fixtures/db";
import { SAMPLE_MP4 } from "./fixtures/files";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function seedGravacaoFinalizadaComMp4(uploadDir: string) {
  const relativePath = path.join("2026", "05", "3-vara-federal", "sample.mp4");
  const grav = await seedGravacao({
    ownerUsername: "servidor1",
    status: "FINALIZADA",
    caminhoArquivo: relativePath,
  });
  await placeMp4Fixture(uploadDir, SAMPLE_MP4, relativePath);
  return grav;
}

test.describe("Reprodução", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("página de reprodução renderiza video element", async ({ browser }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const grav = await seedGravacaoFinalizadaComMp4(uploadDir);
    const ctx = await browser.newContext({ storageState: "e2e/.auth/servidor1.json" });
    const page = await ctx.newPage();
    await page.goto(`/gravacao/${grav.id}/reproduzir`);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    const src = await video.getAttribute("src");
    expect(src).toContain(`/api/gravacoes/${grav.id}/stream`);
    await ctx.close();
  });

  test("GET /stream com Range retorna 206", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const grav = await seedGravacaoFinalizadaComMp4(uploadDir);
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/stream`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(res.status()).toBe(206);
    expect(res.headers()["content-range"]).toMatch(/^bytes 0-1023\//);
    await api.dispose();
  });

  test("JUIZ da mesma vara consegue acessar stream", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const grav = await seedGravacaoFinalizadaComMp4(uploadDir);
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/stream`);
    expect([200, 206]).toContain(res.status());
    await api.dispose();
  });

  test("SERVIDOR de outra vara recebe 403", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const relativePath = path.join("2026", "05", "outra-vara", "sample.mp4");
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      status: "FINALIZADA",
      caminhoArquivo: relativePath,
      vara: "Outra Vara Federal",
    });
    await placeMp4Fixture(uploadDir, SAMPLE_MP4, relativePath);
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/stream`);
    expect(res.status()).toBe(403);
    await api.dispose();
  });
});
```

- [ ] **Step 13.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/reproducao.spec.ts`
Expected: 4 testes passam.

- [ ] **Step 13.3: Commit**

```bash
git add e2e/reproducao.spec.ts
git commit -m "test(e2e): playback page and stream range request

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: `transcricao.spec.ts`

**Files:**
- Create: `e2e/transcricao.spec.ts`

- [ ] **Step 14.1: Escrever spec**

Conteúdo de `e2e/transcricao.spec.ts`:

```ts
import path from "path";
import { test, expect } from "./support/test";
import {
  cleanupE2eData,
  getPrisma,
  placeMp4Fixture,
  seedGravacao,
  SEED_TRANSCRICAO_SEGMENTOS,
} from "./fixtures/db";
import { SAMPLE_MP4 } from "./fixtures/files";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Transcrição", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("GET retorna 404 quando gravação inexistente", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get("/api/gravacoes/e2e-inexistente/transcricao");
    expect(res.status()).toBe(404);
    await api.dispose();
  });

  test("GET retorna segmentos seedados para JUIZ da mesma vara", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "Está aberta a audiência. Boa tarde, excelência.",
      transcricaoSegmentos: SEED_TRANSCRICAO_SEGMENTOS,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/transcricao`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      transcricao: { status: string; segmentos: unknown[] };
    };
    expect(body.transcricao.status).toBe("CONCLUIDA");
    expect(body.transcricao.segmentos.length).toBeGreaterThanOrEqual(2);
    await api.dispose();
  });

  test("POST por dono dispara motor mock e atualiza para CONCLUIDA", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const relativePath = path.join("2026", "05", "3-vara-federal", "transcrever.mp4");
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      status: "FINALIZADA",
      caminhoArquivo: relativePath,
    });
    await placeMp4Fixture(uploadDir, SAMPLE_MP4, relativePath);

    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const post = await api.post(`/api/gravacoes/${grav.id}/transcricao`);
    expect(post.status()).toBe(200);

    await expect.poll(async () => {
      const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
      return row?.transcricaoStatus;
    }, { timeout: 30_000 }).toBe("CONCLUIDA");

    const final = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(final?.transcricaoTexto).toContain("Está aberta a audiência");
    expect(final?.transcricaoSegmentos).not.toBeNull();
    await api.dispose();
  });

  test("POST por SERVIDOR não-dono retorna 403", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      status: "FINALIZADA",
      caminhoArquivo: "fake/path.mp4",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.post(`/api/gravacoes/${grav.id}/transcricao`);
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("PATCH realtime aceita segmento incremental do dono", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.patch(`/api/gravacoes/${grav.id}/transcricao`, {
      data: {
        segments: [
          {
            id: "live-1",
            text: "Frase parcial",
            offsetMs: 1000,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect([200, 201]).toContain(res.status());
    await api.dispose();
  });
});
```

- [ ] **Step 14.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/transcricao.spec.ts`
Expected: 5 testes passam. POST pode levar até ~20s pelo dispatch real do mock + cleanup pipeline.

- [ ] **Step 14.3: Commit**

```bash
git add e2e/transcricao.spec.ts
git commit -m "test(e2e): transcription API end-to-end with mock engine

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: `termo.spec.ts`

**Files:**
- Create: `e2e/termo.spec.ts`

- [ ] **Step 15.1: Escrever spec**

Conteúdo de `e2e/termo.spec.ts`:

```ts
import { test, expect } from "./support/test";
import {
  cleanupE2eData,
  getPrisma,
  seedGravacao,
  SEED_TRANSCRICAO_SEGMENTOS,
} from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function seedGravacaoComTranscricao(numero: string = "TERMO-PROC") {
  return seedGravacao({
    ownerUsername: "servidor1",
    numeroProcesso: numero,
    transcricaoStatus: "CONCLUIDA",
    transcricaoTexto: "Está aberta a audiência. Boa tarde, excelência.",
    transcricaoSegmentos: SEED_TRANSCRICAO_SEGMENTOS,
  });
}

test.describe("Termo de Audiência", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("POST gera termo via mock Maritaca e marca CONCLUIDA", async ({ playwright }) => {
    const grav = await seedGravacaoComTranscricao();
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const post = await api.post(`/api/gravacoes/${grav.id}/termo`);
    expect(post.status()).toBe(200);

    await expect.poll(async () => {
      const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
      return row?.termoStatus;
    }, { timeout: 15_000 }).toBe("CONCLUIDA");

    const final = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(final?.termoTexto).toContain("Termo de Audiência");
    expect(final?.termoTipo).toBe("procedencia");
    await api.dispose();
  });

  test("POST com numeroProcesso=ERRO_FORCADO falha e marca ERRO", async ({ playwright }) => {
    const grav = await seedGravacaoComTranscricao("ERRO_FORCADO");
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const post = await api.post(`/api/gravacoes/${grav.id}/termo`);
    expect(post.status()).toBe(200);
    await expect.poll(async () => {
      const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
      return row?.termoStatus;
    }, { timeout: 15_000 }).toBe("ERRO");
    const final = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(final?.termoErro).toBeTruthy();
    await api.dispose();
  });

  test("POST sem transcrição retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.post(`/api/gravacoes/${grav.id}/termo`);
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("PATCH salva edição manual do markdown", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: "# Original",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.patch(`/api/gravacoes/${grav.id}/termo`, {
      data: { texto: "# Editado pelo servidor" },
    });
    expect(res.status()).toBe(200);
    const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(row?.termoTexto).toBe("# Editado pelo servidor");
    await api.dispose();
  });

  test("GET termo por JUIZ mesma vara retorna 200", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: "# Termo",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo`);
    expect(res.status()).toBe(200);
    await api.dispose();
  });

  test("PATCH por SERVIDOR não-dono retorna 403", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1", termoStatus: "CONCLUIDA" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.patch(`/api/gravacoes/${grav.id}/termo`, {
      data: { texto: "# Hack" },
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });
});
```

- [ ] **Step 15.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/termo.spec.ts`
Expected: 6 testes passam.

- [ ] **Step 15.3: Commit**

```bash
git add e2e/termo.spec.ts
git commit -m "test(e2e): termo de audiência generation, edit and authz

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: `termo-export.spec.ts`

**Files:**
- Create: `e2e/termo-export.spec.ts`

- [ ] **Step 16.1: Escrever spec**

Conteúdo de `e2e/termo-export.spec.ts`:

```ts
import { test, expect } from "./support/test";
import { cleanupE2eData, seedGravacao } from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

const MARKDOWN = "# Termo de Audiência\n\n## Presentes\n- Juiz: Carlos\n\n## Dispositivo\na) Procedente.";

test.describe("Termo — export", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("export PDF retorna application/pdf com bytes", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: MARKDOWN,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1024);
    expect(body.slice(0, 4).toString("ascii")).toBe("%PDF");
    await api.dispose();
  });

  test("export DOCX retorna content-type Word", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: MARKDOWN,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=docx`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1024);
    // DOCX é zip — primeiro byte é 0x50 0x4B (PK)
    expect(body.slice(0, 2).toString("ascii")).toBe("PK");
    await api.dispose();
  });

  test("export sem termo retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=pdf`);
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("formato inválido retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: MARKDOWN,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=xyz`);
    expect(res.status()).toBe(400);
    await api.dispose();
  });
});
```

- [ ] **Step 16.2: Rodar**

Run: `E2E_MARITACA_PORT=39871 npx playwright test e2e/termo-export.spec.ts`
Expected: 4 testes passam.

- [ ] **Step 16.3: Commit**

```bash
git add e2e/termo-export.spec.ts
git commit -m "test(e2e): termo export to PDF and DOCX

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Suite completa em verde

**Files:** nenhum.

- [ ] **Step 17.1: Rodar a suite inteira**

Run: `E2E_MARITACA_PORT=39871 npx playwright test`
Expected: todos os arquivos passam (~50 testes). Tempo total: < 5 min.

- [ ] **Step 17.2: Rerun para detectar flakes**

Run: `E2E_MARITACA_PORT=39871 npx playwright test --repeat-each=2`
Expected: todos passam nas duas execuções.

- [ ] **Step 17.3: Documentar uso no AGENTS.md**

Em [AGENTS.md](../../AGENTS.md), localizar a seção "Comandos úteis" e adicionar abaixo da linha `npm run test:e2e`:

```markdown
- `npm run test:e2e:setup` — aplica migrações e roda o seed no `E2E_DATABASE_URL`. Necessário antes da primeira execução da suite e2e.
- `E2E_MARITACA_PORT=39871 npm run test:e2e` — executa a suite completa. Configure `.env.e2e` a partir de `.env.e2e.example` antes.
```

- [ ] **Step 17.4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(e2e): document new test setup commands

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Recapitulação de cobertura

| Spec | Casos | Áreas tocadas |
|------|-------|---------------|
| smoke | 2 | login + redirect |
| auth | 5 | login, papéis, senha errada, anônimo, logout |
| access-control | 5 | middleware, API authz, cross-user, cross-vara |
| dashboard | 2 | UI por papel |
| gravacao-crud | 4 | POST, PATCH, DELETE, validação |
| consulta | 5 | empty, lista, busca, paginação, modal delete |
| upload | 4 | OK, 403, 400 sem arquivo, 400 sem id |
| reproducao | 4 | UI, range, juiz mesma vara, vara errada |
| transcricao | 5 | 404, GET CONCLUIDA, POST mock engine, 403, PATCH |
| termo | 6 | gerar, ERRO_FORCADO, sem transcrição, PATCH, JUIZ GET, 403 |
| termo-export | 4 | PDF, DOCX, sem termo, formato inválido |
| **Total** | **46** | Todas as rotas em [src/app/api/](../../src/app/api/) |
