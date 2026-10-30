// 3次元グラフ（Canvas 2D による簡易3D描画）
// 対応：z=f(x,y) / z について2次までの陰関数（平面・球・楕円面・円錐など）
//       空間曲線 (x(t), y(t), z(t)) / 媒介変数曲面 (x(u,v), y(u,v), z(u,v)) / 点 (a, b, c)
//       a=2 などの文字はスライダー。1本指ドラッグで回転、ピンチ・ホイールで拡大縮小

import { parse, compile, splitRelation, freeVars } from './parser.js';
import { COLORS } from './graph.js';

export const FILE_VERSION = '0.6.0';
const RESERVED = new Set(['x', 'y', 'z', 't', 'u', 'v']);
const TAU = Math.PI * 2;
const paramsOf = (...asts) => {
  const s = new Set();
  for (const a of asts) for (const v of freeVars(a)) if (!RESERVED.has(v) && v !== 'θ') s.add(v);
  return s;
};
const constValue = (src) => {
  const a = parse(src);
  if (freeVars(a).size) throw new Error('範囲には数を入れてください');
  return compile(a)({});
};

export function analyze3(raw) {
  let src = String(raw || '').trim();
  if (!src) return { kind: 'empty', params: new Set() };
  // 範囲指定：t:0..2pi  u:0..pi  v:0..2pi
  const ranges = {};
  src = src.replace(/[\s;]+([tuv])\s*:\s*([^\s;]+?)\s*(?:\.\.|〜|~)\s*([^\s;]+)/g, (_, n, a, b) => {
    ranges[n] = [constValue(a), constValue(b)];
    return '';
  }).trim();

  const { parts, ops } = splitRelation(src);
  if (ops.length === 0) {
    const ast = parse(src);
    const fv = freeVars(ast);
    if (ast.t === 'tuple') {
      if (ast.items.length !== 3) throw new Error('空間の点・曲線は (x, y, z) の3成分で書きます');
      const [fx, fy, fz] = ast.items.map(compile);
      if (fv.has('u') || fv.has('v')) {
        return { kind: 'psurf', fx, fy, fz, ur: ranges.u || [0, TAU], vr: ranges.v || [0, TAU], params: paramsOf(ast) };
      }
      if (fv.has('t')) return { kind: 'curve', fx, fy, fz, tr: ranges.t || [0, TAU], params: paramsOf(ast) };
      return { kind: 'point', fx, fy, fz, params: paramsOf(ast) };
    }
    if (fv.has('z')) throw new Error('z を含む式には「=」が必要です');
    return { kind: 'surf', f: compile(ast), params: paramsOf(ast) };
  }
  if (ops.length > 1 || ops[0] !== '=') throw new Error('3Dでは「=」の式に対応しています（不等式は2Dで）');
  const [L, R] = parts;
  if (!L || !R) throw new Error('「=」の両側に式が必要です');
  const ra = parse(R);
  if (/^[a-zA-Z]$/.test(L) && !RESERVED.has(L) && freeVars(ra).size === 0) {
    return { kind: 'param', name: L, value: compile(ra)({}), params: new Set() };
  }
  if (L === 'z' && !freeVars(ra).has('z')) return { kind: 'surf', f: compile(ra), params: paramsOf(ra) };
  const la = parse(L);
  if (R === 'z' && !freeVars(la).has('z')) return { kind: 'surf', f: compile(la), params: paramsOf(la) };
  const fl = compile(la), fr = compile(ra);
  const g = (s) => fl(s) - fr(s);
  const all = new Set([...freeVars(la), ...freeVars(ra)]);
  if (!all.has('z')) throw new Error('z を含まない式（円柱など）は媒介変数曲面 (cos u, sin u, v) で書いてください');
  // z について2次以下かを数点で確認
  const s = { x: 0.37, y: -0.61 };
  for (const p of paramsOf(la, ra)) s[p] = 1.3;
  const at = (z) => g({ ...s, z });
  const g0 = at(0), g1 = at(1), gm = at(-1);
  const a = (g1 + gm) / 2 - g0, b = (g1 - gm) / 2;
  if ([2, -3, 0.5].some(z => Math.abs(at(z) - (a * z * z + b * z + g0)) > 1e-6 * (1 + Math.abs(at(z))))) {
    throw new Error('z について2次までの式（平面・球・楕円面など）に対応しています');
  }
  return { kind: 'implicit', g, params: paramsOf(la, ra) };
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Graph3D {
  constructor(host) {
    this.host = host;
    host.classList.add('graph-host');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.W = 0; this.H = 0;
    this.home = { yaw: -0.75, pitch: 0.45, R: 3 };
    Object.assign(this, this.home);
    this.items = [];
    this.params = {};
    this.lastDefs = {};
    this.geom = null;
    this.ptrs = new Map();
    this.sketchMode = false;
    this.bindPointers();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }
  destroy() { this.ro.disconnect(); }
  resize() {
    const r = this.host.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr; this.canvas.height = H * dpr;
    this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = W; this.H = H;
    this.draw();
  }

  setExpressions(list) {
    const defs = {};
    this.items = list.map((it, i) => {
      const color = it.color || COLORS[i % COLORS.length];
      try {
        const a = analyze3(it.src);
        if (a.kind === 'param') defs[a.name] = a.value;
        return { ...it, color, a, error: null };
      } catch (e) { return { ...it, color, a: null, error: e.message }; }
    });
    for (const [k, v] of Object.entries(defs)) if (!(k in this.params) || this.lastDefs[k] !== v) this.params[k] = v;
    this.lastDefs = defs;
    for (const k of this.paramNames()) if (!(k in this.params)) this.params[k] = 1;
    this.geom = null;
    this.draw();
    return this.items;
  }
  paramNames() {
    const s = new Set();
    for (const it of this.items) {
      if (!it.a) continue;
      if (it.a.kind === 'param') s.add(it.a.name);
      for (const p of it.a.params) s.add(p);
    }
    return [...s].sort();
  }
  setParam(n, v) { this.params[n] = v; this.geom = null; this.requestDraw(); }
  resetView() { Object.assign(this, this.home); this.geom = null; this.draw(); }
  zoomBy(f) { this.R = Math.min(200, Math.max(0.2, this.R / f)); this.geom = null; this.requestDraw(); }
  setView() {}
  setSketchMode() {}
  setRevealed() {}
  clearSketch() {}

  bindPointers() {
    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, pos(e));
      if (this.ptrs.size === 2) this.pinch = this.pinchD();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      const prev = this.ptrs.get(e.pointerId), p = pos(e);
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 1) {
        this.yaw -= (p.x - prev.x) * 0.01;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (p.y - prev.y) * 0.01));
        this.requestDraw();
      } else if (this.ptrs.size === 2 && this.pinch) {
        const d = this.pinchD();
        this.zoomBy(d / this.pinch);
        this.pinch = d;
      }
    });
    const end = (e) => { this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }
  pinchD() { const [a, b] = [...this.ptrs.values()]; return Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)); }
  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(); });
  }

  // ---------- 形状の計算（範囲・パラメータが変わったときだけ） ----------
  build() {
    const R = this.R, N = 56;
    const prims = []; // {type:'quad'|'seg'|'pt', P:[[x,y,z]...], color}
    const s0 = { ...this.params };
        // z の範囲 [-R, R] で多角形を切り取る（はみ出た部分をギザギザにせず平らに切る）
    const clipZ = (poly) => {
      for (const [sgn] of [[1], [-1]]) {
        const out = [];
        for (let i = 0; i < poly.length; i++) {
          const A = poly[i], B = poly[(i + 1) % poly.length];
          const ia = sgn * A[2] <= R, ib = sgn * B[2] <= R;
          if (ia) out.push(A);
          if (ia !== ib) {
            const t = (sgn * R - A[2]) / (B[2] - A[2]);
            out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, sgn * R]);
          }
        }
        poly = out;
        if (poly.length < 3) return null;
      }
      return poly;
    };
    const pushPoly = (poly, color) => { const c = clipZ(poly); if (c) prims.push({ type: 'quad', P: c, color }); };
    // 高さ関数 fn(x,y)（定義されない所は NaN）を格子で面にする。定義域の境界は二分法で滑らかに
    const grid = (fn, color) => {
      const h = new Float64Array((N + 1) * (N + 1));
      const X = (i) => -R + 2 * R * i / N;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) h[j * (N + 1) + i] = fn(X(i), X(j));
      const edgePt = (p, q) => { // p は定義される点、q はされない点
        let a = p, b = q, z = p[2];
        for (let k = 0; k < 14; k++) {
          const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const v = fn(m[0], m[1]);
          if (Number.isFinite(v)) { a = [m[0], m[1], v]; z = v; } else b = m;
        }
        return [a[0], a[1], z];
      };
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * (N + 1) + i;
        const V = [[X(i), X(j), h[k]], [X(i + 1), X(j), h[k + 1]], [X(i + 1), X(j + 1), h[k + N + 2]], [X(i), X(j + 1), h[k + N + 1]]];
        const ok = V.map(v => Number.isFinite(v[2]));
        if (ok.every(Boolean)) { pushPoly(V, color); continue; }
        if (!ok.some(Boolean)) continue;
        const poly = [];
        for (let e = 0; e < 4; e++) {
          const A = V[e], B = V[(e + 1) % 4];
          if (ok[e]) poly.push(A);
          if (ok[e] !== ok[(e + 1) % 4]) poly.push(ok[e] ? edgePt(A, B) : edgePt(B, A));
        }
        if (poly.length >= 3) pushPoly(poly, color);
      }
    };
    for (const it of this.items) {
      if (it.hidden || !it.a) continue;
      const a = it.a, s = { ...s0 };
      try {
        if (a.kind === 'surf') {
          grid((x, y) => { s.x = x; s.y = y; return a.f(s); }, it.color);
        } else if (a.kind === 'implicit') {
          const root = (x, y, sign) => {
            s.x = x; s.y = y;
            s.z = 0; const g0 = a.g(s); s.z = 1; const g1 = a.g(s); s.z = -1; const gm = a.g(s);
            const A = (g1 + gm) / 2 - g0, B = (g1 - gm) / 2, C = g0;
            if (Math.abs(A) < 1e-12) return sign > 0 ? -C / B : NaN;
            const D = B * B - 4 * A * C;
            if (D < 0) return NaN;
            return (-B + sign * Math.sqrt(D)) / (2 * A);
          };
          grid((x, y) => root(x, y, 1), it.color);
          grid((x, y) => root(x, y, -1), it.color);
        } else if (a.kind === 'psurf') {
          const M = 48, [u0, u1] = a.ur, [v0, v1] = a.vr;
          const pts = [];
          for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
            s.u = u0 + (u1 - u0) * i / M; s.v = v0 + (v1 - v0) * j / M;
            pts.push([a.fx(s), a.fy(s), a.fz(s)]);
          }
          for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
            const k = j * (M + 1) + i;
            const P = [pts[k], pts[k + 1], pts[k + M + 2], pts[k + M + 1]];
            if (P.every(q => q.every(Number.isFinite)) && P.some(q => Math.abs(q[0]) <= R && Math.abs(q[1]) <= R)) pushPoly(P, it.color);
          }
        } else if (a.kind === 'curve') {
          const K = 800, [t0, t1] = a.tr;
          let prev = null;
          for (let k = 0; k <= K; k++) {
            s.t = t0 + (t1 - t0) * k / K;
            const q = [a.fx(s), a.fy(s), a.fz(s)];
            const ok = q.every(Number.isFinite) && q.every(c => Math.abs(c) <= R * 1.0001);
            if (ok && prev) prims.push({ type: 'seg', P: [prev, q], color: it.color });
            prev = ok ? q : null;
          }
        } else if (a.kind === 'point') {
          const q = [a.fx(s), a.fy(s), a.fz(s)];
          if (q.every(Number.isFinite)) prims.push({ type: 'pt', P: [q], color: it.color });
        }
      } catch (e) { /* 評価できない式は飛ばす */ }
    }
    this.geom = prims;
  }

  // 世界座標 → カメラ座標（右, 上, 奥）
  cam([x, y, z]) {
    const R = this.R, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const X = x / R, Y = y / R, Z = z / R;
    const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy;
    return [x1, Z * cp + y1 * sp, y1 * cp - Z * sp];
  }
  scr([r, u, d]) {
    const S = Math.min(this.W, this.H) * 0.3, f = 1 / (1 + 0.16 * d);
    return [this.W / 2 + r * S * f, this.H / 2 - u * S * f];
  }

  css(name, fb) { return getComputedStyle(this.host).getPropertyValue(name).trim() || fb; }

  draw() {
    const { ctx, W, H } = this;
    if (W < 2) return;
    if (!this.geom) this.build();
    const col = { bg: this.css('--g-bg', '#fff'), grid: this.css('--g-major', '#ddd'), axis: this.css('--g-axis', '#555'), label: this.css('--g-label', '#777') };
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
    const R = this.R;
    const line = (a, b, color, w = 1, dash = null) => {
      const p = this.scr(this.cam(a)), q = this.scr(this.cam(b));
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]);
    };
    // 床の格子と外枠
    const st = R / 3;
    for (let k = -3; k <= 3; k++) {
      line([-R, k * st, -R], [R, k * st, -R], col.grid);
      line([k * st, -R, -R], [k * st, R, -R], col.grid);
    }
    const c = [-R, R];
    for (const a of c) for (const b of c) {
      line([a, b, -R], [a, b, R], col.grid);
      line([a, -R, b], [a, R, b], col.grid);
      line([-R, a, b], [R, a, b], col.grid);
    }
    // 軸（原点を通る）
    line([-R, 0, 0], [R, 0, 0], col.axis, 1.2, [4, 4]);
    line([0, -R, 0], [0, R, 0], col.axis, 1.2, [4, 4]);
    line([0, 0, -R], [0, 0, R], col.axis, 1.2, [4, 4]);

    // 面・線を奥から順に描く（画家のアルゴリズム）
    const light = [0.35, 0.55, -0.76];
    const items = this.geom.map(p => {
      const C = p.P.map(q => this.cam(q));
      const depth = C.reduce((s, q) => s + q[2], 0) / C.length;
      return { p, C, depth };
    }).sort((a, b) => b.depth - a.depth);
    for (const { p, C } of items) {
      const S = C.map(q => this.scr(q));
      const rgb = hexToRgb(p.color);
      if (p.type === 'quad') {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < C.length; i++) {
          const a = C[i], b = C[(i + 1) % C.length];
          nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        const k = 0.42 + 0.58 * Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / nl);
        ctx.fillStyle = `rgba(${Math.round(rgb[0] * k + 255 * (1 - k) * 0.25)},${Math.round(rgb[1] * k + 255 * (1 - k) * 0.25)},${Math.round(rgb[2] * k + 255 * (1 - k) * 0.25)},0.9)`;
        ctx.beginPath(); ctx.moveTo(S[0][0], S[0][1]);
        for (let i = 1; i < S.length; i++) ctx.lineTo(S[i][0], S[i][1]);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`; ctx.lineWidth = 0.5; ctx.stroke();
      } else if (p.type === 'seg') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(S[0][0], S[0][1]); ctx.lineTo(S[1][0], S[1][1]); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(S[0][0], S[0][1], 5, 0, TAU); ctx.fill();
        const q = p.P[0];
        ctx.font = '12px -apple-system, "Hiragino Sans", system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`(${+q[0].toFixed(2)}, ${+q[1].toFixed(2)}, ${+q[2].toFixed(2)})`, S[0][0] + 8, S[0][1] - 8);
      }
    }
    // 軸ラベル
    ctx.fillStyle = col.axis; ctx.font = 'italic 600 14px "Times New Roman", serif'; ctx.textAlign = 'center';
    for (const [name, q] of [['x', [R * 1.12, 0, 0]], ['y', [0, R * 1.12, 0]], ['z', [0, 0, R * 1.12]]]) {
      const s = this.scr(this.cam(q)); ctx.fillText(name, s[0], s[1] + 5);
    }
    ctx.fillStyle = col.label; ctx.font = '11px -apple-system, "Hiragino Sans", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`表示範囲 ±${+R.toFixed(2)}`, 10, H - 10);
  }
}
