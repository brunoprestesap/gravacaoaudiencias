"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import {
  Search,
  Calendar,
  Clock,
  Video,
  Users,
  FileText,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  PlayCircle,
  X,
  Loader2,
  FolderOpen
} from "lucide-react";

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
  transcricaoStatus: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";
  transcricaoTexto: string | null;
  transcricaoSegmentos: Array<{
    id: string;
    role?: "JUIZ" | "PARTE" | "PROCURADOR" | "DESCONHECIDO";
    text: string;
  }> | null;
  transcricaoErro: string | null;
  createdAt: string;
}

interface GravacaoResponse {
  gravacoes: GravacaoListItem[];
  total: number;
  page: number;
  limit: number;
}

interface DeleteTarget {
  id: string;
  numeroProcesso: string;
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
  FINALIZADA: "bg-emerald-100 text-emerald-700 border-emerald-200",
  EM_ANDAMENTO: "bg-amber-100 text-amber-700 border-amber-200",
  PAUSADA: "bg-amber-100 text-amber-700 border-amber-200",
  INTERROMPIDA: "bg-rose-100 text-rose-700 border-rose-200",
} as const;

const statusLabels = {
  FINALIZADA: "Finalizada",
  EM_ANDAMENTO: "Em Andamento",
  PAUSADA: "Pausada",
  INTERROMPIDA: "Interrompida",
} as const;

const modoStyles = {
  PRESENCIAL: "bg-blue-50 text-blue-700 border-blue-200",
  HIBRIDO: "bg-purple-50 text-purple-700 border-purple-200",
} as const;

const modoLabels = {
  PRESENCIAL: "Presencial",
  HIBRIDO: "Híbrido",
} as const;

const transcriptionStatusStyles = {
  PENDENTE: "bg-slate-100 text-slate-700 border-slate-200",
  PROCESSANDO: "bg-amber-100 text-amber-700 border-amber-200",
  CONCLUIDA: "bg-emerald-100 text-emerald-700 border-emerald-200",
  ERRO: "bg-rose-100 text-rose-700 border-rose-200",
} as const;

const transcriptionStatusLabels = {
  PENDENTE: "Pendente",
  PROCESSANDO: "Processando",
  CONCLUIDA: "Concluída",
  ERRO: "Erro",
} as const;

export default function ConsultaPage() {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [data, setData] = useState<GravacaoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGravacoes = useCallback(async (searchTerm: string, pageNum: number) => {
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("page", String(pageNum));
      params.set("limit", "20");

      const res = await fetch(`/api/gravacoes?${params.toString()}`);
      if (!res.ok) throw new Error("Falha ao carregar gravações.");
      const json: GravacaoResponse = await res.json();
      setData(json);
      return json;
    } catch {
      setListError("Falha ao carregar gravações. Tente novamente.");
      return null;
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

  const handleClearSearch = () => {
    setSearch("");
    setPage(1);
    fetchGravacoes("", 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchGravacoes(search, newPage);
  };

  const handleTranscribe = async (id: string) => {
    setProcessingIds((prev) => ({ ...prev, [id]: true }));
    setActionError(null);
    try {
      const res = await fetch(`/api/gravacoes/${id}/transcricao`, {
        method: "POST",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(json.error || "Falha ao transcrever gravação.");
      } else {
        toast.success("Transcrição iniciada com sucesso.");
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Falha ao transcrever gravação."
      );
    } finally {
      await fetchGravacoes(search, page);
      setProcessingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    if (deletingIds[id]) return;
    setDeletingIds((prev) => ({ ...prev, [id]: true }));
    setActionError(null);
    try {
      const res = await fetch(`/api/gravacoes/${id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(json.error || "Falha ao excluir gravação.");
        return;
      }

      const shouldMoveToPreviousPage = page > 1 && (data?.gravacoes.length ?? 0) === 1;
      const targetPage = shouldMoveToPreviousPage ? page - 1 : page;
      setPage(targetPage);
      await fetchGravacoes(search, targetPage);
      setDeleteTarget(null);
      toast.success("Gravação excluída com sucesso.");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Falha ao excluir gravação."
      );
    } finally {
      setDeletingIds((prev) => ({ ...prev, [id]: false }));
    }
  }, [deleteTarget, deletingIds, page, data?.gravacoes.length, fetchGravacoes, search, toast]);

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Consulta de Gravações
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Gerencie e acompanhe o histórico de audiências gravadas.
          </p>
        </div>
        <Button 
          onClick={() => router.push('/dashboard')}
          className="mt-4 md:mt-0 shadow-sm"
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          Nova Gravação
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative mt-8 max-w-xl">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Buscar por número do processo..."
          className="block w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-10 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
        />
        {search && (
          <button
            onClick={handleClearSearch}
            className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="mt-8">
        {actionError ? (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
            <AlertCircle className="h-5 w-5 text-rose-500 flex-shrink-0" />
            <p>{actionError}</p>
          </div>
        ) : null}

        {loading ? (
          <SkeletonTable />
        ) : listError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
            <AlertCircle className="h-12 w-12 text-rose-400 mb-4" />
            <h3 className="text-lg font-medium text-slate-900">Erro ao carregar</h3>
            <p className="mt-2 text-sm text-slate-500 max-w-sm">{listError}</p>
            <Button
              variant="outline"
              className="mt-6 shadow-sm"
              onClick={() => fetchGravacoes(search, page)}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        ) : data && data.gravacoes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-50 mb-6">
              <FolderOpen className="h-10 w-10 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900">Nenhuma gravação encontrada</h3>
            <p className="mt-2 text-sm text-slate-500 max-w-sm">
              {search 
                ? "Não encontramos nenhuma gravação com esse número de processo. Tente ajustar a busca."
                : "Você ainda não possui gravações. Inicie uma nova gravação para vê-la aqui."}
            </p>
            {search && (
              <Button
                variant="outline"
                className="mt-6"
                onClick={handleClearSearch}
              >
                Limpar busca
              </Button>
            )}
          </div>
        ) : data ? (
          <div className="flex flex-col gap-6">
            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm table-fixed">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50">
                      <th className="w-[25%] px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Processo</th>
                      <th className="w-[18%] px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Data e Duração</th>
                      <th className="w-[12%] px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Modo</th>
                      <th className="w-[11%] px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                      <th className="w-[12%] px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Transcrição</th>
                      <th className="w-[22%] px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.gravacoes.map((g) => (
                      <tr
                        key={g.id}
                        onClick={() => router.push(`/gravacao/${g.id}/reproduzir`)}
                        className="group cursor-pointer bg-white transition-colors hover:bg-slate-50/80"
                      >
                        <td className="px-5 py-4 align-middle">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                              <FileText className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900 truncate">{g.numeroProcesso}</p>
                              {g.classeProcessual && (
                                <p className="text-xs text-slate-500 mt-0.5 truncate" title={g.classeProcessual}>
                                  {g.classeProcessual}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="space-y-1.5">
                            <div className="flex items-center text-slate-600">
                              <Calendar className="mr-2 h-4 w-4 text-slate-400" />
                              {formatDate(g.createdAt)}
                            </div>
                            <div className="flex items-center text-slate-500 text-xs">
                              <Clock className="mr-2 h-3.5 w-3.5 text-slate-400" />
                              {formatDuration(g.duracao)}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${modoStyles[g.modo]}`}
                          >
                            {g.modo === "PRESENCIAL" ? (
                              <Users className="h-3.5 w-3.5" />
                            ) : (
                              <Video className="h-3.5 w-3.5" />
                            )}
                            {modoLabels[g.modo]}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span
                            className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${statusStyles[g.status]}`}
                          >
                            {statusLabels[g.status]}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="space-y-2 min-w-0">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${transcriptionStatusStyles[g.transcricaoStatus]}`}
                            >
                              {g.transcricaoStatus === "CONCLUIDA" && <CheckCircle2 className="h-3.5 w-3.5" />}
                              {g.transcricaoStatus === "PROCESSANDO" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              {g.transcricaoStatus === "ERRO" && <AlertCircle className="h-3.5 w-3.5" />}
                              {transcriptionStatusLabels[g.transcricaoStatus]}
                            </span>
                            {Boolean(g.transcricaoSegmentos?.length) && (
                              <p className="text-[11px] text-slate-500">
                                {new Set((g.transcricaoSegmentos ?? []).map((s) => s.role ?? "DESCONHECIDO")).size} falantes mapeados
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3 text-xs bg-white shadow-sm flex-shrink-0"
                              disabled={
                                g.status !== "FINALIZADA" ||
                                g.transcricaoStatus === "PROCESSANDO" ||
                                Boolean(processingIds[g.id]) ||
                                Boolean(deletingIds[g.id])
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleTranscribe(g.id);
                              }}
                            >
                              {processingIds[g.id] || g.transcricaoStatus === "PROCESSANDO" ? (
                                <>
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  Transcrevendo
                                </>
                              ) : g.transcricaoStatus === "ERRO" ? (
                                <>
                                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                  Reprocessar
                                </>
                              ) : (
                                <>
                                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                                  Transcrever
                                </>
                              )}
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={Boolean(processingIds[g.id]) || Boolean(deletingIds[g.id])}
                              className="h-8 px-3 text-xs bg-white shadow-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 border-rose-200 flex-shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget({
                                  id: g.id,
                                  numeroProcesso: g.numeroProcesso,
                                });
                              }}
                              title="Excluir gravação"
                            >
                              {deletingIds[g.id] ? (
                                <>
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  Excluindo
                                </>
                              ) : (
                                <>
                                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                  Excluir
                                </>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-5 py-4">
                <p className="text-sm text-slate-500">
                  Mostrando <span className="font-medium text-slate-900">{data.gravacoes.length}</span> de{" "}
                  <span className="font-medium text-slate-900">{data.total}</span> gravações
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 bg-white shadow-sm"
                      disabled={page <= 1}
                      onClick={() => handlePageChange(page - 1)}
                    >
                      Anterior
                    </Button>
                    <div className="flex items-center justify-center px-3 text-xs font-medium text-slate-600">
                      Página {page} de {totalPages}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 bg-white shadow-sm"
                      disabled={page >= totalPages}
                      onClick={() => handlePageChange(page + 1)}
                    >
                      Próximo
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (deleteTarget && deletingIds[deleteTarget.id]) return;
          setDeleteTarget(null);
        }}
        title="Excluir gravação"
        confirmLabel={deleteTarget && deletingIds[deleteTarget.id] ? "Excluindo..." : "Excluir"}
        cancelLabel="Cancelar"
        onConfirm={() => {
          void handleDelete();
        }}
        destructive
      >
        <div className="py-2">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
            <AlertCircle className="h-6 w-6 text-rose-600" />
          </div>
          <p className="text-center text-slate-600">
            Deseja realmente excluir a gravação do processo<br />
            <strong className="text-slate-900 mt-1 block text-lg">{deleteTarget?.numeroProcesso}</strong>
          </p>
          <p className="mt-4 text-center text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
            Esta ação é permanente e removerá todos os arquivos de áudio, vídeo e transcrições associados.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50/50 px-5 py-4">
        <div className="flex gap-6">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
        </div>
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 w-40">
              <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-100" />
              <div className="space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
            <div className="space-y-2 w-32">
              <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
            </div>
            <div className="h-6 w-24 animate-pulse rounded-md bg-slate-100" />
            <div className="h-6 w-24 animate-pulse rounded-md bg-slate-100" />
            <div className="h-6 w-32 animate-pulse rounded-md bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
