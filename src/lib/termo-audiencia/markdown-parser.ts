export type ParsedLineType =
  | "heading1"
  | "heading2"
  | "list"
  | "paragraph"
  | "blank";

export interface ParsedLine {
  type: ParsedLineType;
  text: string;
}

export interface InlineRun {
  text: string;
  bold: boolean;
}

const HEADING_1 = /^# (.+)$/;
const HEADING_2 = /^##{1,2} (.+)$/;
const LIST_ITEM = /^[-*]\s+/;
const BOLD_INLINE = /\*\*(.+?)\*\*/g;

export function parseMarkdownLines(markdown: string): ParsedLine[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(parseLine);
}

function parseLine(raw: string): ParsedLine {
  const line = raw.trim();
  if (line.length === 0) return { type: "blank", text: "" };

  const heading1 = line.match(HEADING_1);
  if (heading1) return { type: "heading1", text: heading1[1].trim() };

  const heading2 = line.match(HEADING_2);
  if (heading2) return { type: "heading2", text: heading2[1].trim() };

  if (LIST_ITEM.test(line)) {
    return { type: "list", text: line.replace(LIST_ITEM, "") };
  }

  return { type: "paragraph", text: line };
}

export function stripBoldMarkers(text: string): string {
  return text.replace(BOLD_INLINE, "$1");
}

export function splitInlineBold(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = new RegExp(BOLD_INLINE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[1], bold: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), bold: false });
  }
  return runs.length > 0 ? runs : [{ text, bold: false }];
}
