type Status = "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";

const styles: Record<Status, string> = {
  PENDENTE: "bg-gray-100 text-gray-700",
  PROCESSANDO: "bg-yellow-100 text-yellow-700",
  CONCLUIDA: "bg-green-100 text-green-700",
  ERRO: "bg-red-100 text-red-700",
};

const labels: Record<Status, string> = {
  PENDENTE: "Não gerado",
  PROCESSANDO: "Gerando…",
  CONCLUIDA: "Pronto",
  ERRO: "Erro",
};

export function TermoStatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
