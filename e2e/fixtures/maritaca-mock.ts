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
