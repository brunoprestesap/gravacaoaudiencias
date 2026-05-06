import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { HEADER_INSTITUCIONAL, type TermoHeader } from "./header";
import {
  parseMarkdownLines,
  splitInlineBold,
  stripBoldMarkers,
  type InlineRun,
  type ParsedLine,
} from "./markdown-parser";

function makeRunsParagraph(
  runs: InlineRun[],
  options?: { bullet?: boolean }
): Paragraph {
  return new Paragraph({
    bullet: options?.bullet ? { level: 0 } : undefined,
    children: runs.map(
      (run) => new TextRun({ text: run.text, bold: run.bold })
    ),
  });
}

function emptyParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun("")] });
}

function buildInstitutionalHeader(header: TermoHeader): Paragraph[] {
  const paragraphs: Paragraph[] = HEADER_INSTITUCIONAL.map(
    (linha) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: linha, bold: true })],
      })
  );

  if (header.vara) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: header.vara, bold: true })],
      })
    );
  }

  paragraphs.push(emptyParagraph());
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: `Processo n. ${header.numeroProcesso}` })],
    })
  );
  if (header.classeProcessual) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: `Classe: ${header.classeProcessual}` })],
      })
    );
  }
  if (header.partes) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: `Partes: ${header.partes}` })],
      })
    );
  }
  paragraphs.push(emptyParagraph());
  return paragraphs;
}

function buildLineParagraph(line: ParsedLine): Paragraph {
  switch (line.type) {
    case "heading1":
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: stripBoldMarkers(line.text), bold: true })],
      });
    case "heading2":
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: stripBoldMarkers(line.text), bold: true })],
      });
    case "list":
      return makeRunsParagraph(splitInlineBold(line.text), { bullet: true });
    case "paragraph":
      return makeRunsParagraph(splitInlineBold(line.text));
    case "blank":
      return emptyParagraph();
    default:
      return emptyParagraph();
  }
}

export async function renderTermoDocx(
  markdown: string,
  header: TermoHeader
): Promise<Buffer> {
  const headerParagraphs = buildInstitutionalHeader(header);
  const bodyParagraphs = parseMarkdownLines(markdown).map(buildLineParagraph);

  const doc = new Document({
    sections: [
      {
        children: [...headerParagraphs, ...bodyParagraphs],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
