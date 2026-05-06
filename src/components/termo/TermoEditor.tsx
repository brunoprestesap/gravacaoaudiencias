"use client";

import { useState } from "react";
import { TermoStatusBadge } from "./TermoStatusBadge";
import { TermoToolbar } from "./TermoToolbar";
import { useTermoAutoSave } from "./hooks/useTermoAutoSave";
import { useTermoPolling } from "./hooks/useTermoPolling";
import { TIPO_SENTENCA_LABELS, type TermoSnapshot, type TermoStatus } from "./types";

interface TermoEditorProps {
  gravacaoId: string;
  initialStatus: TermoStatus;
  initialTexto: string | null;
  initialTipo: string | null;
  initialErro: string | null;
  canEdit: boolean;
}

const initialSnapshotFrom = ({
  initialStatus,
  initialTexto,
  initialTipo,
  initialErro,
}: TermoEditorProps): TermoSnapshot => ({
  status: initialStatus,
  texto: initialTexto,
  tipo: initialTipo,
  erro: initialErro,
});

function formatTipo(tipo: string | null): string | null {
  if (!tipo) return null;
  return TIPO_SENTENCA_LABELS[tipo] ?? tipo;
}

export function TermoEditor(props: TermoEditorProps) {
  const { gravacaoId, canEdit } = props;
  const { snapshot, setSnapshot } = useTermoPolling(
    gravacaoId,
    initialSnapshotFrom(props)
  );
  const { saveState, scheduleSave } = useTermoAutoSave(gravacaoId);

  // `draft` é a edição local do usuário. Enquanto for null, o textarea exibe
  // o texto vindo do snapshot (servidor / polling). Ao começar a editar,
  // o draft assume e isola o usuário do polling.
  const [draft, setDraft] = useState<string | null>(null);
  const displayTexto = draft ?? snapshot.texto ?? "";

  function handleTextoChange(novo: string) {
    setDraft(novo);
    if (canEdit && snapshot.status === "CONCLUIDA") {
      scheduleSave(novo);
    }
  }

  async function handleGerar() {
    setDraft(null); // descarta edições locais ao regerar
    setSnapshot({ ...snapshot, status: "PROCESSANDO", erro: null });
    try {
      const res = await fetch(`/api/gravacoes/${gravacaoId}/termo`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setSnapshot({
          ...snapshot,
          status: "ERRO",
          erro: json.error || "Falha ao iniciar geração do termo.",
        });
      }
    } catch {
      setSnapshot({
        ...snapshot,
        status: "ERRO",
        erro: "Erro de rede ao iniciar geração do termo.",
      });
    }
  }

  function handleExport(formato: "pdf" | "docx") {
    window.open(
      `/api/gravacoes/${gravacaoId}/termo/export?formato=${formato}`,
      "_blank"
    );
  }

  const tipoLabel = formatTipo(snapshot.tipo);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-secondary">
            Termo de Audiência
          </h2>
          <TermoStatusBadge status={snapshot.status} />
          {tipoLabel && snapshot.status === "CONCLUIDA" && (
            <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {tipoLabel}
            </span>
          )}
          {saveState === "saving" && (
            <span className="text-xs text-text-muted">salvando…</span>
          )}
          {saveState === "saved" && (
            <span className="text-xs text-text-muted">salvo</span>
          )}
        </div>
        <TermoToolbar
          status={snapshot.status}
          canEdit={canEdit}
          onGerar={handleGerar}
          onExport={handleExport}
        />
      </div>

      {snapshot.status === "PROCESSANDO" && (
        <p className="text-sm text-text-secondary">
          Maritaca AI está gerando o termo… isso pode levar alguns segundos.
        </p>
      )}

      {snapshot.status === "ERRO" && snapshot.erro && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-error">
          {snapshot.erro}
        </p>
      )}

      {snapshot.status === "PENDENTE" && (
        <p className="text-sm text-text-secondary">
          Após revisar a transcrição, clique em <strong>Gerar Termo</strong> para
          que a Maritaca AI redija um Termo de Audiência baseado nas falas e nos
          metadados do processo.
        </p>
      )}

      {snapshot.status === "CONCLUIDA" &&
        (canEdit ? (
          <textarea
            className="block min-h-[480px] w-full rounded border border-border bg-bg-page p-4 font-mono text-sm leading-relaxed text-text-primary focus:border-primary focus:outline-none"
            value={displayTexto}
            onChange={(e) => handleTextoChange(e.target.value)}
            spellCheck
          />
        ) : (
          <pre className="max-h-[480px] overflow-auto rounded border border-border bg-bg-page p-4 text-sm leading-relaxed text-text-primary whitespace-pre-wrap">
            {displayTexto}
          </pre>
        ))}
    </div>
  );
}
