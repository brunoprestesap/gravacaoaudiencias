import { describe, expect, it } from "vitest";
import {
  parseMarkdownLines,
  splitInlineBold,
  stripBoldMarkers,
} from "./markdown-parser";

describe("parseMarkdownLines", () => {
  it("classifica heading nível 1 com '# '", () => {
    const [line] = parseMarkdownLines("# TERMO DE AUDIÊNCIA");
    expect(line).toEqual({ type: "heading1", text: "TERMO DE AUDIÊNCIA" });
  });

  it("classifica heading nível 2 com '## '", () => {
    const [line] = parseMarkdownLines("## DISPOSITIVO");
    expect(line).toEqual({ type: "heading2", text: "DISPOSITIVO" });
  });

  it("classifica heading nível 3+ como heading2 (fallback)", () => {
    const [line] = parseMarkdownLines("### Subtítulo");
    expect(line).toEqual({ type: "heading2", text: "Subtítulo" });
  });

  it("classifica lista com '- ' e '* '", () => {
    expect(parseMarkdownLines("- item 1")[0]).toEqual({
      type: "list",
      text: "item 1",
    });
    expect(parseMarkdownLines("* item 2")[0]).toEqual({
      type: "list",
      text: "item 2",
    });
  });

  it("classifica linha vazia como blank", () => {
    expect(parseMarkdownLines("")[0]).toEqual({ type: "blank", text: "" });
    expect(parseMarkdownLines("   ")[0]).toEqual({ type: "blank", text: "" });
  });

  it("classifica linha simples como paragraph", () => {
    const [line] = parseMarkdownLines("Texto comum aqui.");
    expect(line).toEqual({ type: "paragraph", text: "Texto comum aqui." });
  });

  it("normaliza CRLF para LF", () => {
    const lines = parseMarkdownLines("# Título\r\n\r\nParágrafo");
    expect(lines).toHaveLength(3);
    expect(lines[0].type).toBe("heading1");
    expect(lines[1].type).toBe("blank");
    expect(lines[2].type).toBe("paragraph");
  });

  it("aplica trim em cada linha", () => {
    const [line] = parseMarkdownLines("   # Título   ");
    expect(line).toEqual({ type: "heading1", text: "Título" });
  });

  it("preserva ordem dos blocos", () => {
    const md = "# H1\n\n## H2\n\n- a\n- b\n\nParágrafo final";
    const types = parseMarkdownLines(md).map((l) => l.type);
    expect(types).toEqual([
      "heading1",
      "blank",
      "heading2",
      "blank",
      "list",
      "list",
      "blank",
      "paragraph",
    ]);
  });
});

describe("stripBoldMarkers", () => {
  it("remove **...** mantendo o texto", () => {
    expect(stripBoldMarkers("**JUIZ**")).toBe("JUIZ");
    expect(stripBoldMarkers("Pre **bold** post")).toBe("Pre bold post");
  });

  it("não toca em texto sem marcadores", () => {
    expect(stripBoldMarkers("texto plano")).toBe("texto plano");
  });

  it("remove múltiplos marcadores na mesma linha", () => {
    expect(stripBoldMarkers("**A** e **B**")).toBe("A e B");
  });
});

describe("splitInlineBold", () => {
  it("retorna single run não-negrito quando não há marcadores", () => {
    expect(splitInlineBold("texto plano")).toEqual([
      { text: "texto plano", bold: false },
    ]);
  });

  it("separa pre/bold/post em três runs", () => {
    expect(splitInlineBold("antes **meio** depois")).toEqual([
      { text: "antes ", bold: false },
      { text: "meio", bold: true },
      { text: " depois", bold: false },
    ]);
  });

  it("trata bold no início", () => {
    expect(splitInlineBold("**início** resto")).toEqual([
      { text: "início", bold: true },
      { text: " resto", bold: false },
    ]);
  });

  it("trata bold no final", () => {
    expect(splitInlineBold("início **fim**")).toEqual([
      { text: "início ", bold: false },
      { text: "fim", bold: true },
    ]);
  });

  it("suporta múltiplos boldes", () => {
    expect(splitInlineBold("**a** e **b**")).toEqual([
      { text: "a", bold: true },
      { text: " e ", bold: false },
      { text: "b", bold: true },
    ]);
  });

  it("retorna single run quando texto é apenas bold", () => {
    expect(splitInlineBold("**total**")).toEqual([
      { text: "total", bold: true },
    ]);
  });
});
