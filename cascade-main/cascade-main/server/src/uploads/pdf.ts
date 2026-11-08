// A PDF's text layer as plain lines, the shape the contract parser and the model read. Items are
// grouped into lines by baseline and joined left to right; a wide horizontal gap (a table column)
// becomes three spaces. A paragraph the PDF wrapped is joined back into one line, the way the
// document states it, so a clause reads as one line whatever the page width.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';

interface Line {
  readonly y: number;
  readonly x0: number;
  readonly x1: number;
  readonly size: number;
  readonly text: string;
  /** The line has a column gap: a table row or side-by-side blocks, never a wrapped paragraph. */
  readonly columns: boolean;
}

const COLUMN_GAP = '   ';
const STARTS_ITEM = /^(\(?\d+(\.\d+)*[.)]?\s|\(?[a-z]\)\s|[•·-]\s)/;

function linesOf(items: readonly TextItem[]): Line[] {
  const words = items
    .filter((it) => it.str.trim() !== '')
    .map((it) => ({ x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, size: Math.abs(it.transform[3] as number) || it.height, str: it.str }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: (typeof words)[] = [];
  for (const w of words) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - w.y) <= Math.max(2, w.size * 0.3)) row.push(w);
    else rows.push([w]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = '';
    let columns = false;
    let end = row[0]!.x;
    for (const w of row) {
      const gap = w.x - end;
      if (text) {
        if (gap > w.size * 1.2) {
          text = `${text.trimEnd()}${COLUMN_GAP}`;
          columns = true;
        } else if (gap > w.size * 0.15 && !/\s$/.test(text)) text += ' ';
      }
      text += text.endsWith(' ') ? w.str.trimStart() : w.str;
      end = w.x + w.w;
    }
    const size = Math.max(...row.map((w) => w.size));
    return { y: row[0]!.y, x0: row[0]!.x, x1: end, size, text: text.trimEnd(), columns };
  });
}

/** Joins each wrapped continuation line onto the line it continues. */
function reflow(lines: readonly Line[]): string[] {
  const right = Math.max(0, ...lines.map((l) => l.x1));
  const out: Line[] = [];
  for (const l of lines) {
    const prev = out.at(-1);
    const continues =
      prev !== undefined &&
      !prev.columns &&
      !l.columns &&
      Math.abs(prev.size - l.size) < 0.25 &&
      Math.abs(prev.x0 - l.x0) < 2 &&
      prev.y - l.y <= l.size * 1.7 &&
      prev.x1 > right - l.size * 8 &&
      !STARTS_ITEM.test(l.text);
    if (continues) out[out.length - 1] = { ...prev, y: l.y, x1: l.x1, text: `${prev.text} ${l.text}` };
    else out.push(l);
  }
  return out.map((l) => l.text);
}

/** The text of every page, one line per paragraph or table row, pages separated by a blank line. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(reflow(linesOf(content.items.filter((it): it is TextItem => 'str' in it))).join('\n'));
    }
    return `${pages.join('\n\n')}\n`;
  } finally {
    await task.destroy();
  }
}
