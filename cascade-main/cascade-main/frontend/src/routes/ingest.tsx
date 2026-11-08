// Ingest: the first run on an empty site. One calm drop zone takes the site's own files (or a folder of
// them); once dropped it folds into a panel of cards, one per file, each labelled by the server as it reads
// it, while the floor beside it assembles from the growing model. When the batch is done the panel steps
// aside and the screen moves on to Site.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { floorStore, useFloor, RESTING } from "@/lib/floor";
import { useSite } from "@/lib/queries";
import { uiStore } from "@/lib/ui";
import type { UploadFileDto } from "@cascade/core/contract";
import { uploadSession, useUploadSession } from "@/lib/uploads";

export const Route = createFileRoute("/ingest")({ component: IngestView });

const PANEL_W = 468;
const CARD_H = 66;
const GAP = 8;

type FileType = "pdf" | "sheet" | "json" | "doc";
const typeOf = (name: string): FileType => (/\.pdf$/i.test(name) ? "pdf" : /\.(csv|tsv|xlsx?|ods)$/i.test(name) ? "sheet" : /\.json$/i.test(name) ? "json" : "doc");

const hidden = (name: string) => name.startsWith(".") || name === "Thumbs.db";

/** Every file under the dropped items, folders walked. Entries must be taken before the drop event ends. */
async function filesOf(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.() ?? null).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].filter((f) => !hidden(f.name));
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (hidden(e.name)) return;
    if (e.isFile) out.push(await new Promise<File>((ok, no) => (e as FileSystemFileEntry).file(ok, no)));
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      const kids: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        kids.push(...batch);
      }
      kids.sort((a, b) => a.name.localeCompare(b.name));
      for (const k of kids) await walk(k);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

function FileIcon({ type }: { type: FileType }) {
  return (
    <svg className="fic" data-type={type} width="22" height="26" viewBox="0 0 22 26" aria-hidden>
      <path className="pg" d="M3.5 1.5h10l5 5v18h-15z" />
      <path className="fold" d="M13.5 1.5v5h5" />
      {type === "sheet" && <path className="gl" d="M6.5 11.5h9M6.5 15.5h9M6.5 19.5h9M11 9.5v12" />}
      {type === "json" && <path className="gl" d="M9 10.5c-1.6 0-1.6 1.2-1.6 2.6s-.8 2-1.4 2c.6 0 1.4.6 1.4 2s0 2.6 1.6 2.6M13 10.5c1.6 0 1.6 1.2 1.6 2.6s.8 2 1.4 2c-.6 0-1.4.6-1.4 2s0 2.6-1.6 2.6" />}
      {type === "pdf" && <path className="gl" d="M6.5 10.5h6M6.5 13.5h9M6.5 16.5h9M6.5 19.5h7" />}
      {type === "doc" && <path className="gl" d="M6.5 11.5h9M6.5 15h9M6.5 18.5h6" />}
    </svg>
  );
}

function Mark({ status }: { status: UploadFileDto["status"] }) {
  if (status === "ingested")
    return (
      <svg className="st ok" width="16" height="16" viewBox="0 0 16 16" aria-label="Read">
        <path d="M3.5 8.4l2.9 2.9 6-6.4" />
      </svg>
    );
  if (status === "rejected")
    return (
      <svg className="st no" width="16" height="16" viewBox="0 0 16 16" aria-label="Not read">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
      </svg>
    );
  return <i className={`st ${status}`} aria-label={status} />;
}

function FileCard({ f, i, swatch, onTip }: { f: UploadFileDto; i: number; swatch: readonly [string, string] | undefined; onTip: (t: { text: string; x: number; y: number } | null) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (f.status === "reading") el.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [f.status]);
  const named = !!f.title && f.status !== "queued";
  // "Contract · Halcyon Health Partners": the kind sits small above the name.
  const [kind, ...rest] = f.title.split(" · ");
  const sub = named && rest.length ? kind : null;
  const tip = (e: MouseEvent) => f.status === "rejected" && f.reason && onTip({ text: f.reason, x: e.clientX, y: e.clientY });
  return (
    <div ref={el} className={`uf ${f.status}`} style={{ animationDelay: `${Math.min(i, 24) * 28}ms` }} onMouseMove={tip} onMouseLeave={() => onTip(null)} title={f.status === "rejected" ? undefined : f.name}>
      <FileIcon type={typeOf(f.name)} />
      <div className="tx">
        {sub && <small>{sub}</small>}
        <b key={named ? "t" : "n"} className={named ? "named" : ""}>
          {named ? (sub ? rest.join(" · ") : f.title) : f.name}
        </b>
        <span key={f.detail}>
          {swatch && <i className="sw" style={{ background: swatch[0], boxShadow: `inset 0 0 0 1px ${swatch[1]}` }} />}
          {named ? f.detail : ""}
        </span>
      </div>
      <Mark status={f.status} />
    </div>
  );
}

/** Cards keep their place when the server's files replace the placeholders: keyed by name and repeat. */
function keysOf(files: readonly UploadFileDto[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const n = seen.get(f.name) ?? 0;
    seen.set(f.name, n + 1);
    return `${f.name}#${n}`;
  });
}

function IngestView() {
  const s = useUploadSession();
  const { site } = useSite();
  const [over, setOver] = useState(false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const files = s.phase === "idle" ? [] : s.files;
  const open = s.phase !== "idle" && s.phase !== "failed";

  const handlers = useMemo(() => ({}), []);
  useFloor(RESTING, handlers, { top: 40, right: 110, bottom: 40, left: open ? PANEL_W + 64 : 12 });

  // Tilted, the equipment can be seen rising in; Site flies the camera back down to the plan.
  useEffect(() => floorStore.setCam("3d"), []);
  useEffect(() => {
    if (s.phase === "landed") uiStore.set({ greet: true });
  }, [s.phase]);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const hover = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void filesOf(e.dataTransfer).then((fs) => uploadSession.pick(fs));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", hover);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", hover);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const chosen = (e: ChangeEvent<HTMLInputElement>) => {
    const fs = [...(e.target.files ?? [])].filter((f) => !hidden(f.name));
    e.target.value = "";
    void uploadSession.pick(fs);
  };

  const settled = files.filter((f) => f.status === "ingested" || f.status === "rejected").length;
  const keys = keysOf(files);
  const rows = Math.ceil(files.length / 2);
  const height = open ? `min(calc(100% - 26px), ${84 + rows * (CARD_H + GAP)}px)` : undefined;

  return (
    <>
      <section className={`ingest panel ${open ? "open" : "idle"}${over ? " over" : ""} ${s.phase}`} style={open ? { width: PANEL_W, height } : undefined}>
        {open ? (
          <div className="list">
            <h2>
              Files
              <span className="tm">
                {settled} / {files.length}
              </span>
            </h2>
            <div className="uprog">
              <i style={{ width: `${files.length ? (settled / files.length) * 100 : 0}%` }} />
            </div>
            <div className="scroll">
              <div className="ufiles">
                {files.map((f, i) => (
                  <FileCard key={keys[i]} f={f} i={i} swatch={f.customer ? site?.customers.get(f.customer)?.tint : undefined} onTip={setTip} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="drop">
            <svg className="stack" width="64" height="56" viewBox="0 0 64 56" aria-hidden>
              <rect x="14" y="4" width="34" height="42" rx="4" />
              <rect x="20" y="9" width="34" height="42" rx="4" />
              <path d="M37 22v16M30 31l7 7 7-7" />
            </svg>
            <b>Drop your site's files</b>
            <div className="choose">
              <button onClick={() => filesInput.current?.click()}>Choose files</button>
              <span />
              <button onClick={() => dirInput.current?.click()}>Choose a folder</button>
            </div>
            {s.phase === "failed" && <div className="err">{s.message}</div>}
          </div>
        )}
        <input ref={filesInput} type="file" multiple hidden onChange={chosen} />
        <input
          ref={(el) => {
            dirInput.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          onChange={chosen}
        />
      </section>
      {tip && (
        <div className="tip on" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </>
  );
}
