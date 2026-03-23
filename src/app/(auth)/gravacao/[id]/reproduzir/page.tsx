"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { VideoPlayer } from "@/components/consultation/VideoPlayer";

interface Gravacao {
  id: string;
  numeroProcesso: string;
  classeProcessual: string | null;
  partes: string | null;
  vara: string | null;
  nomeJuiz: string | null;
  tipoAudiencia: string | null;
  dataAudiencia: string | null;
  modo: "PRESENCIAL" | "HIBRIDO";
  duracao: number | null;
  tamanhoArquivo: number | null;
  caminhoArquivo: string | null;
  status: "EM_ANDAMENTO" | "PAUSADA" | "FINALIZADA" | "INTERROMPIDA";
  createdAt: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m > 0 ? `${String(m).padStart(2, "0")}min` : ""}`;
  if (m > 0) return `${m}min${s > 0 ? `${String(s).padStart(2, "0")}s` : ""}`;
  return `${s}s`;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const modoStyles = {
  PRESENCIAL: "bg-blue-100 text-blue-700",
  HIBRIDO: "bg-purple-100 text-purple-700",
} as const;

const modoLabels = {
  PRESENCIAL: "Presencial",
  HIBRIDO: "Híbrido",
} as const;

const statusStyles = {
  FINALIZADA: "bg-green-100 text-green-700",
  EM_ANDAMENTO: "bg-yellow-100 text-yellow-700",
  PAUSADA: "bg-yellow-100 text-yellow-700",
  INTERROMPIDA: "bg-red-100 text-red-700",
} as const;

const statusLabels = {
  FINALIZADA: "Finalizada",
  EM_ANDAMENTO: "Em Andamento",
  PAUSADA: "Pausada",
  INTERROMPIDA: "Interrompida",
} as const;

export default function ReproducaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [gravacao, setGravacao] = useState<Gravacao | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGravacao() {
      try {
        const res = await fetch(`/api/gravacoes/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Gravação não encontrada.");
          } else if (res.status === 403) {
            setError("Você não tem acesso a esta gravação.");
          } else {
            setError("Erro ao carregar gravação.");
          }
          return;
        }
        const json = await res.json();
        setGravacao(json.gravacao);
      } catch {
        setError("Erro ao carregar gravação.");
      } finally {
        setLoading(false);
      }
    }
    fetchGravacao();
  }, [id]);

  const handleDownload = () => {
    window.open(`/api/gravacoes/${id}/download`, "_blank");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="h-6 w-64 animate-pulse rounded bg-border" />
          <div className="h-9 w-24 animate-pulse rounded bg-border" />
        </div>
        <div className="aspect-video w-full animate-pulse rounded-lg bg-border/50" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 w-48 animate-pulse rounded bg-border/50" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-lg border border-border bg-bg-card p-12 text-center">
          <p className="text-sm text-error">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => router.push("/consulta")}
          >
            &larr; Voltar para Consulta
          </Button>
        </div>
      </div>
    );
  }

  if (!gravacao) return null;

  const isFinalized = gravacao.status === "FINALIZADA" && gravacao.caminhoArquivo;

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/consulta")}
          >
            &larr; Voltar
          </Button>
          <h1 className="text-lg font-semibold text-text-primary">
            Gravação — Proc. {gravacao.numeroProcesso}
          </h1>
        </div>
        {isFinalized && (
          <Button variant="secondary" size="sm" onClick={handleDownload}>
            &#x2B07; Download{" "}
            {gravacao.tamanhoArquivo
              ? `(${formatFileSize(gravacao.tamanhoArquivo)})`
              : ""}
          </Button>
        )}
      </div>

      {/* Video Player */}
      {isFinalized ? (
        <VideoPlayer gravacaoId={gravacao.id} />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-black">
          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            <p className="mt-3 text-sm text-white/50">
              O arquivo desta gravação não está disponível. Pode ter sido movido
              ou excluído.
            </p>
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="mt-6 rounded-lg border border-border bg-bg-card p-6 shadow-card">
        <h2 className="mb-4 text-sm font-semibold text-text-secondary">
          Informações da Gravação
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <MetadataField label="Processo" value={gravacao.numeroProcesso} />
          {gravacao.classeProcessual && (
            <MetadataField
              label="Classe Processual"
              value={gravacao.classeProcessual}
            />
          )}
          {gravacao.partes && (
            <MetadataField label="Partes" value={gravacao.partes} />
          )}
          {gravacao.vara && (
            <MetadataField label="Vara" value={gravacao.vara} />
          )}
          {gravacao.nomeJuiz && (
            <MetadataField label="Juiz" value={gravacao.nomeJuiz} />
          )}
          {gravacao.tipoAudiencia && (
            <MetadataField
              label="Tipo de Audiência"
              value={gravacao.tipoAudiencia}
            />
          )}
          <MetadataField
            label="Data da Gravação"
            value={formatDate(gravacao.createdAt)}
          />
          <MetadataField
            label="Duração"
            value={formatDuration(gravacao.duracao)}
          />
          <div>
            <dt className="text-sm font-medium text-text-muted">Modo</dt>
            <dd className="mt-1">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${modoStyles[gravacao.modo]}`}
              >
                {modoLabels[gravacao.modo]}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-text-muted">Status</dt>
            <dd className="mt-1">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[gravacao.status]}`}
              >
                {statusLabels[gravacao.status]}
              </span>
            </dd>
          </div>
          {gravacao.tamanhoArquivo && (
            <MetadataField
              label="Tamanho"
              value={formatFileSize(gravacao.tamanhoArquivo)}
            />
          )}
        </div>
      </div>

      {/* Download button (large) */}
      {isFinalized && (
        <div className="mt-6 text-center">
          <Button variant="secondary" size="lg" onClick={handleDownload}>
            &#x2B07; Download Gravação{" "}
            {gravacao.tamanhoArquivo
              ? `(${formatFileSize(gravacao.tamanhoArquivo)})`
              : ""}
          </Button>
        </div>
      )}
    </div>
  );
}

function MetadataField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-primary">{value}</dd>
    </div>
  );
}
