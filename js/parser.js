// 数式パーサ：文字列 → 構文木（AST）→ JS関数 / TeX
// 対応：+ - * / ^、暗黙の積（2x, x(x+1), xe^x）、sin x のような括弧なし引数、
//       sin^2 x、|x|、√、π、θ、{ } を括弧として扱う

export const FILE_VERSION = '0.6.0';
const FUNC_NAMES = ['arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch', 'arsinh', 'arcosh', 'artanh',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'exp', 'log', 'ln', 'sqrt', 'abs', 'floor', 'ceil', 'sign'];
const CONST_NAMES = ['pi', 'e'];
// 物理用：ギリシャ文字の名前（omega → ω）と ħ（hbar）を1つの文字として扱う
export const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', hbar: 'ħ' };
const GREEK_TEX = Object.fromEntries(Object.entries(GREEK).map(([k, v]) => [v, k === 'hbar' ? '\\hbar' : '\\' + k]));
const NAMES = [...FUNC_NAMES, ...CONST_NAMES, ...Object.keys(GREEK)].sort((a, b) => b.length - a.length);

function rpow(a, b) {
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  // 負の底の分数乗：分母が奇数なら実数値を返す（x^(1/3) など）
  for (let q = 3; q <= 15; q += 2) {
    const p = Math.round(b * q);
    if (Math.abs(p / q - b) < 1e-9) {
      const r = Math.pow(-a, b);
      return (p % 2 !== 0) ? -r : r;
    }
  }
  return NaN;
}

export const FN = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  cot: (x) => 1 / Math.tan(x), sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  coth: (x) => 1 / Math.tanh(x), sech: (x) => 1 / Math.cosh(x), csch: (x) => 1 / Math.sinh(x),
  arsinh: Math.asinh, arcosh: Math.acosh, artanh: Math.atanh,
  exp: Math.exp, log: Math.log, ln: Math.log, sqrt: Math.sqrt, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, sign: Math.sign, pow: rpow,
};

// 添字：m_1、ω_0、k_B、m_{e} を1つの文字として扱う（直前の文字に付ける）
function subscript(s, i, out) {
  // x'、x'' のようなダッシュ付きの変数（直前の文字に付ける）
  if (s[i] === "'" || s[i] === '′') {
    const last = out[out.length - 1];
    if (last && last.k === 'var') { while (s[i] === "'" || s[i] === '′') { last.v += "'"; i++; } }
    return subscript(s, i, out);
  }
  if (s[i] !== '_') return i;
  const last = out[out.length - 1];
  if (!last || last.k !== 'var') return i;
  let m = s.slice(i + 1).match(/^\{([A-Za-z0-9θα-ωΓΔΘΛΣΦΨΩ]+)\}/) || s.slice(i + 1).match(/^([A-Za-z0-9]+|[θα-ωΓΔΘΛΣΦΨΩ]|[+\-⊥∥](?![0-9A-Za-z(]))/);
  if (m && GREEK[m[1]]) m = [m[0], GREEK[m[1]]];   // p_theta → p_θ
  if (!m) return i;
  last.v += '_' + m[1];
  const j = i + 1 + m[0].length;
  return (s[j] === "'" || s[j] === '′') ? subscript(s, j, out) : j;
}

function tokenize(src) {
  const s = src
    .replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')
    .replace(/≤/g, '<=').replace(/≥/g, '>=');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // 指数表記 1.6e-19、6.02E23
      const em = s.slice(j).match(/^[eE][+-]?\d+/);
      if (em) j += em[0].length;
      const v = parseFloat(s.slice(i, j));
      if (Number.isNaN(v)) throw new Error('数の書き方が正しくありません');
      out.push({ k: 'num', v });
      i = j; continue;
    }
    if (c === 'π') { out.push({ k: 'const', v: 'pi' }); i++; continue; }
    if (/[θαβγδεζηικλμνξρστφχψωΓΔΘΛΣΦΨΩħ]/.test(c)) { out.push({ k: 'var', v: c }); i++; i = subscript(s, i, out); continue; }
    if (c === '√') { out.push({ k: 'func', v: 'sqrt' }); i++; continue; }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      let run = s.slice(i, j);
      while (run.length) {
        const name = NAMES.find(n => run.startsWith(n));
        if (name) {
          if (GREEK[name]) out.push({ k: 'var', v: GREEK[name] });
          else if (CONST_NAMES.includes(name)) out.push({ k: 'const', v: name });
          else out.push({ k: 'func', v: name });
          run = run.slice(name.length);
        } else {
          out.push({ k: 'var', v: run[0] });
          run = run.slice(1);
        }
      }
      // m1、v0 のように文字の直後に数字が続くときも添字とみなす（物理の書き方）
      if (/[0-9]/.test(s[j] || '') && out[out.length - 1].k === 'var' && !/[.]/.test(s[j + 1] || '')) {
        let q = j; while (q < s.length && /[0-9]/.test(s[q])) q++;
        out[out.length - 1].v += '_' + s.slice(j, q); j = q;
      }
      i = subscript(s, j, out); continue;
    }
    if ('([{'.includes(c)) { out.push({ k: '(' }); i++; continue; }
    if (')]}'.includes(c)) { out.push({ k: ')' }); i++; continue; }
    if ('+-*/^,|'.includes(c)) { out.push({ k: c }); i++; continue; }
    throw new Error(`使えない文字「${c}」があります`);
  }
  return out;
}

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek() { return this.t[this.i]; }
  next() { return this.t[this.i++]; }
  is(k) { const p = this.peek(); return p && p.k === k; }
  expect(k) {
    if (!this.is(k)) throw new Error(k === ')' ? '括弧が閉じていません' : `「${k}」が必要です`);
    return this.next();
  }
  parseTop() {
    if (!this.t.length) throw new Error('式が空です');
    const first = this.parseExpr();
    if (this.is(',')) {
      const items = [first];
      while (this.is(',')) { this.next(); items.push(this.parseExpr()); }
      if (this.i < this.t.length) throw new Error('式の形が正しくありません');
      return { t: 'tuple', items };
    }
    if (this.i < this.t.length) throw new Error('式の形が正しくありません');
    return first;
  }
  parseExpr() {
    let a = this.parseTerm();
    while (this.is('+') || this.is('-')) {
      const op = this.next().k;
      a = { t: 'bin', op, a, b: this.parseTerm() };
    }
    return a;
  }
  startsFactor() {
    const p = this.peek();
    // |x| の外側では「|」も掛け算の続き（2F|sin t|、-k|x|）。内側では閉じ記号とみなす
    return p && (p.k === 'num' || p.k === 'var' || p.k === 'const' || p.k === 'func' || p.k === '(' || (p.k === '|' && !this.absDepth));
  }
  parseTerm() {
    let a = this.parseUnary();
    for (;;) {
      if (this.is('*') || this.is('/')) {
        const op = this.next().k;
        a = { t: 'bin', op, a, b: this.parseUnary() };
      } else if (this.startsFactor()) {
        a = { t: 'bin', op: '*', a, b: this.parsePower(), implicit: true };
      } else break;
    }
    return a;
  }
  parseUnary() {
    if (this.is('-')) { this.next(); return { t: 'neg', a: this.parseUnary() }; }
    if (this.is('+')) { this.next(); return this.parseUnary(); }
    return this.parsePower();
  }
  parsePower() {
    const base = this.parsePrimary();
    if (this.is('^')) { this.next(); return { t: 'bin', op: '^', a: base, b: this.parseUnary() }; }
    return base;
  }
  parsePrimary() {
    const tok = this.next();
    if (!tok) throw new Error('式が途中で終わっています');
    if (tok.k === 'num') return { t: 'num', v: tok.v };
    if (tok.k === 'const') return { t: 'const', n: tok.v };
    if (tok.k === 'var') return { t: 'var', n: tok.v };
    if (tok.k === '(') {
      const e = this.parseExpr();
      if (this.is(',')) { // 括弧内の組 (a, b)：点・媒介変数表示
        const items = [e];
        while (this.is(',')) { this.next(); items.push(this.parseExpr()); }
        this.expect(')');
        return { t: 'tuple', items };
      }
      this.expect(')');
      return e;
    }
    if (tok.k === '|') {
      this.absDepth = (this.absDepth || 0) + 1;
      const e = this.parseExpr();
      this.absDepth--;
      this.expect('|');
      return { t: 'call', f: 'abs', a: e };
    }
    if (tok.k === 'func') {
      let exponent = null;
      if (this.is('^')) { this.next(); exponent = this.parseUnary(); } // sin^2 x
      let arg;
      if (this.is('(')) {
        this.next(); arg = this.parseExpr(); this.expect(')');
      } else {
        // 括弧なし引数：sin 2x → sin(2x)。次の関数の前で止まる
        arg = this.parsePower();
        while (this.peek() && ['num', 'var', 'const'].includes(this.peek().k)) {
          arg = { t: 'bin', op: '*', a: arg, b: this.parsePower(), implicit: true };
        }
      }
      const call = { t: 'call', f: tok.v, a: arg };
      return exponent ? { t: 'bin', op: '^', a: call, b: exponent } : call;
    }
    throw new Error('式の形が正しくありません');
  }
}

export function parse(src) {
  return new Parser(tokenize(String(src))).parseTop();
}

// 関係式の分割：「y = …」「x^2+y^2 <= 1」「x^2 <= y <= x+2」
export function splitRelation(src) {
  const s = String(src).replace(/≤/g, '<=').replace(/≥/g, '>=');
  const parts = [], ops = [];
  let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && (c === '<' || c === '>' || c === '=')) {
      let op = c;
      if ((c === '<' || c === '>') && s[i + 1] === '=') op += '=';
      parts.push(s.slice(last, i));
      ops.push(op);
      i += op.length - 1;
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return { parts: parts.map(p => p.trim()), ops };
}

export function freeVars(ast, set = new Set()) {
  if (!ast) return set;
  switch (ast.t) {
    case 'var': set.add(ast.n); break;
    case 'bin': freeVars(ast.a, set); freeVars(ast.b, set); break;
    case 'neg': case 'call': freeVars(ast.a, set); break;
    case 'tuple': ast.items.forEach(x => freeVars(x, set)); break;
  }
  return set;
}

function code(ast) {
  switch (ast.t) {
    case 'num': return `(${ast.v})`;
    case 'const': return ast.n === 'pi' ? 'Math.PI' : 'Math.E';
    case 'var': return `s[${JSON.stringify(ast.n)}]`;
    case 'neg': return `(-${code(ast.a)})`;
    case 'call': return `F.${ast.f}(${code(ast.a)})`;
    case 'bin':
      if (ast.op === '^') return `F.pow(${code(ast.a)},${code(ast.b)})`;
      return `(${code(ast.a)}${ast.op}${code(ast.b)})`;
    case 'tuple': return `[${ast.items.map(code).join(',')}]`;
  }
  throw new Error('式を評価できません');
}

// AST → (scope) => number
export function compile(ast) {
  const fn = new Function('F', 's', `return ${code(ast)};`);
  return (scope) => fn(FN, scope);
}

// ---------- TeX 表示 ----------
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };
function prec(ast) {
  if (ast.t === 'bin') return ast.op === '/' ? 5 : PREC[ast.op]; // 分数は自前で括る
  if (ast.t === 'neg') return PREC.neg;
  return 9;
}
const TEX_FN = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc', log: '\\log', ln: '\\log', exp: '\\exp',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth', sech: '\\operatorname{sech}', csch: '\\operatorname{csch}',
  arsinh: '\\operatorname{arsinh}', arcosh: '\\operatorname{arcosh}', artanh: '\\operatorname{artanh}',
};
function wrap(s, cond) { return cond ? `\\left(${s}\\right)` : s; }

function numTeX(v) {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) {
    const [m, e] = v.toExponential().split('e');
    return `${+(+m).toPrecision(12)}\\times 10^{${+e}}`;
  }
  return String(v);
}
function varTeX(n) {
  const pm = n.match(/^(.*?)('+)$/);
  if (pm) return varTeX(pm[1]) + pm[2];
  const [b, sub] = n.split('_');
  const base = GREEK_TEX[b] ? GREEK_TEX[b] + ' ' : b;
  const subT = GREEK_TEX[sub] || (sub && sub.length > 1 && /^[A-Za-z]+$/.test(sub) ? `\\mathrm{${sub}}` : sub);
  return sub ? `{${base.trim()}}_{${subT}}` : base;
}

export function toTeX(ast) {
  switch (ast.t) {
    case 'num': return numTeX(ast.v);
    case 'const': return ast.n === 'pi' ? '\\pi' : 'e';
    case 'var': return varTeX(ast.n);
    case 'neg': return `-${wrap(toTeX(ast.a), prec(ast.a) <= 2)}`;
    case 'tuple': return `\\left(${ast.items.map(toTeX).join(',\\ ')}\\right)`;
    case 'call': {
      if (ast.f === 'sqrt') return `\\sqrt{${toTeX(ast.a)}}`;
      if (ast.f === 'abs') return `\\left|${toTeX(ast.a)}\\right|`;
      if (ast.f === 'exp') return `e^{${toTeX(ast.a)}}`;
      const name = TEX_FN[ast.f] || `\\operatorname{${ast.f}}`;
      return `${name}\\left(${toTeX(ast.a)}\\right)`;
    }
    case 'bin': {
      const { op, a, b } = ast;
      if (op === '/') return `\\frac{${toTeX(a)}}{${toTeX(b)}}`;
      if (op === '^') {
        const base = toTeX(a);
        const needs = a.t === 'bin' || a.t === 'neg' || (a.t === 'num' && a.v < 0) || a.t === 'call';
        if (a.t === 'call' && TEX_FN[a.f]) {
          return `${TEX_FN[a.f]}^{${toTeX(b)}}\\left(${toTeX(a.a)}\\right)`;
        }
        return `${needs ? `\\left(${base}\\right)` : `{${base}}`}^{${toTeX(b)}}`;
      }
      if (op === '*') {
        const la = wrap(toTeX(a), prec(a) < 2);
        const rb = wrap(toTeX(b), prec(b) < 2 || b.t === 'neg');
        const juxta = ast.implicit && !(b.t === 'num' || (b.t === 'bin' && b.op === '^' && b.a.t === 'num'));
        return juxta ? `${la}${rb}` : `${la}\\cdot ${rb}`;
      }
      const rb = wrap(toTeX(b), op === '-' && prec(b) <= 1 || b.t === 'neg');
      return `${toTeX(a)}${op}${rb}`;
    }
  }
  return '';
}

// AST → 入力書式の文字列（括弧を最小限に。例：7π/18、3·2^(n-1)）
export function toPlain(ast) {
  const atom = (a) => a.t === 'num' && a.v >= 0 || a.t === 'var' || a.t === 'const' || a.t === 'call';
  const P = (a) => toPlain(a);
  const wrap = (s, c) => c ? `(${s})` : s;
  const isAdd = (a) => a.t === 'bin' && (a.op === '+' || a.op === '-');
  switch (ast.t) {
    case 'num': return String(+ast.v.toPrecision(15));
    case 'const': return ast.n === 'pi' ? 'π' : 'e';
    case 'var': return ast.n;
    case 'neg': return '-' + wrap(P(ast.a), isAdd(ast.a));
    case 'tuple': return `(${ast.items.map(P).join(', ')})`;
    case 'call':
      if (ast.f === 'abs') return `|${P(ast.a)}|`;
      return `${ast.f === 'ln' ? 'log' : ast.f}(${P(ast.a)})`;
    case 'bin': {
      const { op, a, b } = ast;
      if (op === '+' || op === '-') {
        let r = P(b);
        if (b.t === 'neg') return `${P(a)}${op === '+' ? '-' : '+'}${wrap(P(b.a), op === '+' && isAdd(b.a))}`;
        return `${P(a)}${op}${wrap(r, op === '-' && isAdd(b))}`;
      }
      if (op === '*') {
        const l = wrap(P(a), isAdd(a) || (a.t === 'bin' && a.op === '/'));
        const r = wrap(P(b), isAdd(b) || b.t === 'neg');
        // 数×数・数のあとの数 は * を残す。それ以外は並べて書く
        if (/[0-9.]$/.test(l) && /^[0-9.]/.test(r)) return `${l}*${r}`;
        if (/[a-zA-Zα-ωπ)]$/.test(l) && /^[0-9]/.test(r)) return `${l}*${r}`;   // n2^n ではなく n*2^n
        if (/^(sin|cos|tan|log|exp|sqrt|arc|abs|floor|ceil|sign|asin|acos|atan|ln)/.test(r) && /[a-zA-Zα-ωπ0-9)]$/.test(l) && !/^[0-9.]+$/.test(l)) return `${l} ${r}`;   // a sin(x)、sqrt(3)^n cos(…)
        // 並べて書いても同じ字句になるときだけ * を省く（p と i で π になる、などを防ぐ）
        try {
          const same = JSON.stringify(tokenize(l + r)) === JSON.stringify([...tokenize(l), ...tokenize(r)]);
          return same ? `${l}${r}` : `${l}*${r}`;
        } catch { return `${l}*${r}`; }
      }
      if (op === '/') {
        if (a.t === 'neg') return `-${toPlain({ t: 'bin', op: '/', a: a.a, b })}`;
        const l = wrap(P(a), isAdd(a));
        const r = wrap(P(b), !atom(b) && !(b.t === 'bin' && b.op === '^'));
        return `${l}/${r}`;
      }
      if (op === '^') {
        const base = wrap(P(a), !atom(a));
        const ex = P(b);
        return `${base}^${/^[0-9a-zA-Zπα-ω]+$/.test(ex) && (b.t === 'num' || b.t === 'var' || b.t === 'const') ? ex : `(${ex})`}`;
      }
    }
  }
  return '';
}

export function relationToTeX(src) {
  const { parts, ops } = splitRelation(src);
  const texOp = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge' };
  return parts.map(p => toTeX(parse(p))).reduce((acc, p, i) => i === 0 ? p : `${acc} ${texOp[ops[i - 1]]} ${p}`, '');
}

// ---------- 答えの同値判定 ----------
// 乱数で数点に代入して値が一致するか調べる（CASなしで「同じ式か」を判定）
function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

function stripLhs(src) {
  const { parts, ops } = splitRelation(src);
  if (ops.length === 1 && ops[0] === '=' && /^[a-zA-Z]$/.test(parts[0])) return parts[1];
  return src;
}

export function equivalent(userSrc, expectSrc, vars = {}) {
  let fu, fe;
  try { fu = compile(parse(stripLhs(userSrc))); } catch (e) { return { ok: false, error: e.message }; }
  fe = compile(parse(expectSrc));
  const names = Object.keys(vars);
  const extra = [...freeVars(parse(stripLhs(userSrc)))].filter(v => !names.includes(v));
  if (extra.length) return { ok: false, error: `この問題では使わない文字「${extra.join(', ')}」が入っています` };
  const rand = seeded(12345);
  let valid = 0;
  for (let k = 0; k < 40 && valid < 8; k++) {
    const s = {};
    for (const n of names) {
      const [lo, hi, kind] = vars[n];
      s[n] = kind === 'int' ? lo + Math.floor(rand() * (hi - lo + 1)) : lo + (hi - lo) * rand();
    }
    const a = fe(s), b = fu(s);
    if (!Number.isFinite(a)) continue;
    if (!Number.isFinite(b)) return { ok: false };
    valid++;
    if (Math.abs(a - b) > 1e-7 * Math.max(1, Math.abs(a))) return { ok: false };
  }
  return { ok: valid > 0 };
}

export function sameNumberSet(userSrc, expectSrc) {
  try {
    const u = userSrc.split(/[,、，]/).map(s => s.trim()).filter(Boolean).map(s => compile(parse(s))({})).sort((a, b) => a - b);
    const e = expectSrc.split(',').map(s => compile(parse(s))({})).sort((a, b) => a - b);
    if (u.length !== e.length) return { ok: false, error: u.length < e.length ? 'まだ足りない値があります' : null };
    return { ok: u.every((v, i) => Math.abs(v - e[i]) < 1e-7 * Math.max(1, Math.abs(e[i]))) };
  } catch (err) { return { ok: false, error: err.message }; }
}
