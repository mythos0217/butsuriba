// 問題カタログ：問題管理表から書き出した data/*.json と、アプリ内蔵の自動判定問題をまとめて扱う
import { PROBLEMS as BUILTIN, cardById, unitOf as builtinUnit } from './content.js';
import { retrievability, dueAt, TARGET_R } from './scheduler.js';

export const FILE_VERSION = '0.6.0';

// 難易度（問題管理表と同じ6段階。0=基礎 は v0.6 で追加）
export const LEVELS = { 0: '基礎', 1: '標準', 2: '演習', 3: '院試', 4: '難関院試', 5: '最難関' };
// 学部での標準的な履修順（tools/physics_fields.py と同じ順）
export const SUBJECT_ORDER = ['物理数学', '力学', '振動・波動', '解析力学', '電磁気学', '特殊相対論', '熱力学', '統計力学',
  '量子力学', '実験学', '固体物理学', '原子核物理学', '相対論的量子力学', '素粒子物理学', '一般相対論', '宇宙物理学', '融合'];

// 内蔵問題の単元 → 問題管理表の分野
const BUILTIN_FIELD = {
  'i-quad': ['数I', '2次関数'], 'i-geo': ['数I', '図形と計量'], 'i-data': ['数I', 'データの分析'],
  'a-prob': ['数A', '場合の数と確率'], 'a-int': ['数A', '整数（数学と人間の活動）'], 'a-geo': ['数A', '図形の性質'],
  'ii-eq': ['数II', 'いろいろな式'], 'ii-coord': ['数II', '図形と方程式'], 'ii-trig': ['数II', '三角関数'],
  'ii-exp': ['数II', '指数関数・対数関数'], 'ii-calc': ['数II', '微分法・積分法'],
  'b-seq': ['数B', '数列'], 'b-stat': ['数B', '統計的な推測'],
  'iii-lim': ['数III', '極限'], 'iii-diff': ['数III', '微分法'], 'iii-int': ['数III', '積分法'],
  'c-vec': ['数C', 'ベクトル'], 'c-cplx': ['数C', '平面上の曲線と複素数平面'], 'c-conic': ['数C', '平面上の曲線と複素数平面'],
};
const BUILTIN_LEVEL = { 2: 1, 3: 3, 4: 4 };

export let FIELDS = [];        // { key, subject, name }
export let ENTRIES = [];       // { id, f, lv, t?, th?, tg?, kind: 'bank' | 'builtin' }
export const fieldByKey = {};
export const entryById = new Map();
export let META = { count: 0, generated: null, source: null, ok: false, error: null };

export async function loadCatalog() {
  let meta = null;
  try {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/index.json を読めません（${res.status}）`);
    meta = await res.json();
    META = { count: meta.count, generated: meta.generated, source: meta.source, ok: true, error: null };
  } catch (e) {
    META = { count: 0, generated: null, source: null, ok: false, error: e.message };
  }
  FIELDS = meta ? meta.fields.slice() : [];
  const keyOf = (subject, name) => {
    let f = FIELDS.find(x => x.subject === subject && x.name === name);
    if (!f) { f = { key: `b-${FIELDS.length}`, subject, name }; FIELDS.push(f); }
    return f.key;
  };
  ENTRIES = meta ? meta.problems.map(e => ({ ...e, kind: 'bank' })) : [];
  // 受験数学版の内蔵問題（content.js）は物理版では使わない
  for (const p of []) {
    const [s, n] = BUILTIN_FIELD[builtinUnit(p)];
    ENTRIES.push({ id: p.id, f: keyOf(s, n), lv: BUILTIN_LEVEL[p.level] || 3, kind: 'builtin', th: cardById[p.cards[0]].name });
  }
  FIELDS.sort((a, b) => SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject));
  for (const f of FIELDS) fieldByKey[f.key] = f;
  entryById.clear();
  for (const e of ENTRIES) entryById.set(e.id, e);
  return META;
}

// 本文（分野ごとのファイル）を必要な分だけ読み込む
const bodies = new Map();
const loaded = new Map();
export async function ensureBodies(ids) {
  const need = new Set();
  for (const id of ids) {
    const e = entryById.get(id);
    if (e && e.kind === 'bank' && !bodies.has(id)) need.add(e.f);
  }
  await Promise.all([...need].map(f => {
    if (!loaded.has(f)) {
      loaded.set(f, fetch(`data/f-${f}.json`).then(r => {
        if (!r.ok) throw new Error(`data/f-${f}.json を読めません（${r.status}）`);
        return r.json();
      }).then(d => { for (const [id, b] of Object.entries(d)) bodies.set(id, b); })
        .catch(e => { loaded.delete(f); throw e; }));
    }
    return loaded.get(f);
  }));
}
export const getBody = (id) => bodies.get(id);

export const subjectsWithFields = () =>
  SUBJECT_ORDER.map(s => ({ name: s, fields: FIELDS.filter(f => f.subject === s) })).filter(x => x.fields.length);

export function pool({ fields = null, levels = null } = {}) {
  const fs = fields && new Set(fields), ls = levels && new Set(levels);
  return ENTRIES.filter(e => (!fs || fs.has(e.f)) && (!ls || ls.has(e.lv)));
}

// 単元が連続しないように並べる（交互練習）
function interleave(list) {
  const out = [], rest = list.slice();
  while (rest.length) {
    const prev = out.length ? out[out.length - 1].f : null;
    let i = rest.findIndex(e => e.f !== prev);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

// 演習：まだ解いていない問題を無作為に、次に久しぶりの問題を優先
export function pickPractice(state, { fields = null, levels = null, size = 8 } = {}) {
  const cand = pool({ fields, levels }).map(e => {
    const rec = state.problems[e.id];
    return { e, key: rec ? rec.last : -1e15 + Math.random() * 1e14 };
  }).sort((a, b) => a.key - b.key).slice(0, size).map(x => x.e);
  // 分野の偏りを避けるため、選んだ問題をシャッフルしてから交互に並べる
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  return interleave(cand).map(e => ({ kind: 'problem', pid: e.id }));
}

// 復習：問題ごとの記憶の見込みが下がったもの
export function dueEntries(state, { fields = null } = {}, now = Date.now()) {
  const fs = fields && new Set(fields);
  return ENTRIES.filter(e => state.pstat[e.id] && (!fs || fs.has(e.f)))
    .map(e => ({ e, R: retrievability(state.pstat[e.id], now) }))
    .filter(x => x.R < TARGET_R).sort((a, b) => a.R - b.R).map(x => x.e);
}
export function pickReview(state, { fields = null, size = 8 } = {}) {
  return interleave(dueEntries(state, { fields }).slice(0, size)).map(e => ({ kind: 'problem', pid: e.id }));
}
export function nextReviewTime(state) {
  const ts = Object.values(state.pstat || {}).map(dueAt);
  return ts.length ? Math.min(...ts) : null;
}
