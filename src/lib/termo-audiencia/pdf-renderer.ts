import PDFDocument from "pdfkit";
import { HEADER_INSTITUCIONAL, type TermoHeader } from "./header";
import {
  parseMarkdownLines,
  splitInlineBold,
  stripBoldMarkers,
  type InlineRun,
  type ParsedLine,
} from "./markdown-parser";

const PDF_OPTIONS = {
  size: "A4" as const,
  margins: { top: 60, bottom: 60, left: 70, right: 70 },
};

const FONT_REGULAR = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

const TITLE_SIZE = 13;
const SECTION_SIZE = 11;
const BODY_SIZE = 10;

type PdfDoc = InstanceType<typeof PDFDocument>;

function writeInstitutionalHeader(doc: PdfDoc, header: TermoHeader): void {
  doc.font(FONT_BOLD).fontSize(SECTION_SIZE);
  HEADER_INSTITUCIONAL.forEach((linha) => {
    doc.text(linha, { align: "center" });
  });
  if (header.vara) {
    doc.text(header.vara, { align: "center" });
  }
  doc.moveDown(0.5);

  doc.font(FONT_REGULAR).fontSize(BODY_SIZE);
  doc.text(`Processo n. ${header.numeroProcesso}`);
  if (header.classeProcessual) doc.text(`Classe: ${header.classeProcessual}`);
  if (header.partes) doc.text(`Partes: ${header.partes}`);
  doc.moveDown(1);
}

function writeInlineRuns(doc: PdfDoc, runs: InlineRun[], terminate: boolean): void {
  runs.forEach((run, idx) => {
    doc.font(run.bold ? FONT_BOLD : FONT_REGULAR);
    doc.text(run.text, { continued: idx < runs.length - 1 });
  });
  if (terminate && runs.length === 0) doc.text("");
}

function writeLine(doc: PdfDoc, line: ParsedLine): void {
  switch (line.type) {
    case "heading1":
      doc.font(FONT_BOLD).fontSize(TITLE_SIZE).text(stripBoldMarkers(line.text), {
        align: "center",
      });
      doc.moveDown(0.5);
      return;
    case "heading2":
      doc.font(FONT_BOLD).fontSize(SECTION_SIZE).text(stripBoldMarkers(line.text));
      doc.moveDown(0.3);
      return;
    case "list": {
      doc.font(FONT_REGULAR).fontSize(BODY_SIZE);
      doc.text("  • ", { continued: true });
      writeInlineRuns(doc, splitInlineBold(line.text), true);
      return;
    }
    case "paragraph":
      doc.fontSize(BODY_SIZE);
      writeInlineRuns(doc, splitInlineBold(line.text), false);
      doc.moveDown(0.2);
      return;
    case "blank":
      doc.moveDown(0.4);
      return;
  }
}

export function renderTermoPdf(
  markdown: string,
  header: TermoHeader
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(PDF_OPTIONS);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    writeInstitutionalHeader(doc, header);
    parseMarkdownLines(markdown).forEach((line) => writeLine(doc, line));

    doc.end();
  });
}
