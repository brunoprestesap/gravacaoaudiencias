"use client";

import { Button } from "@/components/ui/Button";
import type { TermoStatus } from "./types";

interface TermoToolbarProps {
  status: TermoStatus;
  canEdit: boolean;
  onGerar: () => void;
  onExport: (formato: "pdf" | "docx") => void;
}

export function TermoToolbar({
  status,
  canEdit,
  onGerar,
  onExport,
}: TermoToolbarProps) {
  const isPending = status === "PENDENTE";
  const isError = status === "ERRO";
  const isReady = status === "CONCLUIDA";

  return (
    <div className="flex gap-2">
      {canEdit && isPending && (
        <Button variant="primary" size="sm" onClick={onGerar}>
          Gerar Termo
        </Button>
      )}
      {canEdit && (isReady || isError) && (
        <Button variant="outline" size="sm" onClick={onGerar}>
          {isError ? "Tentar novamente" : "Regerar"}
        </Button>
      )}
      {isReady && (
        <>
          <Button variant="secondary" size="sm" onClick={() => onExport("pdf")}>
            Exportar PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onExport("docx")}>
            Exportar DOCX
          </Button>
        </>
      )}
    </div>
  );
}
