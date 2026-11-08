// Source documents and the values parsers read from them.

import type { EntityKind } from '../contract.js';
import { sha256Hex } from '../hash.js';
import type { FactSource } from './sources.js';

declare const DOC: unique symbol;
export type DocId = string & { readonly [DOC]: true };

/** `pdf`: the document is a PDF and `text` is its text layer. */
export type DocFormat = 'csv' | 'json' | 'text' | 'pdf';

export interface SourceDocument {
  readonly id: DocId;
  /** Path relative to the site's docs directory. */
  readonly path: string;
  readonly format: DocFormat;
  readonly sha256: string;
  readonly text: string;
}

/** Content-addressed document id: the same bytes always get the same id, new bytes a new one. */
export function docIdFor(sha256: string): DocId {
  return `doc-${sha256.slice(0, 16)}` as DocId;
}

/** Builds a SourceDocument from its text; `id` and `sha256` are derived, never supplied. */
export function sourceDocument(input: { readonly path: string; readonly format: DocFormat; readonly text: string }): SourceDocument {
  const sha256 = sha256Hex(input.text);
  return { id: docIdFor(sha256), path: input.path, format: input.format, sha256, text: input.text };
}

/**
 * One value a parser read for one field of one entity. Loosely typed on purpose: this is the
 * boundary. `assemble` parses `field` + `value` against KINDS[kind].fields (the codecs).
 * `field: null` says only that the entity exists (a register row, a BMS point).
 */
export interface Statement {
  readonly subject: { readonly kind: EntityKind; readonly tag: string };
  readonly field: string | null;
  readonly value: unknown;
  readonly source: FactSource;
}
