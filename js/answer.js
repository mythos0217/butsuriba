// 「入力用の答え」の書式と採点
//
// 書式（問題管理表の「入力用の答え」列）：
//   1行に1小問。行頭に (1) などの番号。小問の中の複数の答えは「 ; 」で区切る。
//   答えの前に「ラベル：」（全角コロン）を付けると、入力欄の名前になる。数式は $...$ で書ける。
//     (1) 14/3
//     (2) 最大値：7/4 ; 最小値：-3-2sqrt(3)
//     (3) {1, 35, 251, 505}            … 順不同の組（すべて答える）
//     (4) (30/11, 48/11)                … 順序のある組（座標など）
//     (5) 9:4                           … 比
//     (6) a<-3 または 3<a               … 範囲（不等式。「かつ」「なし」「すべての実数」も可）
//     (7) 場合分け{ m<=1/2 → 6-2m | m>=1/2 → (14m+8)/3 }   … 区切りの | の前後は空白
//     (8) 証明                          … 証明・図示・記述は自己採点（記述：本文 と書くと答え合わせで表示）
//   数の後ろの単位（18個、120° など）は表示用で、採点では無視する。
//   物理用の追加：
//     (9) 周期 [s]：≈2.01                … 「≈」を付けた数値は相対誤差 2% まで正解（有効数字3桁程度の計算向け）
//     (10) ω：sqrt(g/l) ; E：hbar omega/2 … 添字 m_1・ω_0・k_B、ギリシャ文字（omega, ω）、ħ（hbar）が使える
//     (11) 3.2e-19 または 3.2×10^(-19)   … 指数表記
//   単位はラベルの [ ] に書く（入力欄に単位を付けて答えても、その単位は無視される）

import { parse, compile, freeVars, toTeX, toPlain } from './parser.js';

export const FILE_VERSION = '0.6.0';

const SELF_WORDS = /^(証明|図示|記述|略|解答参照)/;
const UNIT_RE = /(°|個|通り|桁|本|人|回|枚|組|点|色|日|番目|倍|秒|分|円|度|段|列|行|面|辺|頂点|種類)$/;
const INT_VARS = new Set(['n', 'N', 'k']);

// ---------------------------------------------------------------- 書式の読み取り
function splitTop(s, seps) {
  // 括弧の外にある区切り（文字列の配列）で分割
  const out = []; let depth = 0, last = 0, inMath = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '$') inMath = !inMath;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && !inMath) {
      const sep = seps.find(x => s.startsWith(x, i));
      if (sep) { out.push(s.slice(last, i)); i += sep.length - 1; last = i + 1; }
    }
  }
  out.push(s.slice(last));
  return out.map(x => x.trim()).filter(x => x !== '');
}

export function parseSpec(text) {
  if (!text || !String(text).trim()) return null;
  const lines = String(text).replace(/\r/g, '').split(/\n|｜/).map(l => l.trim()).filter(Boolean);
  const parts = [];
  for (const line of lines) {
    const m = line.match(/^\((\d+)\)\s*/);
    const n = m ? m[1] : '';
    const body = m ? line.slice(m[0].length) : line;
    const fields = splitTop(body, [' ; ', '；', ';']).map(parseField);
    parts.push({ n, fields });
  }
  return { parts };
}

function parseField(src) {
  let label = null, body = src.trim();
  const lm = body.match(/^([^：]{1,80})：\s*/);
  if (lm && !/^場合分け/.test(body) && !SELF_WORDS.test(lm[1].trim())) { label = lm[1].trim(); body = body.slice(lm[0].length).trim(); }
  // ≈ で始まる数値：近似値として許容誤差を広げる（既定 2%、「≈2.01 (5%)」で指定も可）
  let tol = null;
  const am = body.match(/^(≈|~|約)\s*/);
  if (am) {
    body = body.slice(am[0].length).trim();
    const pm = body.match(/\s*\((\d+(?:\.\d+)?)%\)$/);
    tol = pm ? +pm[1] / 100 : 0.02;
    if (pm) body = body.slice(0, -pm[0].length).trim();
  }
  const f = { label, src: body, ...(tol ? { tol } : {}) };
  if (SELF_WORDS.test(body)) {
    const sm = body.match(/^(証明|図示|記述|略|解答参照)\s*[:：]?\s*(.*)$/);
    return { ...f, kind: 'self', sub: sm[1], text: sm[2] || '' };
  }
  const cm = body.match(/^場合分け\s*\{([\s\S]*)\}$/);
  if (cm) {
    const cases = splitTop(cm[1], [' | ']).map(c => {
      const k = c.search(/→|=>/);
      if (k < 0) throw new Error(`場合分けの「→」がありません：${c}`);
      const cond = c.slice(0, k).trim(), val = c.slice(k).replace(/^(→|=>)/, '').trim();
      return { cond: parseCond(cond), condSrc: cond, val: parseValue(val), valSrc: val };
    });
    return { ...f, kind: 'cases', cases };
  }
  if (/^\{[\s\S]*\}$/.test(body)) {
    const items = splitTop(body.slice(1, -1), [',']).map(parseValue);
    return { ...f, kind: 'set', items };
  }
  if (/^\d+(\.\d+)?(:\d+(\.\d+)?)+$/.test(body.replace(/\s/g, ''))) {
    return { ...f, kind: 'ratio', items: body.replace(/\s/g, '').split(':').map(Number) };
  }
  if (isCondition(body)) return { ...f, kind: 'range', cond: parseCond(body) };
  const v = parseValue(body);
  if (v.ast.t === 'tuple') return { ...f, kind: 'tuple', items: v.ast.items.map(a => ({ ast: a, fn: compile(a), unit: '' })) };
  return { ...f, kind: 'expr', value: v };
}

function stripUnit(s) {
  const m = s.match(UNIT_RE);
  if (m && /[\d)πe]\s*(°|[^\x00-\x7F]+)$/.test(s)) return { s: s.slice(0, -m[0].length).trim(), unit: m[0] };
  return { s, unit: '' };
}

function parseValue(src) {
  const { s, unit } = stripUnit(src.trim());
  const ast = parse(s);
  return { ast, fn: compile(ast), unit, src: s };
}

// ---------------------------------------------------------------- 条件（範囲）
const OR = ['または', ' or ', '∪', ',', '，', '、'];
const AND = ['かつ', ' and ', '&', '∩'];
function isCondition(s) {
  return /<|>|≦|≧|≤|≥|≠|!=|^なし$|^すべての実数$|^全ての実数$|^任意/.test(s);
}
function chain(src) {
  // a < b <= c を [{l, op, r}] に
  const s = src.replace(/≦|≤/g, '<=').replace(/≧|≥/g, '>=').replace(/!=/g, '≠');
  const parts = [], ops = [];
  let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && '<>=≠'.includes(c)) {
      let op = c;
      if ((c === '<' || c === '>') && s[i + 1] === '=') op += '=';
      parts.push(s.slice(last, i)); ops.push(op); i += op.length - 1; last = i + 1;
    }
  }
  parts.push(s.slice(last));
  if (!ops.length) throw new Error(`不等号がありません：${src}`);
  const fns = parts.map(p => { const a = parse(p.trim()); return { ast: a, fn: compile(a) }; });
  return ops.map((op, k) => ({ l: fns[k], op, r: fns[k + 1] }));
}
export function parseCond(src) {
  const s = src.trim();
  if (/^なし$/.test(s)) return { kind: 'none', vars: new Set(), atoms: [], test: () => false };
  if (/^(すべての実数|全ての実数|任意)/.test(s)) return { kind: 'all', vars: new Set(), atoms: [], test: () => true };
  const disj = splitTop(s, OR).map(d => splitTop(d, AND).map(chain));
  const atoms = disj.flat(2);
  const vars = new Set();
  for (const a of atoms) { freeVars(a.l.ast, vars); freeVars(a.r.ast, vars); }
  return { kind: 'cond', vars, atoms, disj, test: (sc) => disj.some(conj => conj.every(ch => ch.every(a => cmp(a.l.fn(sc), a.r.fn(sc), a.op)))) };
}
function cmp(l, r, op) {
  if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
  const d = l - r, eq = Math.abs(d) <= 1e-9 * (1 + Math.abs(l) + Math.abs(r));
  switch (op) {
    case '<': return d < 0 && !eq;
    case '<=': return d < 0 || eq;
    case '>': return d > 0 && !eq;
    case '>=': return d > 0 || eq;
    case '=': return eq;
    case '≠': return !eq;
  }
  return false;
}

// ---------------------------------------------------------------- 採点
function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
// 許容誤差：ふつうは厳密（1e-7）、≈ の答えのときは相対誤差（checkField の間だけ変える）
let TOL = null;
const close = (a, b) => TOL
  ? Math.abs(a - b) <= TOL * Math.max(Math.abs(a), Math.abs(b), 1e-300)
  : Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));

// 組（座標）も含めた比較
function sameAny(u, e) {
  if (e.ast.t === 'tuple') {
    if (u.ast.t !== 'tuple' || u.ast.items.length !== e.ast.items.length) return { ok: false };
    for (let i = 0; i < e.ast.items.length; i++) {
      const r = sameValue({ ast: u.ast.items[i], fn: compile(u.ast.items[i]) }, { ast: e.ast.items[i], fn: compile(e.ast.items[i]) });
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (u.ast.t === 'tuple') return { ok: false };
  return sameValue(u, e);
}

// 不定積分（積分定数 C を含む答え）：定数の差を許す
function sameAntiderivative(u, e) {
  const vars = [...new Set([...freeVars(e.ast), ...freeVars(u.ast)])].filter(v => v !== 'C');
  const r = rng(99);
  let diff = null, valid = 0;
  for (let k = 0; k < 60 && valid < 10; k++) {
    const s = { C: 0 };
    for (const v of vars) s[v] = INT_VARS.has(v) ? 1 + Math.floor(r() * 12) : -2 + r() * 4;
    const a = e.fn(s), b = u.fn(s);
    if (!Number.isFinite(a)) continue;
    if (!Number.isFinite(b)) return { ok: false };
    valid++;
    if (diff === null) diff = b - a;
    else if (!close(b - a, diff)) return { ok: false };
  }
  return valid >= 4 ? { ok: true } : { ok: false, error: '値を確かめられませんでした' };
}

// 式どうしの比較（自由変数に乱数を代入）
function sameValue(u, e) {
  // 積分定数として扱うのは、正解が「… + C」の形のときだけ（物理では C は容量・熱容量にも使う）
  const plusC = e.ast.t === 'bin' && e.ast.op === '+' && e.ast.b.t === 'var' && e.ast.b.n === 'C';
  if (plusC) return sameAntiderivative(u, e);
  const vars = [...new Set([...freeVars(e.ast), ...freeVars(u.ast)])];
  const extra = [...freeVars(u.ast)].filter(v => !freeVars(e.ast).has(v));
  if (extra.length) return { ok: false, error: `この答えでは使わない文字「${extra.join('，')}」が入っています` };
  if (!vars.length) {
    const a = e.fn({}), b = u.fn({});
    return { ok: Number.isFinite(a) && Number.isFinite(b) && close(a, b) };
  }
  for (const mode of ['real', 'pos', 'int']) {
    const r = rng(7 + mode.length);
    let valid = 0, bad = false, skip = false;
    for (let k = 0; k < 60 && valid < 10; k++) {
      const s = {};
      for (const v of vars) {
        s[v] = mode === 'int' || INT_VARS.has(v) ? 1 + Math.floor(r() * 12)
          : mode === 'pos' ? 0.1 + r() * 4 : -3 + r() * 6;
      }
      const a = e.fn(s), b = u.fn(s);
      if (!Number.isFinite(a)) continue;
      if (!Number.isFinite(b)) { skip = true; break; }   // 定義域の違い（√g/√l と √(g/l) など）は次の代入法で
      valid++;
      if (!close(a, b)) { bad = true; break; }
    }
    if (bad) return { ok: false };
    if (skip) continue;
    if (valid >= 4) return { ok: true };
  }
  return { ok: false, error: '値を確かめられませんでした' };
}

function cleanUser(text, label) {
  let t = String(text || '').trim().replace(/^(≈|~|約)\s*/, '').replace(/[，、]/g, ',').replace(/[　]/g, ' ').replace(/°/g, '');
  // 「a = 3」「y=…」の左辺を外す（ラベルと同じ、または1文字の変数のとき）
  const m = t.match(/^([A-Za-zθα-ω][A-Za-z0-9_]*|\([^)]*\))\s*=(?!=)\s*/);
  if (m && !/[<>]/.test(t)) t = t.slice(m[0].length);
  // ラベルに [単位] があれば、答えの末尾に付けた同じ単位を外す（例：「2.0 s」「3.2 eV」）
  const um = label && label.match(/\[([^\]]+)\]/);
  if (um) {
    const u = um[1].trim();
    if (t.endsWith(u) && t.length > u.length) t = t.slice(0, -u.length).trim();
  }
  return stripUnit(t).s;
}

function parseUserValue(text, label) {
  const t = cleanUser(text, label);
  if (!t) throw new Error('答えが空です');
  const ast = parse(t);
  return { ast, fn: compile(ast) };
}

function expandPM(s) {
  if (!s.includes('±')) return [s];
  return [s.replace('±', '+'), s.replace('±', '-')];
}

// 区分的な値（場合分け）どうしの比較：条件の変数に値を入れて、同じ点で同じ値かを調べる
function boundaryRoots(conds) {
  const roots = [];
  for (const c of conds) {
    if (!c || c.kind !== 'cond' || c.vars.size !== 1) continue;
    const v = [...c.vars][0];
    for (const a of c.atoms) {
      const f = (x) => { const s = { [v]: x }; return a.l.fn(s) - a.r.fn(s); };
      let px = -50, pf = f(px);
      for (let x = -50 + 0.05; x <= 50; x += 0.05) {
        const fx = f(x);
        if (Number.isFinite(pf) && Number.isFinite(fx) && (pf === 0 || pf * fx < 0)) {
          let lo = px, hi = x;
          for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
          roots.push((lo + hi) / 2);
        }
        px = x; pf = fx;
      }
    }
  }
  return roots;
}

function samplePoints(vars, conds, { avoidBoundary }) {
  const r = rng(12345);
  const pts = [];
  const vs = [...vars];
  const roots = vs.length === 1 ? boundaryRoots(conds) : [];
  for (let k = 0; k < 400; k++) {
    const s = {};
    for (const v of vs) s[v] = INT_VARS.has(v) ? 1 + Math.floor(r() * 30) : (k < 300 ? -12 + r() * 24 : -60 + r() * 120);
    pts.push(s);
  }
  if (vs.length === 1) {
    const v = vs[0];
    for (const b of roots) {
      if (avoidBoundary) { pts.push({ [v]: b + 1e-3 }, { [v]: b - 1e-3 }); }
      else pts.push({ [v]: b }, { [v]: b + 1e-6 }, { [v]: b - 1e-6 }, { [v]: b + 0.3 }, { [v]: b - 0.3 });
    }
    if (INT_VARS.has(v)) for (let n = 0; n <= 40; n++) pts.push({ [v]: n });
  }
  if (avoidBoundary && roots.length) {
    const v = vs[0];
    return pts.filter(p => roots.every(b => Math.abs(p[v] - b) > 1e-4));
  }
  return pts;
}

function checkRange(userText, cond) {
  let u;
  try { u = parseCond(String(userText).trim().replace(/[，、]/g, ',').replace(/°/g, '')); }
  catch (e) { return { ok: false, error: e.message, syntax: true }; }
  const extra = [...u.vars].filter(v => !cond.vars.has(v));
  if (extra.length && cond.vars.size) return { ok: false, error: `この答えでは使わない文字「${extra.join('，')}」が入っています` };
  const vars = new Set([...cond.vars, ...u.vars]);
  if (!vars.size) return { ok: u.kind === cond.kind };
  const pts = samplePoints(vars, [cond, u], { avoidBoundary: false });
  for (const p of pts) if (cond.test(p) !== u.test(p)) return { ok: false };
  return { ok: true };
}

function piecewise(cases) {
  return (s) => { for (const c of cases) if (c.cond.test(s)) return c.val.fn(s); return undefined; };
}
function checkCases(user, expected) {
  // user / expected: [{cond, val}]（場合分けしていない答えは cond=すべて の1つ）
  const conds = [...expected.map(c => c.cond), ...user.map(c => c.cond)];
  const vars = new Set();
  for (const c of conds) for (const v of c.vars) vars.add(v);
  for (const c of [...expected, ...user]) for (const v of freeVars(c.val.ast)) vars.add(v);
  const fe = piecewise(expected), fu = piecewise(user);
  const pts = samplePoints(vars, conds, { avoidBoundary: true });
  let compared = 0;
  for (const p of pts) {
    const a = fe(p);
    if (a === undefined || !Number.isFinite(a)) continue;
    const b = fu(p);
    if (b === undefined) return { ok: false, error: '場合分けの条件で、すべての場合をつくせていません' };
    compared++;
    if (!Number.isFinite(b) || !close(a, b)) return { ok: false };
  }
  return compared >= 5 ? { ok: true } : { ok: false, error: '値を確かめられませんでした' };
}

const ALL = { kind: 'all', vars: new Set(), atoms: [], test: () => true };

// input: { mode: 'plain', text } | { mode: 'cases', rows: [{ cond, val }] }
export function checkField(field, input) {
  TOL = field.tol || null;
  try { return checkField0(field, input); } finally { TOL = null; }
}
function checkField0(field, input) {
  try {
    if (field.kind === 'self') return { ok: null };
    if (input.mode === 'cases') {
      const rows = input.rows.filter(r => r.cond.trim() || r.val.trim());
      if (!rows.length) return { ok: false, error: '答えが空です', syntax: true };
      const user = rows.map(r => ({ cond: parseCond(String(r.cond).replace(/°/g, '')), val: parseUserValue(r.val, field.label) }));
      if (field.kind === 'cases') return checkCases(user, field.cases);
      if (field.kind === 'expr') return checkCases(user, [{ cond: ALL, val: field.value }]);
      return { ok: false, error: 'この答えは場合分けせずに書きます' };
    }
    const text = input.text || '';
    if (!text.trim()) return { ok: false, error: '答えが空です', syntax: true };
    switch (field.kind) {
      case 'expr': return sameValue(parseUserValue(text, field.label), field.value);
      case 'cases': return checkCases([{ cond: ALL, val: parseUserValue(text, field.label) }], field.cases);
      case 'range': return checkRange(cleanRange(text), field.cond);
      case 'set': {
        const items = splitTop(cleanUser(text, field.label).replace(/^\{|\}$/g, ''), [',']).flatMap(expandPM)
          .map(t => parseUserValue(t, field.label));
        if (items.length !== field.items.length) return { ok: false, error: items.length < field.items.length ? 'まだ足りない値があります' : null };
        const used = new Set();
        for (const e of field.items) {
          const k = items.findIndex((u, i) => !used.has(i) && sameAny(u, e).ok);
          if (k < 0) return { ok: false };
          used.add(k);
        }
        return { ok: true };
      }
      case 'tuple': {
        const v = parseUserValue(text, field.label);
        const items = v.ast.t === 'tuple' ? v.ast.items.map(a => ({ ast: a, fn: compile(a) })) : [v];
        if (items.length !== field.items.length) return { ok: false, error: `${field.items.length}つの値を (a, b) の形で答えます` };
        return { ok: field.items.every((e, i) => sameValue(items[i], e).ok) };
      }
      case 'ratio': {
        const u = cleanUser(text).replace(/\s/g, '').split(':').map(t => compile(parse(t))({}));
        if (u.length !== field.items.length || u.some(x => !Number.isFinite(x))) return { ok: false, error: `${field.items.length}つの数を a:b の形で答えます` };
        const e = field.items;
        return { ok: u.every((x, i) => close(x * e[0], u[0] * e[i])) };
      }
    }
  } catch (e) {
    return { ok: false, error: e.message, syntax: true };
  }
  return { ok: false };
}
function cleanRange(t) {
  return String(t).trim().replace(/^[A-Za-zα-ω]\s*は\s*/, '');
}

// ---------------------------------------------------------------- 表示
export function fieldHint(f) {
  switch (f.kind) {
    case 'set': return `${f.items.length}つの値をカンマで区切って（順不同）`;
    case 'tuple': return `(${f.items.map((_, i) => 'abcde'[i]).join(', ')}) の形で`;
    case 'ratio': return `${f.items.map((_, i) => 'abcde'[i]).join(':')} の形で`;
    case 'range': return '例：a<-3 または 3<a、-1<=x<2、なし';
    default: return '';
  }
}
export function fieldUnit(f) {
  return f.kind === 'expr' ? f.value.unit : f.kind === 'set' ? (f.items[0] && f.items[0].unit) || '' : '';
}
export function exprTeX(src) {
  try { return toTeX(parse(src)); } catch { return null; }
}
// 正解の TeX（判定後に表示）
export function fieldTeX(f) {
  const t = (s) => exprTeX(s) ?? s;
  switch (f.kind) {
    case 'expr': return (f.tol ? '\\approx ' : '') + t(f.value.src) + (f.value.unit ? `\\text{${f.value.unit}}` : '');
    case 'set': return f.items.map(i => t(i.src)).join(',\\ ');
    case 'tuple': return `\\left(${f.items.map(i => toTeX(i.ast)).join(',\\ ')}\\right)`;
    case 'ratio': return f.items.join(':');
    case 'range': return condTeX(f.src);
    case 'cases': return `\\begin{cases}${f.cases.map(c => `${t(c.valSrc)} & (${condTeX(c.condSrc)})`).join('\\\\')}\\end{cases}`;
  }
  return '';
}
export function condTeX(src) {
  if (/^(なし|すべての実数|全ての実数)$/.test(src.trim())) return `\\text{${src.trim()}}`;
  const ors = splitTop(src, OR).map(d => splitTop(d, AND).map(c => {
    const s = c.replace(/≦|≤/g, '<=').replace(/≧|≥/g, '>=').replace(/!=/g, '≠');
    return s.split(/(<=|>=|<|>|≠|=)/).map(p => ({ '<=': '\\leqq ', '>=': '\\geqq ', '<': '<', '>': '>', '≠': '\\neq ', '=': '=' }[p] ?? (exprTeX(p.trim()) ?? p))).join('');
  }).join('\\text{ かつ }'));
  return ors.join('\\text{ または }');
}

// ---------------------------------------------------------------- 書式に書き戻す（読みやすい形に整える）
const OPS_TEXT = { '<': '<', '<=': '<=', '>': '>', '>=': '>=', '=': '=', '≠': '≠' };
function chainText(ch) {
  return ch.map((a, k) => (k === 0 ? toPlain(a.l.ast) : '') + OPS_TEXT[a.op] + toPlain(a.r.ast)).join('');
}
export function condToText(c) {
  if (c.kind === 'none') return 'なし';
  if (c.kind === 'all') return 'すべての実数';
  return c.disj.map(conj => conj.map(chainText).join(' かつ ')).join(' または ');
}
function valText(v) { return toPlain(v.ast) + (v.unit || ''); }
export function fieldToText(f) {
  const lab = f.label ? `${f.label}：` : '';
  switch (f.kind) {
    case 'self': return lab + f.sub + (f.text ? `：${f.text}` : '');
    case 'expr': return lab + valText(f.value);
    case 'set': return lab + `{${f.items.map(valText).join(', ')}}`;
    case 'tuple': return lab + `(${f.items.map(i => toPlain(i.ast)).join(', ')})`;
    case 'ratio': return lab + f.items.join(':');
    case 'range': return lab + condToText(f.cond);
    case 'cases': return lab + `場合分け{ ${f.cases.map(c => `${condToText(c.cond)} → ${valText(c.val)}`).join(' | ')} }`;
  }
  return lab + f.src;
}
export function specToText(spec) {
  return spec.parts.map(p => (p.n ? `(${p.n}) ` : '') + p.fields.map(fieldToText).join(' ; ')).join('\n');
}
