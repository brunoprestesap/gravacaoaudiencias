"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PROCESSO_REGEX, type ProcessMetadata } from "@/types/metadata";

interface MetadataFormProps {
  initialData?: Partial<ProcessMetadata>;
  onSubmit: (data: ProcessMetadata) => void;
}

const CLASSES_PROCESSUAIS = [
  { value: "Ação Civil Pública", label: "Ação Civil Pública" },
  { value: "Ação Ordinária", label: "Ação Ordinária" },
  { value: "Mandado de Segurança", label: "Mandado de Segurança" },
  { value: "Execução Fiscal", label: "Execução Fiscal" },
  { value: "Ação Penal", label: "Ação Penal" },
  { value: "Habeas Corpus", label: "Habeas Corpus" },
  { value: "Agravo de Instrumento", label: "Agravo de Instrumento" },
  { value: "Outra", label: "Outra" },
];

const TIPOS_AUDIENCIA = [
  { value: "Instrução", label: "Instrução" },
  { value: "Conciliação", label: "Conciliação" },
  { value: "Interrogatório", label: "Interrogatório" },
  { value: "Justificação", label: "Justificação" },
  { value: "Inicial", label: "Inicial" },
  { value: "Una", label: "Una" },
  { value: "Outra", label: "Outra" },
];

function formatProcesso(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 20);
  let result = "";
  for (let i = 0; i < digits.length; i++) {
    if (i === 7) result += "-";
    if (i === 9) result += ".";
    if (i === 13) result += ".";
    if (i === 14) result += ".";
    if (i === 16) result += ".";
    result += digits[i];
  }
  return result;
}

function getNow() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  return { date, time };
}

type FormErrors = Partial<Record<keyof ProcessMetadata | "classeOutra", string>>;

export const MetadataForm = ({ initialData, onSubmit }: MetadataFormProps) => {
  const nowDefaults = getNow();

  const [form, setForm] = useState({
    numeroProcesso: initialData?.numeroProcesso ?? "",
    classeProcessual: initialData?.classeProcessual ?? "",
    classeOutra: "",
    partes: initialData?.partes ?? "",
    vara: initialData?.vara ?? "",
    nomeJuiz: initialData?.nomeJuiz ?? "",
    tipoAudiencia: initialData?.tipoAudiencia ?? "",
    dataAudiencia: initialData?.dataAudiencia?.split(" ")[0] ?? nowDefaults.date,
    horaAudiencia: initialData?.dataAudiencia?.split(" ")[1] ?? nowDefaults.time,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const isClasseOutra =
    form.classeProcessual === "Outra" ||
    (!CLASSES_PROCESSUAIS.some((c) => c.value === form.classeProcessual) &&
      form.classeProcessual !== "");

  const validate = useCallback(
    (fields = form): FormErrors => {
      const e: FormErrors = {};

      if (!fields.numeroProcesso.trim()) {
        e.numeroProcesso = "Número do processo é obrigatório.";
      } else if (!PROCESSO_REGEX.test(fields.numeroProcesso)) {
        e.numeroProcesso = "Formato inválido — use NNNNNNN-NN.NNNN.N.NN.NNNN";
      }

      if (!fields.classeProcessual) {
        e.classeProcessual = "Classe processual é obrigatória.";
      }

      if (fields.classeProcessual === "Outra" && !fields.classeOutra?.trim()) {
        e.classeOutra = "Especifique a classe processual.";
      }

      if (!fields.partes.trim()) {
        e.partes = "Partes é obrigatório.";
      }

      if (!fields.vara.trim()) {
        e.vara = "Vara é obrigatória.";
      }

      if (!fields.nomeJuiz.trim()) {
        e.nomeJuiz = "Nome do juiz é obrigatório.";
      }

      if (!fields.tipoAudiencia) {
        e.tipoAudiencia = "Tipo de audiência é obrigatório.";
      }

      if (!fields.dataAudiencia) {
        e.dataAudiencia = "Data da audiência é obrigatória.";
      }

      return e;
    },
    [form]
  );

  const handleChange = (field: string, value: string) => {
    const updated = { ...form, [field]: value };
    setForm(updated);

    if (touched.has(field)) {
      const newErrors = validate(updated);
      setErrors((prev) => {
        const copy = { ...prev };
        const key = field as keyof FormErrors;
        if (newErrors[key]) {
          copy[key] = newErrors[key];
        } else {
          delete copy[key];
        }
        return copy;
      });
    }
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => new Set(prev).add(field));
    const newErrors = validate();
    const key = field as keyof FormErrors;
    setErrors((prev) => {
      const copy = { ...prev };
      if (newErrors[key]) {
        copy[key] = newErrors[key];
      } else {
        delete copy[key];
      }
      return copy;
    });
  };

  const handleSubmit = () => {
    // Touch all fields
    const allFields = new Set([
      "numeroProcesso",
      "classeProcessual",
      "classeOutra",
      "partes",
      "vara",
      "nomeJuiz",
      "tipoAudiencia",
      "dataAudiencia",
    ]);
    setTouched(allFields);

    const validationErrors = validate();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) return;

    const classe =
      form.classeProcessual === "Outra"
        ? form.classeOutra
        : form.classeProcessual;

    const dataHora = `${form.dataAudiencia} ${form.horaAudiencia}`;

    onSubmit({
      numeroProcesso: form.numeroProcesso,
      classeProcessual: classe,
      partes: form.partes,
      vara: form.vara,
      nomeJuiz: form.nomeJuiz,
      tipoAudiencia: form.tipoAudiencia === "Outra" ? form.tipoAudiencia : form.tipoAudiencia,
      dataAudiencia: dataHora,
    });
  };

  const hasErrors = Object.keys(validate()).length > 0;

  return (
    <div className="space-y-6">
      {/* Número do Processo — full width */}
      <Input
        id="numeroProcesso"
        label="Número do Processo *"
        placeholder="0001234-56.2026.4.01.3400"
        value={form.numeroProcesso}
        onChange={(e) => handleChange("numeroProcesso", formatProcesso(e.target.value))}
        onBlur={() => handleBlur("numeroProcesso")}
        error={touched.has("numeroProcesso") ? errors.numeroProcesso : undefined}
      />

      {/* 2-column grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="classeProcessual"
          label="Classe Processual *"
          placeholder="Selecione..."
          options={CLASSES_PROCESSUAIS}
          value={
            isClasseOutra && form.classeProcessual !== "Outra"
              ? "Outra"
              : form.classeProcessual
          }
          onChange={(e) => handleChange("classeProcessual", e.target.value)}
          onBlur={() => handleBlur("classeProcessual")}
          error={touched.has("classeProcessual") ? errors.classeProcessual : undefined}
        />

        <Select
          id="tipoAudiencia"
          label="Tipo de Audiência *"
          placeholder="Selecione..."
          options={TIPOS_AUDIENCIA}
          value={form.tipoAudiencia}
          onChange={(e) => handleChange("tipoAudiencia", e.target.value)}
          onBlur={() => handleBlur("tipoAudiencia")}
          error={touched.has("tipoAudiencia") ? errors.tipoAudiencia : undefined}
        />
      </div>

      {/* Classe Outra input */}
      {(form.classeProcessual === "Outra" || isClasseOutra) && (
        <Input
          id="classeOutra"
          label="Especifique a Classe Processual *"
          placeholder="Digite a classe processual"
          value={form.classeOutra}
          onChange={(e) => handleChange("classeOutra", e.target.value)}
          onBlur={() => handleBlur("classeOutra")}
          error={touched.has("classeOutra") ? errors.classeOutra : undefined}
        />
      )}

      {/* Partes — full width */}
      <Input
        id="partes"
        label="Partes *"
        placeholder="Ex: João Silva x União Federal"
        value={form.partes}
        onChange={(e) => handleChange("partes", e.target.value)}
        onBlur={() => handleBlur("partes")}
        error={touched.has("partes") ? errors.partes : undefined}
      />

      {/* 2-column grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="vara"
          label="Vara *"
          placeholder="Ex: 3ª Vara Federal"
          value={form.vara}
          onChange={(e) => handleChange("vara", e.target.value)}
          onBlur={() => handleBlur("vara")}
          error={touched.has("vara") ? errors.vara : undefined}
        />

        <Input
          id="nomeJuiz"
          label="Nome do Juiz *"
          placeholder="Ex: Dr. Carlos Santos"
          value={form.nomeJuiz}
          onChange={(e) => handleChange("nomeJuiz", e.target.value)}
          onBlur={() => handleBlur("nomeJuiz")}
          error={touched.has("nomeJuiz") ? errors.nomeJuiz : undefined}
        />
      </div>

      {/* Date and time */}
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="dataAudiencia"
          label="Data da Audiência *"
          type="date"
          value={form.dataAudiencia}
          onChange={(e) => handleChange("dataAudiencia", e.target.value)}
          onBlur={() => handleBlur("dataAudiencia")}
          error={touched.has("dataAudiencia") ? errors.dataAudiencia : undefined}
        />

        <Input
          id="horaAudiencia"
          label="Hora da Audiência *"
          type="time"
          value={form.horaAudiencia}
          onChange={(e) => handleChange("horaAudiencia", e.target.value)}
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={hasErrors}
          className="inline-flex items-center gap-2 rounded-[4px] bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
        >
          Próximo
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
    </div>
  );
};
