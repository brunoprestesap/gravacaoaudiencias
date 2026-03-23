"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface GravacaoListItem {
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
  status: "EM_ANDAMENTO" | "PAUSADA" | "FINALIZADA" | "INTERROMPIDA";
  createdAt: string;
}

interface GravacaoResponse {
  gravacoes: GravacaoListItem[];
  total: number;
  page: number;
  limit: number;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? `${m}min` : ""}`;
  return `${m}min`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

const modoStyles = {
  PRESENCIAL: "bg-blue-100 text-blue-700",
  HIBRIDO: "bg-purple-100 text-purple-700",
} as const;

const modoLabels = {
  PRESENCIAL: "Presencial",
  HIBRIDO: "Híbrido",
} as const;

export default function ConsultaPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [data, setData] = useState<GravacaoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGravacoes = useCallback(async (searchTerm: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("page", String(pageNum));
      params.set("limit", "20");

      const res = await fetch(`/api/gravacoes?${params.toString()}`);
      if (!res.ok) throw new Error("Falha ao carregar gravações.");
      const json: GravacaoResponse = await res.json();
      setData(json);
    } catch {
      setError("Falha ao carregar gravações. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchGravacoes("", 1);
  }, [fetchGravacoes]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchGravacoes(value, 1);
    }, 500);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchGravacoes(search, newPage);
  };

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold text-text-primary">
        Consulta de Gravações
      </h1>

      {/* Search bar */}
      <div className="relative mt-6">
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Buscar por número do processo..."
          className="w-full rounded-[4px] border border-border bg-bg-card py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {/* Content */}
      <div className="mt-6">
        {loading ? (
          <SkeletonTable />
        ) : error ? (
          <div className="rounded-lg border border-border bg-bg-card p-8 text-center">
            <p className="text-sm text-error">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fetchGravacoes(search, page)}
            >
              Tentar novamente
            </Button>
          </div>
        ) : data && data.gravacoes.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-card p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-text-muted"
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
            <p className="mt-4 text-sm text-text-muted">
              Nenhuma gravação encontrada. Ajuste a busca ou inicie uma nova
              gravação.
            </p>
          </div>
        ) : data ? (
          <>
            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-card">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-page">
                    <th className="px-4 py-3 font-medium text-text-secondary">
                      Processo
                    </th>
                    <th className="px-4 py-3 font-medium text-text-secondary">
                      Data
                    </th>
                    <th className="px-4 py-3 font-medium text-text-secondary">
                      Duração
                    </th>
                    <th className="px-4 py-3 font-medium text-text-secondary">
                      Modo
                    </th>
                    <th className="px-4 py-3 font-medium text-text-secondary">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.gravacoes.map((g, i) => (
                    <tr
                      key={g.id}
                      onClick={() =>
                        router.push(`/gravacao/${g.id}/reproduzir`)
                      }
                      className={`cursor-pointer border-b border-border transition-colors hover:bg-gray-100 ${
                        i % 2 === 1 ? "bg-table-stripe" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-primary">
                        {g.numeroProcesso}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDate(g.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDuration(g.duracao)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${modoStyles[g.modo]}`}
                        >
                          {modoLabels[g.modo]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[g.status]}`}
                        >
                          {statusLabels[g.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between text-sm text-text-secondary">
              <span>
                Mostrando {data.gravacoes.length} de {data.total} gravações
              </span>
              {totalPages > 1 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                  >
                    &larr; Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                  >
                    Próximo &rarr;
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-card">
      <div className="border-b border-border bg-bg-page px-4 py-3">
        <div className="flex gap-4">
          {[160, 100, 80, 80, 80].map((w, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-border"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border-b border-border px-4 py-3">
          <div className="flex gap-4">
            {[180, 120, 60, 70, 70].map((w, j) => (
              <div
                key={j}
                className="h-4 animate-pulse rounded bg-border/50"
                style={{ width: w }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
