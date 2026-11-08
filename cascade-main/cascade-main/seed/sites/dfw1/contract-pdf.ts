// Renders one DFW1 contract (an MSA or an order form) as the PDF a provider's contracts team would
// send: letterhead, document number, parties, numbered clauses, real tables and signature blocks.
// The provider is fictional. Output is byte-stable: the creation date is fixed and nothing is random.
import PDFDocument from 'pdfkit';

export interface Signer {
  readonly org: string;
  readonly name: string;
  readonly title: string;
  readonly date: string;
}

export interface Table {
  readonly kind: 'table';
  readonly columns: readonly { readonly label: string; readonly width: number; readonly align?: 'left' | 'right' }[];
  readonly rows: readonly (readonly string[])[];
}

export type Block = { readonly kind: 'clause'; readonly text: string } | { readonly kind: 'note'; readonly text: string } | Table;

export interface Section {
  readonly heading: string;
  readonly blocks: readonly Block[];
}

export interface ContractPdf {
  /** "MASTER SERVICES AGREEMENT No. DFW-MSA-1156" */
  readonly title: string;
  /** Lines under the title (agreement reference, effective date, site). */
  readonly subtitle: readonly string[];
  /** Short form for running headers and footers, e.g. "Order Form No. OF-1156-02". */
  readonly docLabel: string;
  readonly customerName: string;
  readonly parties: readonly (readonly [label: string, lines: readonly string[]])[];
  readonly preamble: string | null;
  readonly sections: readonly Section[];
  readonly witness: string;
  readonly signers: readonly [Signer, Signer];
  readonly createdOn: string;
}

export const PROVIDER = {
  name: 'Blackland Colocation LLC',
  address: '4200 Lakeshore Industrial Pkwy, Garland, Texas 75041',
  phone: '(972) 555-0148',
  web: 'blacklandcolo.example',
} as const;

const INK = '#1d2329';
const MUTED = '#5b6670';
const RULE = '#c9d1d8';
const BRAND = '#24543f';
const SHADE = '#eef2f0';
const PAGE = { width: 612, height: 792, margin: 64 } as const;
const CONTENT = PAGE.width - 2 * PAGE.margin;
const BOTTOM = PAGE.height - 72;

/** A short stable hex id from text, for the e-signature envelope number. */
function envelopeOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');
  const a = hex(h);
  const b = hex(Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0);
  return `${a.slice(0, 4)}-${a.slice(4)}-${b.slice(0, 4)}-${b.slice(4)}`;
}

export function renderContractPdf(spec: ContractPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: PAGE.margin, bottom: 40, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: {
      Title: `${spec.docLabel} - ${spec.customerName}`,
      Author: PROVIDER.name,
      Subject: spec.title,
      Creator: `${PROVIDER.name} Contracts`,
      Producer: `${PROVIDER.name} Contracts`,
      CreationDate: new Date(`${spec.createdOn}T15:00:00Z`),
      ModDate: new Date(`${spec.createdOn}T15:00:00Z`),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const runningHeader = () => {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(`${PROVIDER.name}  |  ${spec.docLabel}  |  ${spec.customerName}`, PAGE.margin, 36, { width: CONTENT, lineBreak: false });
    doc.moveTo(PAGE.margin, 50).lineTo(PAGE.width - PAGE.margin, 50).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.x = PAGE.margin;
    doc.y = 66;
  };
  const ensure = (h: number) => {
    if (doc.y + h <= BOTTOM) return;
    doc.addPage();
    runningHeader();
  };

  // ── letterhead ──
  doc.rect(PAGE.margin, 52, 6, 30).fill(BRAND);
  doc.rect(PAGE.margin + 9, 60, 6, 22).fill(BRAND);
  doc.rect(PAGE.margin + 18, 68, 6, 14).fill(BRAND);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(BRAND).text(PROVIDER.name.toUpperCase(), PAGE.margin + 34, 54, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${PROVIDER.address}  ·  ${PROVIDER.phone}  ·  ${PROVIDER.web}`, PAGE.margin + 34, 73, { lineBreak: false });
  doc.moveTo(PAGE.margin, 92).lineTo(PAGE.width - PAGE.margin, 92).lineWidth(1.2).strokeColor(BRAND).stroke();

  // ── title block ──
  doc.x = PAGE.margin;
  doc.y = 110;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(spec.title, { width: CONTENT, align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const line of spec.subtitle) doc.text(line, { width: CONTENT, align: 'center' });
  doc.moveDown(1);

  // ── parties ──
  const labelW = 70;
  const partyTop = doc.y;
  doc.rect(PAGE.margin, partyTop, CONTENT, 4).fill(SHADE);
  let y = partyTop + 10;
  for (const [label, lines] of spec.parties) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), PAGE.margin + 8, y + 1, { width: labelW, lineBreak: false });
    let ly = y;
    lines.forEach((line, i) => {
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK).text(line, PAGE.margin + 8 + labelW, ly, { width: CONTENT - labelW - 16 });
      ly = doc.y + 1;
    });
    y = ly + 8;
  }
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.x = PAGE.margin;
  doc.y = y + 14;

  const paragraph = (text: string, opts: { size?: number; font?: string; color?: string; gap?: number } = {}) => {
    const font = () => doc.font(opts.font ?? 'Helvetica').fontSize(opts.size ?? 9.5);
    ensure(font().heightOfString(text, { width: CONTENT, lineGap: 1.5 }) + 4);
    font().fillColor(opts.color ?? INK).text(text, PAGE.margin, doc.y, { width: CONTENT, lineGap: 1.5 });
    doc.moveDown(opts.gap ?? 0.45);
  };

  const table = (t: Table) => {
    const total = t.columns.reduce((s, c) => s + c.width, 0);
    const widths = t.columns.map((c) => (c.width / total) * CONTENT);
    const pad = 6;
    const rowH = (cells: readonly string[], font: string) => {
      doc.font(font).fontSize(8.5);
      return Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i]! - 2 * pad }))) + 2 * pad - 2;
    };
    const header = () => drawRow(t.columns.map((c) => c.label), 'Helvetica-Bold', SHADE);
    const drawRow = (cells: readonly string[], font: string, fill: string | null): void => {
      const h = rowH(cells, font);
      if (doc.y + h > BOTTOM) {
        doc.addPage();
        runningHeader();
        if (fill === null) header();
      }
      const top = doc.y;
      if (fill) doc.rect(PAGE.margin, top, CONTENT, h).fill(fill);
      let x = PAGE.margin;
      cells.forEach((c, i) => {
        doc.font(font).fontSize(8.5).fillColor(INK).text(c, x + pad, top + pad - 1, { width: widths[i]! - 2 * pad, align: t.columns[i]!.align ?? 'left' });
        x += widths[i]!;
      });
      doc.moveTo(PAGE.margin, top + h).lineTo(PAGE.width - PAGE.margin, top + h).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.x = PAGE.margin;
      doc.y = top + h;
    };
    doc.moveDown(0.2);
    ensure(rowH(t.columns.map((c) => c.label), 'Helvetica-Bold') + rowH(t.rows[0] ?? [], 'Helvetica'));
    doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.width - PAGE.margin, doc.y).lineWidth(0.8).strokeColor(INK).stroke();
    header();
    for (const r of t.rows) drawRow(r, 'Helvetica', null);
    doc.moveDown(0.8);
  };

  if (spec.preamble) paragraph(spec.preamble, { gap: 0.8 });
  for (const s of spec.sections) {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND).text(s.heading, PAGE.margin, doc.y, { width: CONTENT });
    doc.moveDown(0.35);
    for (const b of s.blocks) {
      if (b.kind === 'table') table(b);
      else if (b.kind === 'note') paragraph(b.text, { font: 'Helvetica-Oblique', color: MUTED });
      else paragraph(b.text);
    }
    doc.moveDown(0.4);
  }

  // ── signatures ──
  ensure(170);
  doc.moveDown(0.6);
  paragraph(spec.witness, { gap: 1.2 });
  const colW = (CONTENT - 30) / 2;
  const top = doc.y;
  spec.signers.forEach((s, i) => {
    const x = PAGE.margin + i * (colW + 30);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(s.org.toUpperCase(), x, top, { width: colW, lineBreak: false });
    doc.roundedRect(x, top + 16, colW, 44, 3).lineWidth(0.6).strokeColor(BRAND).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(BRAND).text('Signed electronically by:', x + 6, top + 20, { width: colW - 12, lineBreak: false });
    doc.font('Times-Italic').fontSize(17).fillColor('#1b2f6b').text(s.name, x + 6, top + 29, { width: colW - 12, lineBreak: false });
    doc.font('Helvetica').fontSize(6).fillColor(MUTED).text(envelopeOf(`${spec.title}|${s.name}|${s.date}`), x + 6, top + 50, { width: colW - 12, lineBreak: false });
    doc.moveTo(x, top + 66).lineTo(x + colW, top + 66).lineWidth(0.6).strokeColor(INK).stroke();
    const field = (label: string, value: string, fy: number) => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(label, x, fy, { width: 34, lineBreak: false });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(value, x + 34, fy, { width: colW - 34, lineBreak: false });
    };
    field('By:', s.name, top + 72);
    field('Title:', s.title, top + 86);
    field('Date:', s.date, top + 100);
  });
  doc.x = PAGE.margin;
  doc.y = top + 120;

  // ── footers, once the page count is known ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const fy = PAGE.height - 44;
    doc.moveTo(PAGE.margin, fy - 6).lineTo(PAGE.width - PAGE.margin, fy - 6).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    doc.text(`${PROVIDER.name}  ·  Confidential`, PAGE.margin, fy, { width: CONTENT / 2, lineBreak: false });
    doc.text(`${spec.docLabel}  ·  Page ${i - range.start + 1} of ${range.count}`, PAGE.margin + CONTENT / 2, fy, { width: CONTENT / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
