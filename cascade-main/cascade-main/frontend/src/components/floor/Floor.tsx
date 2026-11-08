// The site floor: one React Three Fiber canvas that stays mounted under every view. At rest it is a
// straight-down plan; 3D tilts it about 50 degrees. Boxes, cables and rings are built imperatively from
// the layout (a few hundred objects, recoloured every frame), labels are DOM over the canvas, decluttered
// by priority so no two overlap.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cabinetRevenue, depthFrom, labelOf, revenueBehind, SELECTABLE, type Site } from "@/lib/site";
import { floorBus, floorStore, type FloorPaint, type Insets, type Look } from "@/lib/floor";
import { usd } from "@/lib/format";
import { FH, FW, buildLayout, type Box, type FloorLayout } from "./layout";

const C = {
  bg: 0xeef0f2,
  red: "#d93a2b",
  redEdge: "#b02a1e",
  amber: "#e3940b",
  amberFill: "#f8dba4",
  ink: "#1c2228",
  calm: "#3a6ea5",
  calmFill: "#d6e3f2",
  gray: "#9099a3",
  eq: "#c9ced4",
  eqEdge: "#b2b9c1",
  fadeCab: "#eceef0",
  fadeCabEdge: "#dfe2e6",
  fadeEq: "#dde1e5",
  fadeEqEdge: "#cfd4d9",
  litEq: "#aeb6bf",
  litEdge: "#7f8994",
};
const TONE = { red: C.red, amber: C.amber, gray: C.gray } as const;

interface Style {
  fill: string;
  edge: string;
  cls: string;
}

/** The one table from what an entity is to how it looks. */
function styleOf(b: Box, look: Look | undefined, p: FloorPaint, tint: readonly [string, string] | undefined): Style {
  const faded = b.cab ? { fill: C.fadeCab, edge: C.fadeCabEdge, cls: "faded" } : { fill: C.fadeEq, edge: C.fadeEqEdge, cls: "faded" };
  if (p.candidates) return p.candidates.has(b.id) ? { fill: C.calmFill, edge: C.calm, cls: "cand" } : b.id === p.selected ? { fill: "#ffffff", edge: C.calm, cls: "selname" } : faded;
  if (!p.active) return b.cab && tint ? { fill: tint[0], edge: tint[1], cls: "" } : { fill: C.eq, edge: C.eqEdge, cls: "" };
  if (look === "dark") return { fill: C.red, edge: C.redEdge, cls: "dark" };
  if (look === "backup") return { fill: C.amberFill, edge: C.amber, cls: "backup" };
  if (look === "serviced") return { fill: C.ink, edge: C.ink, cls: "serviced" };
  if (look === "lit") return b.cab && tint ? { fill: tint[0], edge: tint[1], cls: "lit" } : { fill: C.litEq, edge: C.litEdge, cls: "lit" };
  return faded;
}

interface Mode {
  theta: number;
  phi: number;
  fov: number;
  zoom: number;
  tx: number;
  tz: number;
}
const MODES: Record<"2d" | "3d", Mode> = {
  "2d": { theta: 0.0001, phi: 0, fov: 8, zoom: 1, tx: 0, tz: 0 },
  "3d": { theta: (50 * Math.PI) / 180, phi: -0.32, fov: 30, zoom: 1.04, tx: -50, tz: 10 },
};
const FLIGHT_MS = 600;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function roundRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

interface Item {
  box: Box;
  mat: THREE.MeshLambertMaterial;
  emat: THREE.LineBasicMaterial;
  mesh: THREE.Mesh;
  label: HTMLDivElement;
  fill: THREE.Color;
  edge: THREE.Color;
  /** When its colour starts to change (ripple). */
  t0: number;
  lw: number;
  lh: number;
  cls: string;
  rank: number;
  shown: boolean;
  pos: string;
}

interface Fx {
  obj: THREE.Object3D;
  tick: (now: number) => void;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

interface WorldProps {
  site: Site;
  layout: FloorLayout;
  labels: RefObject<HTMLDivElement | null>;
  tip: RefObject<HTMLDivElement | null>;
}

function World({ site, layout, labels, tip }: WorldProps) {
  const { scene, camera, gl, raycaster } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const items = useRef(new Map<string, Item>());
  const fx = useRef<Fx[]>([]);
  /** Cables are kept apart so a selection change does not regrow them. */
  const cableFx = useRef<Fx[]>([]);
  const view = useRef({ ...MODES[floorStore.get().cam], mode: floorStore.get().cam, flight: null as null | { from: Mode; to: Mode; t0: number } });
  const insets = useRef<Insets>({ ...floorStore.get().insets });
  const paintRef = useRef<FloorPaint>(floorStore.get().paint);
  const dragging = useRef(false);

  // Static scene: lights, rooms, boxes, labels.
  useEffect(() => {
    gl.setClearColor(C.bg);
    const root = new THREE.Group();
    root.add(new THREE.HemisphereLight(0xffffff, 0xd9dee4, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.05);
    sun.position.set(-500, 1400, 700);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -1500, right: 1500, top: 1200, bottom: -1200, near: 100, far: 4000 });
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0008;
    sun.shadow.camera.updateProjectionMatrix();
    root.add(sun);
    root.add(new THREE.AmbientLight(0xffffff, 0.2));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: C.bg }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    root.add(ground);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.ShadowMaterial({ opacity: 0.07 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.3;
    catcher.receiveShadow = true;
    root.add(catcher);
    for (const z of layout.zones) {
      const [a, b] = layout.at(z.x0, z.z0);
      const [c, d] = layout.at(z.x1, z.z1);
      const w = c - a;
      const h = d - b;
      const m = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(w, h, 10)), new THREE.MeshBasicMaterial({ color: z.fill }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(a + w / 2, 0, b + h / 2);
      root.add(m);
      const pts = roundRect(w, h, 10).getPoints(8).map((p) => new THREE.Vector3(a + w / 2 + p.x, 0.4, b + h / 2 - p.y));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        z.dashed ? new THREE.LineDashedMaterial({ color: z.edge, dashSize: 5, gapSize: 5 }) : new THREE.LineBasicMaterial({ color: z.edge }),
      );
      if (z.dashed) line.computeLineDistances();
      root.add(line);
    }
    const host = labels.current!;
    const map = new Map<string, Item>();
    for (const box of layout.boxes.values()) {
      const s = styleOf(box, undefined, floorStore.get().paint, box.customer ? site.customers.get(box.customer)?.tint : undefined);
      const mat = new THREE.MeshLambertMaterial({ color: s.fill });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.H, box.d), mat);
      mesh.position.set(box.X, box.H / 2, box.Z);
      mesh.castShadow = true;
      mesh.userData["id"] = box.id;
      root.add(mesh);
      const emat = new THREE.LineBasicMaterial({ color: s.edge });
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), emat);
      edges.position.copy(mesh.position);
      root.add(edges);
      const label = document.createElement("div");
      label.className = box.cab ? "l3 cab" : "l3";
      label.textContent = box.label;
      host.appendChild(label);
      map.set(box.id, { box, mat, emat, mesh, label, fill: new THREE.Color(s.fill), edge: new THREE.Color(s.edge), t0: 0, lw: 0, lh: 0, cls: label.className, rank: 0, shown: true, pos: "" });
    }
    items.current = map;
    scene.add(root);
    const remeasure = () => map.forEach((it) => (it.lw = 0));
    void document.fonts?.ready.then(remeasure);
    return () => {
      scene.remove(root);
      sun.dispose();
      disposeTree(root);
      host.replaceChildren();
      items.current = new Map();
    };
  }, [layout, site, scene, gl, labels]);

  // Paint: target colours with a ripple outward from the origin, label classes, and effects.
  useEffect(() => {
    let prev: FloorPaint | null = null;
    const apply = (p: FloorPaint) => {
      paintRef.current = p;
      const now = performance.now();
      const depth = p.origin ? depthFrom(site, p.origin) : new Map<string, number>();
      for (const it of items.current.values()) {
        const look = p.looks.get(it.box.id);
        const s = styleOf(it.box, look, p, it.box.customer ? site.customers.get(it.box.customer)?.tint : undefined);
        const fill = new THREE.Color(s.fill);
        const edge = new THREE.Color(s.edge);
        if (!fill.equals(it.fill) || !edge.equals(it.edge)) {
          it.t0 = now + (p.active && depth.has(it.box.id) ? Math.min(depth.get(it.box.id)!, 12) * 45 : 0);
          it.fill = fill;
          it.edge = edge;
        }
        let cls = `l3${it.box.cab ? " cab" : ""}${s.cls ? ` ${s.cls}` : ""}`;
        if (p.highlight.has(it.box.id)) cls += " hl";
        if (p.selected === it.box.id && !s.cls) cls += " selname";
        if (cls !== it.cls) {
          it.label.className = cls;
          it.cls = cls;
          it.lw = 0;
        }
        it.label.style.transitionDelay = `${Math.max(0, it.t0 - now)}ms`;
        it.rank =
          (p.selected === it.box.id ? 1000 : 0) +
          (s.cls === "dark" || s.cls === "serviced" || s.cls === "cand" || p.highlight.has(it.box.id) ? 400 : s.cls === "backup" || s.cls === "lit" ? 300 : s.cls === "faded" ? 0 : 100) +
          (it.box.cab ? 0 : 50) +
          Math.min(40, it.box.w * it.box.d * 0.005);
      }
      const cablesChanged = !prev || prev.looks !== p.looks || prev.cables !== p.cables || prev.origin !== p.origin;
      rebuildFx(p, depth, cablesChanged);
      prev = p;
    };
    const drop = (list: Fx[]) => {
      for (const f of list) {
        scene.remove(f.obj);
        disposeTree(f.obj);
      }
    };
    const rebuildFx = (p: FloorPaint, depth: Map<string, number>, cablesChanged: boolean) => {
      drop(fx.current);
      const out: Fx[] = [];
      const cables: Fx[] = [];
      const add = (obj: THREE.Object3D, tick: Fx["tick"] = () => {}, into: Fx[] = out) => {
        scene.add(obj);
        into.push({ obj, tick });
      };
      const boxOf = (id: string) => items.current.get(id)?.box;
      const ring = (id: string, color: string) => {
        const b = boxOf(id);
        if (!b) return;
        for (const delay of [0, 800]) {
          const outer = roundRect(b.w + 8, b.d + 8, 5);
          outer.holes.push(roundRect(b.w + 4, b.d + 4, 3));
          const m = new THREE.Mesh(new THREE.ShapeGeometry(outer), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(b.X, 1, b.Z);
          const t0 = performance.now() + delay;
          add(m, (now) => {
            if (now < t0) return void (m.material.opacity = 0);
            const k = ((now - t0) % 1600) / 1600;
            const s = 1 + k * 0.9;
            m.scale.set(s, s, 1);
            m.material.opacity = 0.9 * (1 - k);
          });
        }
      };
      if (cablesChanged) drop(cableFx.current);
      if (cablesChanged && p.cables) {
        for (const l of site.power) {
          if (l.id.startsWith("cord:") || site.node.get(l.to)?.kind === "circuit" || l.path3.length < 2) continue;
          const a = p.looks.get(l.from);
          const b = p.looks.get(l.to);
          if (!a || !b || a === "lit" || b === "lit") continue;
          const color = (a === "dark" || a === "serviced") && b === "dark" ? C.red : C.amber;
          const pts: THREE.Vector3[] = [];
          l.path3.forEach(([x, , z], i) => {
            if (i) {
              const [x0, , z0] = l.path3[i - 1]!;
              const n = Math.ceil(Math.hypot(x - x0, z - z0) / 0.25);
              for (let k = 1; k < n; k++) {
                const [X, Z] = layout.at(x0 + ((x - x0) * k) / n, z0 + ((z - z0) * k) / n);
                pts.push(new THREE.Vector3(X, 2, Z));
              }
            }
            const [X, Z] = layout.at(x, z);
            pts.push(new THREE.Vector3(X, 2, Z));
          });
          const clean = pts.filter((q, i) => !i || q.distanceTo(pts[i - 1]!) > 0.5);
          if (clean.length < 2) continue;
          const path = new THREE.CurvePath<THREE.Vector3>();
          for (let i = 1; i < clean.length; i++) path.add(new THREE.LineCurve3(clean[i - 1]!, clean[i]!));
          const geo = new THREE.TubeGeometry(path, Math.min(400, clean.length * 2), 1.3, 6, false);
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
          const total = geo.index!.count;
          geo.setDrawRange(0, 0);
          const t0 = performance.now() + Math.min(depth.get(l.from) ?? 0, 12) * 45;
          add(
            new THREE.Mesh(geo, mat),
            (now) => {
              const k = Math.max(0, Math.min(1, (now - t0) / 700));
              geo.setDrawRange(0, Math.floor((total * ease(k)) / 3) * 3);
              mat.opacity = 0.78 * Math.min(1, k * 3);
            },
            cables,
          );
        }
      }
      if (cablesChanged) cableFx.current = cables;
      for (const id of p.pulse) ring(id, TONE[p.pulseTone]);
      for (const { from, to } of p.arcs) {
        const a = boxOf(from);
        const b = boxOf(to);
        if (!a || !b) continue;
        const p0 = new THREE.Vector3(a.X, a.H, a.Z);
        const p2 = new THREE.Vector3(b.X, b.H, b.Z);
        const mid = p0.clone().add(p2).multiplyScalar(0.5);
        mid.y += Math.max(60, p0.distanceTo(p2) * 0.35);
        const geo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, mid, p2), 64, 1.8, 6, false);
        const total = geo.index!.count;
        const t0 = performance.now();
        add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C.calm, transparent: true, opacity: 0.9 })), (now) => {
          geo.setDrawRange(0, Math.floor((total * ease(Math.min(1, (now - t0) / 800))) / 3) * 3);
        });
        for (const e of [a, b]) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: C.calm }));
          dot.position.set(e.X, e.H + 1, e.Z);
          add(dot);
        }
      }
      for (const id of p.highlight) ring(id, C.calm);
      if (p.selected && boxOf(p.selected)) {
        const b = boxOf(p.selected)!;
        const color = p.candidates ? C.calm : C.ink;
        const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w + 7, b.H + 4, b.d + 7)), new THREE.LineBasicMaterial({ color }));
        frame.position.set(b.X, (b.H + 4) / 2, b.Z);
        add(frame);
        const plate = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(b.w + 12, b.d + 12, 5)), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false }));
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(b.X, 0.6, b.Z);
        add(plate);
      }
      if (p.candidates) for (const id of p.candidates) ring(id, C.calm);
      for (const { id, tone } of p.dots) {
        const b = boxOf(id);
        if (!b) continue;
        const color = tone === "red" ? C.red : C.amber;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), new THREE.MeshBasicMaterial({ color }));
        dot.position.set(b.X, b.H + 9, b.Z);
        add(dot);
        const halo = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }));
        halo.position.copy(dot.position);
        add(halo, (now) => {
          const k = (now % 1800) / 1800;
          halo.scale.setScalar(1 + k * 1.6);
          halo.material.opacity = 0.45 * (1 - k);
        });
      }
      fx.current = out;
    };
    apply(floorStore.get().paint);
    const unsubscribe = floorStore.subscribe(() => {
      const s = floorStore.get();
      if (s.paint !== paintRef.current) apply(s.paint);
      const v = view.current;
      if (s.cam !== v.mode) {
        v.mode = s.cam;
        v.flight = { from: { theta: v.theta, phi: v.phi, fov: v.fov, zoom: v.zoom, tx: v.tx, tz: v.tz }, to: MODES[s.cam], t0: performance.now() };
      }
    });
    return () => {
      unsubscribe();
      drop(fx.current);
      drop(cableFx.current);
      fx.current = [];
      cableFx.current = [];
    };
  }, [site, layout, scene]);

  // Pointer: click picks, drag orbits (from the plan it lifts into 3D), wheel zooms in 3D.
  useEffect(() => {
    const cv = gl.domElement;
    const ndc = new THREE.Vector2();
    const pickAt = (e: PointerEvent): string | null => {
      const r = cv.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, cam);
      const hit = raycaster.intersectObjects([...items.current.values()].map((i) => i.mesh))[0];
      return (hit?.object.userData["id"] as string | undefined) ?? null;
    };
    const showTip = (id: string | null, e: PointerEvent) => {
      const t = tip.current;
      if (!t) return;
      if (!id) return void (t.style.opacity = "0");
      const n = site.node.get(id);
      const owner = n?.customer ? site.customers.get(n.customer) : undefined;
      const num = n?.kind === "cabinet" ? `${owner?.name ?? ""} · ${usd(cabinetRevenue(site, id))}` : revenueBehind(site, id) ? usd(revenueBehind(site, id)) : "";
      t.replaceChildren();
      const b = document.createElement("b");
      b.textContent = labelOf(site, id);
      t.appendChild(b);
      if (num) {
        const s = document.createElement("span");
        s.textContent = num;
        t.appendChild(s);
      }
      t.style.opacity = "1";
      t.style.left = `${e.clientX + 14}px`;
      t.style.top = `${e.clientY + 14}px`;
    };
    let drag: { x: number; y: number; moved: boolean; lifted: boolean } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: false, lifted: false };
      cv.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) {
          drag.moved = true;
          dragging.current = true;
          cv.classList.add("dragging");
          if (floorStore.get().cam === "2d") {
            floorStore.setCam("3d");
            drag.lifted = true;
          }
        }
        const v = view.current;
        if (drag.moved && !drag.lifted && !v.flight) {
          v.phi -= dx * 0.005;
          v.theta = Math.max(0.15, Math.min(1.25, v.theta - dy * 0.004));
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        if (tip.current) tip.current.style.opacity = "0";
        return;
      }
      const id = pickAt(e);
      const p = paintRef.current;
      cv.classList.toggle("pointing", !!id && (SELECTABLE.has(site.node.get(id)?.kind ?? "") || !!p.candidates?.has(id)));
      showTip(id, e);
    };
    const end = () => {
      drag = null;
      dragging.current = false;
      cv.classList.remove("dragging");
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) floorStore.get().handlers.onPick?.(pickAt(e));
      end();
    };
    const leave = () => {
      if (tip.current) tip.current.style.opacity = "0";
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (floorStore.get().cam === "2d") return;
      const v = view.current;
      v.zoom = Math.max(0.7, Math.min(3, v.zoom * Math.exp(-e.deltaY * 0.0012)));
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("lostpointercapture", end);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", end);
      cv.removeEventListener("lostpointercapture", end);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
    };
  }, [gl, cam, raycaster, site, tip]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const last = useRef(performance.now());
  useFrame(({ size }) => {
    const now = performance.now();
    const dt = Math.min(64, now - last.current);
    last.current = now;
    const v = view.current;
    if (v.flight) {
      const k = Math.min(1, (now - v.flight.t0) / FLIGHT_MS);
      const e = ease(k);
      for (const key of ["theta", "phi", "fov", "zoom", "tx", "tz"] as const) v[key] = v.flight.from[key] + (v.flight.to[key] - v.flight.from[key]) * e;
      if (k >= 1) v.flight = null;
    }
    floorBus.moving = !!v.flight;
    // Insets glide so the plan reframes smoothly when a panel opens.
    const want = floorStore.get().insets;
    const a = 1 - Math.exp(-dt / 90);
    const ins = insets.current;
    for (const key of ["top", "right", "bottom", "left"] as const) ins[key] += (want[key] - ins[key]) * a;
    const W = size.width;
    const H = size.height;
    const w = Math.max(80, W - ins.left - ins.right);
    const h = Math.max(80, H - ins.top - ins.bottom);
    const half = Math.max((FH / 2) * (H / h), (FW / 2) * (H / w)) * 1.02;
    const dist = half / Math.tan((v.fov * Math.PI) / 360) / v.zoom;
    cam.fov = v.fov;
    // Near and far hug the plan so the depth buffer resolves the floor's thin layers from far away.
    cam.near = Math.max(10, dist - 2500);
    cam.far = dist + 2500;
    cam.setViewOffset(W, H, W / 2 - (ins.left + w / 2), H / 2 - (ins.top + h / 2), W, H);
    cam.updateProjectionMatrix();
    cam.position.set(v.tx + dist * Math.sin(v.theta) * Math.sin(v.phi), dist * Math.cos(v.theta), v.tz + dist * Math.sin(v.theta) * Math.cos(v.phi));
    cam.lookAt(v.tx, 0, v.tz);
    cam.updateMatrixWorld();

    const k = 1 - Math.exp(-dt / 110);
    for (const it of items.current.values()) {
      if (now < it.t0) continue;
      it.mat.color.lerp(it.fill, k);
      it.emat.color.lerp(it.edge, k);
    }
    for (const f of fx.current) f.tick(now);
    for (const f of cableFx.current) f.tick(now);

    const project = (x: number, y: number, z: number) => {
      tmp.set(x, y, z).project(cam);
      return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H };
    };
    // Labels: place, then show the highest-ranked ones that do not collide.
    const placed: [number, number, number, number][] = [];
    const order = [...items.current.values()].sort((p, q) => q.rank - p.rank);
    for (const it of order) {
      const b = it.box;
      const p = b.cab ? project(b.X, b.H, b.Z) : b.labelAbove ? project(b.X, b.H, b.Z - b.d / 2) : project(b.X, 0, b.Z + b.d / 2);
      if (!it.lw) {
        it.lw = it.label.offsetWidth;
        it.lh = it.label.offsetHeight || 12;
      }
      const x = p.x - it.lw / 2;
      const y = p.y + (b.cab ? -6 : b.labelAbove ? -18 : 6);
      const rect: [number, number, number, number] = [x - 2, y - 1, x + it.lw + 2, y + it.lh + 1];
      const clash = placed.some((r) => r[0] < rect[2] && rect[0] < r[2] && r[1] < rect[3] && rect[1] < r[3]);
      const show = !clash;
      if (show) placed.push(rect);
      if (show !== it.shown) {
        it.label.style.opacity = show ? "" : "0";
        it.shown = show;
      }
      const pos = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      if (pos !== it.pos) {
        it.label.style.transform = pos;
        it.pos = pos;
      }
    }
    floorBus.project = (id, top) => {
      const b = items.current.get(id)?.box;
      return b ? project(b.X, top ? b.H : b.H / 2, b.Z) : null;
    };
    floorBus.litPoints = () => [...items.current.values()].filter((i) => /\b(dark|backup|serviced|cand)\b/.test(i.cls)).map((i) => project(i.box.X, i.box.H, i.box.Z));
    for (const f of floorBus.frame) f();
  });
  return null;
}

export function Floor({ site }: { site: Site }) {
  const layout = useMemo(() => buildLayout(site.scene), [site.scene]);
  const labels = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  return (
    <div className="floor">
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 2]}
        flat
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 8, near: 10, far: 40000, position: [0, 9000, 0.01] }}
        frameloop="always"
      >
        <World site={site} layout={layout} labels={labels} tip={tip} />
      </Canvas>
      <div className="labels" ref={labels} />
      <div className="tip" ref={tip} />
    </div>
  );
}
