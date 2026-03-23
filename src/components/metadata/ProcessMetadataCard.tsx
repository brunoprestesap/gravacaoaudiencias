"use client";

import type { ProcessMetadata } from "@/types/metadata";

interface ProcessMetadataCardProps {
  metadata: ProcessMetadata;
  variant?: "card" | "sidebar";
}

export const ProcessMetadataCard = ({
  metadata,
  variant = "card",
}: ProcessMetadataCardProps) => {
  if (variant === "sidebar") {
    return (
      <div className="space-y-3 overflow-y-auto">
        <p className="text-lg font-bold text-white/90">{metadata.numeroProcesso}</p>
        {metadata.classeProcessual && (
          <Field label="Classe" value={metadata.classeProcessual} dark />
        )}
        {metadata.partes && <Field label="Partes" value={metadata.partes} dark />}
        {metadata.vara && <Field label="Vara" value={metadata.vara} dark />}
        {metadata.nomeJuiz && <Field label="Juiz" value={metadata.nomeJuiz} dark />}
        {metadata.tipoAudiencia && (
          <Field label="Tipo" value={metadata.tipoAudiencia} dark />
        )}
        {metadata.dataAudiencia && (
          <Field label="Data/Hora" value={metadata.dataAudiencia} dark />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
      <p className="text-lg font-bold text-primary">{metadata.numeroProcesso}</p>
      <div className="mt-4 space-y-3">
        {metadata.classeProcessual && (
          <Field label="Classe Processual" value={metadata.classeProcessual} />
        )}
        {metadata.partes && <Field label="Partes" value={metadata.partes} />}
        {metadata.vara && <Field label="Vara" value={metadata.vara} />}
        {metadata.nomeJuiz && <Field label="Juiz" value={metadata.nomeJuiz} />}
        {metadata.tipoAudiencia && (
          <Field label="Tipo de Audiência" value={metadata.tipoAudiencia} />
        )}
        {metadata.dataAudiencia && (
          <Field label="Data/Hora" value={metadata.dataAudiencia} />
        )}
      </div>
    </div>
  );
};

const Field = ({
  label,
  value,
  dark = false,
}: {
  label: string;
  value: string;
  dark?: boolean;
}) => (
  <div>
    <dt
      className={`text-sm font-medium ${dark ? "text-white/40" : "text-text-muted"}`}
    >
      {label}
    </dt>
    <dd
      className={`mt-0.5 text-sm ${dark ? "text-white/80" : "text-text-primary"}`}
    >
      {value}
    </dd>
  </div>
);
