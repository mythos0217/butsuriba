// 計算トレーニング：テンプレートから問題をその場で作り、入力した答えを自動採点する
import { parse, toTeX } from './parser.js';
import { parseSpec, checkField } from './answer.js';

export const FILE_VERSION = '0.6.0';

// ---------------------------------------------------------------- 乱数・分数
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nz = (a, b) => { let v; do v = ri(a, b); while (v === 0); return v; };
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
function frac(n, d) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
const fplain = (f) => f.d === 1 ? `${f.n}` : `${f.n}/${f.d}`;
const ftex = (f) => f.d === 1 ? `${f.n}` : `${f.n < 0 ? '-' : ''}\\dfrac{${Math.abs(f.n)}}{${f.d}}`;
const tex = (plain) => { try { return toTeX(parse(plain)); } catch { return plain; } };

// 係数つきの項（TeX）：c=1 は省略、-1 は - だけ
function term(c, body, first = false) {
  if (c === 0) return '';
  const sign = c < 0 ? '-' : first ? '' : '+';
  const a = Math.abs(c);
  return `${sign}${a === 1 && body ? '' : a}${body}`;
}
function poly(cs, v = 'x') { // 係数（高次から）→ TeX
  const n = cs.length - 1;
  let out = '', first = true;
  cs.forEach((c, i) => {
    const p = n - i;
    const body = p === 0 ? '' : p === 1 ? v : `${v}^{${p}}`;
    const t = term(c, body, first);
    if (t) { out += t; first = false; }
  });
  return out || '0';
}
const lin = (a, b, v = 'x') => poly([a, b], v); // ax+b
const pplain = (cs, v = 'x') => { const n = cs.length - 1; return cs.map((c, i) => `(${c})*${v}^${n - i}`).join('+'); };

// ---------------------------------------------------------------- 問題テンプレート
// 各関数は { q: 問題の TeX, ask: 問い方, ans: 採点用の答え（入力書式）, a: 答えの TeX, form?: 'factor'|'expand' }
const D = '\\dfrac{d}{dx}';
const GEN = {
  diff: [
    () => { const n = ri(1, 3), a = nz(-3, 3);
      return { q: `y=x^{${n}}e^{${a === 1 ? '' : a === -1 ? '-' : a}x}`.replace('x^{1}', 'x'), ask: '$y\'$ を求めよ',
        ans: `x^(${n - 1})*e^((${a})x)*(${n}+(${a})x)`, a: `${n === 1 ? '' : n === 2 ? 'x' : `x^{${n - 1}}`}e^{${a === 1 ? '' : a === -1 ? '-' : a}x}(${lin(a, n)})` }; },
    () => { const a = ri(1, 4), b = ri(1, 4);
      return { q: `y=\\sin ${a === 1 ? '' : a}x\\cos ${b === 1 ? '' : b}x`, ask: '$y\'$ を求めよ',
        ans: `(${a})cos((${a})x)cos((${b})x)-(${b})sin((${a})x)sin((${b})x)`,
        a: `${a === 1 ? '' : a}\\cos ${a === 1 ? '' : a}x\\cos ${b === 1 ? '' : b}x-${b === 1 ? '' : b}\\sin ${a === 1 ? '' : a}x\\sin ${b === 1 ? '' : b}x` }; },
    () => { const a = ri(1, 6);
      return { q: `y=\\log(x^2+${a})`, ask: '$y\'$ を求めよ', ans: `2x/(x^2+${a})`, a: `\\dfrac{2x}{x^2+${a}}` }; },
    () => { let a, b, c, d; do { a = nz(-4, 4); b = ri(-5, 5); c = ri(1, 4); d = nz(-5, 5); } while (a * d - b * c === 0);
      return { q: `y=\\dfrac{${lin(a, b)}}{${lin(c, d)}}`, ask: '$y\'$ を求めよ', ans: `(${a * d - b * c})/((${c})x+(${d}))^2`, a: `\\dfrac{${a * d - b * c}}{(${lin(c, d)})^2}` }; },
    () => { const a = ri(1, 4), b = ri(1, 6);
      return { q: `y=\\sqrt{${a === 1 ? '' : a}x^2+${b}}`, ask: '$y\'$ を求めよ', ans: `(${a})x/sqrt((${a})x^2+${b})`, a: `\\dfrac{${a === 1 ? '' : a}x}{\\sqrt{${a === 1 ? '' : a}x^2+${b}}}` }; },
    () => { const a = nz(-3, 3), b = ri(1, 4);
      const ea = a === 1 ? '' : a === -1 ? '-' : a, bb = b === 1 ? '' : b;
      return { q: `y=e^{${ea}x}\\sin ${bb}x`, ask: '$y\'$ を求めよ', ans: `e^((${a})x)*((${a})sin((${b})x)+(${b})cos((${b})x))`,
        a: `e^{${ea}x}(${term(a, `\\sin ${bb}x`, true)}${term(b, `\\cos ${bb}x`)})` }; },
    () => { const n = ri(1, 3);
      return { q: `y=${n === 1 ? 'x' : `x^{${n}}`}\\log x`, ask: '$y\'$ を求めよ', ans: `x^(${n - 1})*((${n})log(x)+1)`, a: `${n === 1 ? '' : n === 2 ? 'x' : `x^{${n - 1}}`}(${n === 1 ? '' : n}\\log x+1)` }; },
    () => { const a = nz(-4, 5), n = ri(2, 5);
      return { q: `y=(x^2${a > 0 ? '+' : ''}${a})^{${n}}`, ask: '$y\'$ を求めよ', ans: `${2 * n}x(x^2+(${a}))^(${n - 1})`, a: `${2 * n}x(x^2${a > 0 ? '+' : ''}${a})${n - 1 === 1 ? '' : `^{${n - 1}}`}` }; },
    () => { const a = ri(1, 4), aa = a === 1 ? '' : a;
      return { q: `y=\\tan ${aa}x`, ask: '$y\'$ を求めよ', ans: `(${a})/cos((${a})x)^2`, a: `\\dfrac{${a}}{\\cos^2 ${aa}x}` }; },
    () => { const a = ri(1, 6);
      return { q: `y=\\dfrac{1}{x^2+${a}}`, ask: '$y\'$ を求めよ', ans: `-2x/(x^2+${a})^2`, a: `-\\dfrac{2x}{(x^2+${a})^2}` }; },
  ],
  int: [
    () => { const a = nz(-3, 3), b = ri(-4, 4), c = ri(-5, 5); let p = ri(-2, 1), q = ri(p + 1, 3);
      // ∫_p^q (ax^2+bx+c) dx を分数で
      const N = 2 * a * (q ** 3 - p ** 3) + 3 * b * (q ** 2 - p ** 2) + 6 * c * (q - p), f = frac(N, 6);
      return { q: `\\displaystyle\\int_{${p}}^{${q}}(${poly([a, b, c])})\\,dx`, ask: '値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const al = ri(-4, 2), be = ri(al + 1, 5), f = frac(-((be - al) ** 3), 6);
      return { q: `\\displaystyle\\int_{${al}}^{${be}}(${lin(1, -al)})(${lin(1, -be)})\\,dx`, ask: '値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const n = ri(2, 6);
      let num = 1, den = 1; for (let k = n - 1; k >= 1; k -= 2) num *= k; for (let k = n; k >= 1; k -= 2) den *= k;
      const f = frac(num, den), even = n % 2 === 0;
      return { q: `\\displaystyle\\int_0^{\\frac{\\pi}{2}}\\sin^{${n}}x\\,dx`, ask: '値を求めよ', ans: even ? `(${fplain(f)})*π/2` : fplain(f), a: even ? `\\dfrac{${f.n === 1 ? '' : f.n}\\pi}{${2 * f.d}}` : ftex(f) }; },
    () => { const a = pick([1, 2, 3, -1, -2]);
      return { q: `\\displaystyle\\int_0^1 xe^{${a === 1 ? '' : a === -1 ? '-' : a}x}\\,dx`, ask: '値を求めよ', ans: `(e^(${a})*(${a}-1)+1)/(${a})^2`,
        a: a === 1 ? '1' : tex(`(e^(${a})*(${a - 1})+1)/${a * a}`) }; },
    () => { const n = ri(0, 3);
      return { q: `\\displaystyle\\int_1^e ${n === 0 ? '' : n === 1 ? 'x' : `x^{${n}}`}\\log x\\,dx`, ask: '値を求めよ', ans: `(${n}*e^(${n + 1})+1)/${(n + 1) ** 2}`,
        a: n === 0 ? '1' : `\\dfrac{${n === 1 ? '' : n}e^{${n + 1}}+1}{${(n + 1) ** 2}}` }; },
    () => pick([
      { q: '\\displaystyle\\int_0^{\\pi}x\\sin x\\,dx', ask: '値を求めよ', ans: 'π', a: '\\pi' },
      { q: '\\displaystyle\\int_0^{\\frac{\\pi}{2}}x\\cos x\\,dx', ask: '値を求めよ', ans: 'π/2-1', a: '\\dfrac{\\pi}{2}-1' },
      { q: '\\displaystyle\\int_0^{\\frac{\\pi}{4}}\\tan x\\,dx', ask: '値を求めよ', ans: 'log(2)/2', a: '\\dfrac{1}{2}\\log 2' },
      { q: '\\displaystyle\\int_0^{1}\\dfrac{dx}{1+x^2}', ask: '値を求めよ', ans: 'π/4', a: '\\dfrac{\\pi}{4}' },
      { q: '\\displaystyle\\int_0^{\\pi}\\sin^2 x\\,dx', ask: '値を求めよ', ans: 'π/2', a: '\\dfrac{\\pi}{2}' },
      { q: '\\displaystyle\\int_1^{e}\\dfrac{\\log x}{x}\\,dx', ask: '値を求めよ', ans: '1/2', a: '\\dfrac12' },
    ]),
    () => { const a = ri(1, 4);
      return { q: `\\displaystyle\\int_0^{${a}}\\sqrt{${a * a}-x^2}\\,dx`, ask: '値を求めよ', ans: `${a * a}π/4`, a: `\\dfrac{${a * a === 1 ? '' : a * a}\\pi}{4}` }; },
    () => { const a = ri(1, 3), b = ri(-4, 4), n = ri(2, 5);
      return { q: `\\displaystyle\\int(${lin(a, b)})^{${n}}\\,dx`, ask: '不定積分を求めよ（積分定数は C）', ans: `((${a})x+(${b}))^(${n + 1})/(${a * (n + 1)})+C`,
        a: `\\dfrac{(${lin(a, b)})^{${n + 1}}}{${a * (n + 1)}}+C` }; },
    () => { const a = pick([1, 2, 3, -1]);
      const ea = a === 1 ? '' : a === -1 ? '-' : a;
      return { q: `\\displaystyle\\int xe^{${ea}x}\\,dx`, ask: '不定積分を求めよ（積分定数は C）', ans: `e^((${a})x)*(x/(${a})-1/(${a})^2)+C`,
        a: tex(`e^(${a}x)*(x/${a}-1/${a * a})`).replace(/\\cdot\s*/g, '') + '+C' }; },
    () => { const a = ri(1, 6);
      return { q: `\\displaystyle\\int\\dfrac{2x}{x^2+${a}}\\,dx`, ask: '不定積分を求めよ（積分定数は C）', ans: `log(x^2+${a})+C`, a: `\\log(x^2+${a})+C` }; },
  ],
  lim: [
    () => { const a = ri(1, 6), b = ri(1, 6), f = frac(a, b);
      return { q: `\\displaystyle\\lim_{x\\to 0}\\dfrac{\\sin ${a === 1 ? '' : a}x}{${b === 1 ? '' : b}x}`, ask: '極限値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const a = nz(-4, 5);
      return { q: `\\displaystyle\\lim_{x\\to 0}\\dfrac{e^{${a === 1 ? '' : a === -1 ? '-' : a}x}-1}{x}`, ask: '極限値を求めよ', ans: `${a}`, a: `${a}` }; },
    () => { const a = nz(-3, 4);
      return { q: `\\displaystyle\\lim_{n\\to\\infty}\\left(1${a > 0 ? '+' : '-'}\\dfrac{${Math.abs(a)}}{n}\\right)^{n}`, ask: '極限値を求めよ', ans: `e^(${a})`, a: `e^{${a}}` }; },
    () => { const a = nz(-6, 6), f = frac(a, 2);
      return { q: `\\displaystyle\\lim_{n\\to\\infty}\\left(\\sqrt{n^2${a > 0 ? '+' : '-'}${Math.abs(a) === 1 ? '' : Math.abs(a)}n}-n\\right)`, ask: '極限値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const a = ri(1, 5), f = frac(a * a, 2);
      return { q: `\\displaystyle\\lim_{x\\to 0}\\dfrac{1-\\cos ${a === 1 ? '' : a}x}{x^2}`, ask: '極限値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const a = nz(-5, 5), b = ri(-5, 5), c = ri(-5, 5), d = ri(1, 5), e = ri(-5, 5), f = frac(a, d);
      return { q: `\\displaystyle\\lim_{n\\to\\infty}\\dfrac{${poly([a, b, c], 'n')}}{${poly([d, 0, e], 'n')}}`, ask: '極限値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const a = nz(-4, 5);
      return { q: `\\displaystyle\\lim_{x\\to 0}\\dfrac{\\log(1${a > 0 ? '+' : '-'}${Math.abs(a) === 1 ? '' : Math.abs(a)}x)}{x}`, ask: '極限値を求めよ', ans: `${a}`, a: `${a}` }; },
  ],
  poly: [
    () => { let a, b, c, d; do { a = ri(1, 3); b = nz(-6, 6); c = ri(1, 3); d = nz(-6, 6); } while (gcd(a, b) !== 1 || gcd(c, d) !== 1);
      return { q: poly([a * c, a * d + b * c, b * d]), ask: '因数分解せよ', ans: `((${a})x+(${b}))((${c})x+(${d}))`, a: `(${lin(a, b)})(${lin(c, d)})`, form: 'factor' }; },
    () => { const a = ri(1, 4), s = pick([1, -1]);
      return { q: `x^3${s > 0 ? '+' : '-'}${a ** 3}`, ask: '因数分解せよ', ans: `(x+(${s * a}))(x^2-(${s * a})x+${a * a})`, a: `(${lin(1, s * a)})(x^2${s > 0 ? '-' : '+'}${a === 1 ? '' : a}x+${a * a})`, form: 'factor' }; },
    () => { const a = nz(-5, 5), b = nz(-5, 5);
      return { q: `x^2${term(-(a + b), 'xy')}${term(a * b, 'y^2')}`, ask: '因数分解せよ', ans: `(x-(${a})y)(x-(${b})y)`, a: `(x${term(-a, 'y')})(x${term(-b, 'y')})`, form: 'factor' }; },
    () => { const a = nz(-4, 4), b = nz(-4, 4), c = nz(-4, 4);
      const cs = [1, a + b + c, a * b + b * c + c * a, a * b * c];
      return { q: `(${lin(1, a)})(${lin(1, b)})(${lin(1, c)})`, ask: '展開せよ', ans: pplain(cs), a: poly(cs), form: 'expand' }; },
    () => { const a = ri(1, 3), b = nz(-4, 4);
      const cs = [a ** 3, 3 * a * a * b, 3 * a * b * b, b ** 3];
      return { q: `(${lin(a, b)})^3`, ask: '展開せよ', ans: pplain(cs), a: poly(cs), form: 'expand' }; },
  ],
  trig: [
    () => { // 15°刻みの角の三角関数の値
      const SIN = { 0: '0', 15: '(sqrt(6)-sqrt(2))/4', 30: '1/2', 45: 'sqrt(2)/2', 60: 'sqrt(3)/2', 75: '(sqrt(6)+sqrt(2))/4', 90: '1' };
      const TAN = { 0: '0', 15: '2-sqrt(3)', 30: 'sqrt(3)/3', 45: '1', 60: 'sqrt(3)', 75: '2+sqrt(3)' };
      let k, fn; do { k = ri(1, 23); fn = pick(['sin', 'cos', 'tan']); } while (fn === 'tan' && k % 12 === 6 || [0, 6, 12, 18].includes(k) && fn !== 'tan' && Math.random() < 0.7);
      const deg = k * 15, rad = `${frac(k, 12).n === 1 ? '' : frac(k, 12).n}\\pi/${frac(k, 12).d}`.replace('/1', '');
      const red = (d) => { // 第1象限の角と符号
        const q = Math.floor(d / 90) % 4, r = d % 90;
        if (fn === 'tan') { const ref = d % 180 <= 90 ? d % 180 : 180 - d % 180; return { v: TAN[ref], s: d % 180 <= 90 ? 1 : -1 }; }
        const sinRef = (x) => (x % 180 <= 90 ? x % 180 : 180 - x % 180);
        if (fn === 'sin') return { v: SIN[sinRef(d)], s: d % 360 < 180 || d % 360 === 0 ? 1 : -1 };
        const c = (d + 90) % 360; return { v: SIN[sinRef(c)], s: c < 180 || c === 0 ? 1 : -1 };
      };
      const { v, s } = red(deg);
      const ans = s < 0 && v !== '0' ? `-(${v})` : v;
      const radTeX = (() => { const f = frac(k, 12); return `\\dfrac{${f.n === 1 ? '' : f.n}\\pi}{${f.d}}`.replace('\\dfrac{\\pi}{1}', '\\pi'); })();
      return { q: `\\${fn}${radTeX}`, ask: '値を求めよ', ans, a: tex(ans) };
    },
    () => { const [p, q, r] = pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25]]);
      const which = pick(['sin', 'cos']);
      const s = frac(p, r), sin2 = frac(2 * p * q, r * r), cos2 = frac(q * q - p * p, r * r);
      return { q: `0<\\theta<\\dfrac{\\pi}{2},\\ \\sin\\theta=${ftex(s)}`, ask: `$\\${which} 2\\theta$ を求めよ`, ans: fplain(which === 'sin' ? sin2 : cos2), a: ftex(which === 'sin' ? sin2 : cos2) }; },
  ],
  explog: [
    () => { const b = pick([2, 3, 5]), k = ri(1, 4), m = pick([3, 5, 6, 7, 10].filter(x => x % b !== 0));
      return { q: `\\log_{${b}}${b ** k * m}-\\log_{${b}}${m}`, ask: '値を求めよ', ans: `${k}`, a: `${k}` }; },
    () => { const c = pick([2, 3]), p = ri(2, 3), q = nz(-4, 5);
      const f = frac(q, p);
      return { q: `\\log_{${c ** p}}${c}^{${q}}`.replace(`^{1}`, ''), ask: '値を求めよ', ans: fplain(f), a: ftex(f) }; },
    () => { const c = pick([2, 3]), p = ri(2, 3), q = nz(-3, 3), f = frac(q, p);
      const base = c ** p, val = q > 0 ? `${c ** q}` : `1/${c ** -q}`;
      return { q: `${base}^{${f.d === 1 ? f.n : `${f.n < 0 ? '-' : ''}\\frac{${Math.abs(f.n)}}{${f.d}}`}}`, ask: '値を求めよ', ans: val, a: tex(val) }; },
    () => { const a = pick([2, 3, 5]), b = pick([3, 5, 7].filter(x => x !== a)), k = ri(2, 4);
      return { q: `\\log_{${a}}${b}\\cdot\\log_{${b}}${a ** k}`, ask: '値を求めよ', ans: `${k}`, a: `${k}` }; },
    () => { const b = pick([2, 3]), k = ri(2, 6), m = nz(-2, 3);
      return { q: `${b}^{x${m > 0 ? '+' : '-'}${Math.abs(m)}}=${b ** k}`, ask: '$x$ を求めよ', ans: `${k - m}`, a: `x=${k - m}` }; },
  ],

  // ---------------- 物理向け（ぶつりば）
  vec: [
    () => { const a = nz(-3, 3), b = nz(-3, 3), c = nz(-3, 3), x = nz(-2, 2), y = nz(-2, 2), z = nz(-2, 2);
      const v = 2 * a * x * y + 2 * b * y * z + c * x;
      return { q: `\\boldsymbol{A}=(${a}x^2y,\\ ${b}yz^2,\\ ${c}xz)`.replace(/\(1x|,\\ 1y|,\\ 1x/g, m => m.replace('1', '')).replace(/-1([xy])/g, '-$1'),
        ask: `点 $(${x},${y},${z})$ での $\\nabla\\cdot\\boldsymbol{A}$ を求めよ`, ans: `${v}`, a: `${v}` }; },
    () => { const a = nz(-3, 3), b = nz(-3, 3), x = nz(-3, 3), y = nz(-3, 3);
      const v = 2 * b * x - 2 * a * y;
      return { q: `\\boldsymbol{A}=(${a}y^2,\\ ${b}x^2,\\ 0)`.replace(/(\(|\\ )1([xy])/g, '$1$2').replace(/(\(|\\ )-1([xy])/g, '$1-$2'),
        ask: `点 $(${x},${y},0)$ での $(\\nabla\\times\\boldsymbol{A})_z$ を求めよ`, ans: `${v}`, a: `${v}` }; },
    () => { const a = nz(-3, 3), b = nz(-2, 2), c = nz(-3, 3);
      return { q: `\\phi=${term(a, 'x^2y', true)}${term(b, 'y^3')}${term(c, 'xz^2')}`, ask: '$\\nabla^2\\phi$ を求めよ',
        ans: `${2 * a + 6 * b}y+${2 * c}x`, a: (term(2 * a + 6 * b, 'y', true) + term(2 * c, 'x', 2 * a + 6 * b === 0)) || '0' }; },
    () => { const n = pick([-1, 1, 2, 3, 4, -2]);
      return { q: `\\phi=r^{${n}}\\quad(r=|\\boldsymbol{r}|,\\ 3\\text{次元})`, ask: '$r\\neq0$ での $\\nabla^2\\phi$ を $r$ で表せ',
        ans: `${n * (n + 1)}r^(${n - 2})`, a: n * (n + 1) === 0 ? '0' : tex(`${n * (n + 1)}r^(${n - 2})`) }; },
  ],
  mat: [
    () => { const a = ri(-4, 4), d = ri(-4, 4), b = nz(-3, 3);
      const m = `(${a}+(${d}))/2`, r = `sqrt(((${a})-(${d}))^2/4+(${b})^2)`;
      const D = (a - d) ** 2 + 4 * b * b, sq = Math.round(Math.sqrt(D));
      const aT = sq * sq === D ? (() => { const x = frac(a + d + sq, 2), y = frac(a + d - sq, 2); return `${ftex(x)},\\ ${ftex(y)}`; })()
        : `\\dfrac{${a + d === 0 ? '' : a + d}\\pm\\sqrt{${D}}}{2}`;
      return { q: `\\begin{pmatrix}${a}&${b}\\\\${b}&${d}\\end{pmatrix}`, ask: '固有値をすべて求めよ（カンマで区切る）',
        ans: `{${m}+${r}, ${m}-${r}}`, a: aT }; },
    () => { const M = [[ri(-3, 3), ri(-3, 3), ri(-3, 3)], [ri(-3, 3), ri(-3, 3), ri(-3, 3)], [ri(-3, 3), ri(-3, 3), ri(-3, 3)]];
      const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      return { q: `\\det\\begin{pmatrix}${M.map(r => r.join('&')).join('\\\\')}\\end{pmatrix}`, ask: '値を求めよ', ans: `${det}`, a: `${det}` }; },
    () => { const k = ri(1, 3);
      return { q: `\\begin{pmatrix}0&${k}&0\\\\${k}&0&${k}\\\\0&${k}&0\\end{pmatrix}`, ask: '固有値をすべて求めよ',
        ans: `{0, ${k}sqrt(2), -${k}sqrt(2)}`, a: `0,\\ \\pm${k === 1 ? '' : k}\\sqrt2` }; },
    () => { const a = nz(-3, 3), b = nz(-3, 3), c = nz(-3, 3);
      return { q: `\\boldsymbol{n}\\cdot\\boldsymbol{\\sigma},\\quad \\boldsymbol{n}=(${a},${b},${c})`, ask: '固有値をすべて求めよ（$\\boldsymbol{\\sigma}$ はパウリ行列）',
        ans: `{sqrt(${a * a + b * b + c * c}), -sqrt(${a * a + b * b + c * c})}`,
        a: Number.isInteger(Math.sqrt(a * a + b * b + c * c)) ? `\\pm${Math.sqrt(a * a + b * b + c * c)}` : `\\pm\\sqrt{${a * a + b * b + c * c}}` }; },
  ],
  gauss: [
    () => { const n = ri(0, 3); let df = 1; for (let k = 2 * n - 1; k >= 1; k -= 2) df *= k;
      return { q: `\\displaystyle\\int_{-\\infty}^{\\infty}x^{${2 * n}}e^{-ax^2}\\,dx\\quad(a>0)`.replace('x^{0}', ''), ask: '$a$ で表せ',
        ans: `${df}/(2a)^${n}*sqrt(π/a)`, a: n === 0 ? '\\sqrt{\\dfrac{\\pi}{a}}' : `\\dfrac{${df}}{${2 ** n}a^{${n}}}\\sqrt{\\dfrac{\\pi}{a}}`.replace('a^{1}', 'a').replace('{1}{', '{1}{') }; },
    () => { const n = ri(0, 5); let f = 1; for (let k = 2; k <= n; k++) f *= k;
      return { q: `\\displaystyle\\int_0^{\\infty}x^{${n}}e^{-ax}\\,dx\\quad(a>0)`.replace('x^{0}', ''), ask: '$a$ で表せ', ans: `${f}/a^${n + 1}`, a: tex(`${f}/a^${n + 1}`) }; },
    () => pick([
      { q: '\\displaystyle\\int_0^{\\infty}\\frac{x^3}{e^x-1}\\,dx', ask: '値を求めよ', ans: 'π^4/15', a: '\\dfrac{\\pi^4}{15}' },
      { q: '\\displaystyle\\int_0^{\\infty}\\frac{x}{e^x+1}\\,dx', ask: '値を求めよ', ans: 'π^2/12', a: '\\dfrac{\\pi^2}{12}' },
      { q: '\\displaystyle\\int_0^{\\infty}\\frac{x}{e^x-1}\\,dx', ask: '値を求めよ', ans: 'π^2/6', a: '\\dfrac{\\pi^2}{6}' },
      { q: '\\Gamma\\!\\left(\\tfrac52\\right)', ask: '値を求めよ', ans: '3sqrt(π)/4', a: '\\dfrac{3\\sqrt\\pi}{4}' },
      { q: '\\displaystyle\\int_{-\\infty}^{\\infty}\\frac{dx}{x^2+a^2}\\quad(a>0)', ask: '$a$ で表せ', ans: 'π/a', a: '\\dfrac{\\pi}{a}' },
      { q: '\\displaystyle\\int_0^{\\pi}\\sin^3\\theta\\,d\\theta', ask: '値を求めよ', ans: '4/3', a: '\\dfrac43' },
      { q: '\\displaystyle\\int_{-1}^{1}P_2(x)^2\\,dx\\quad\\left(P_2=\\tfrac12(3x^2-1)\\right)', ask: '値を求めよ', ans: '2/5', a: '\\dfrac25' },
    ]),
    () => { const a = ri(1, 4), b = nz(-3, 3);
      return { q: `\\displaystyle\\int_{-\\infty}^{\\infty}e^{-${a === 1 ? '' : a}x^2+${b}x}\\,dx`.replace('+-', '-'), ask: '値を求めよ',
        ans: `sqrt(π/${a})*e^(${b * b}/(4*${a}))`, a: `\\sqrt{\\dfrac{\\pi}{${a}}}\\,e^{${ftex(frac(b * b, 4 * a)).replace('\\dfrac', '\\frac')}}`.replace('\\dfrac{\\pi}{1}', '\\pi') }; },
  ],
  series: [
    () => { const [al, alT] = pick([['1/2', '\\frac12'], ['-1/2', '-\\frac12'], ['-1', '-1'], ['1/3', '\\frac13'], ['-2', '-2'], ['3/2', '\\frac32']]);
      const v = (() => { const A = Function(`return ${al}`)(); return A * (A - 1) / 2; })();
      const f = (() => { for (let d = 1; d <= 72; d++) if (Math.abs(Math.round(v * d) - v * d) < 1e-9) return frac(Math.round(v * d), d); })();
      return { q: `(1+x)^{${alT}}`, ask: '$x^2$ の係数を求めよ（$x=0$ のまわりの展開）', ans: fplain(f), a: ftex(f) }; },
    () => { const a = ri(1, 4), k = pick([2, 3, 4]);
      const fn = k % 2 === 1 ? 'sin' : 'cos';
      let fac = 1; for (let j = 2; j <= k; j++) fac *= j;
      const sign = (k === 3 || k === 2) ? -1 : 1;
      const f = frac(sign * a ** k, fac);
      return { q: `\\${fn} ${a === 1 ? '' : a}x`, ask: `$x^{${k}}$ の係数を求めよ`, ans: fplain(f), a: ftex(f) }; },
    () => pick([
      { q: '\\dfrac{1}{\\sqrt{1-\\beta^2}}', ask: '$\\beta^4$ の係数を求めよ', ans: '3/8', a: '\\dfrac38' },
      { q: '\\sqrt{1+x^2}-1', ask: '$x\\to0$ の主要項の係数（$x^2$ の係数）を求めよ', ans: '1/2', a: '\\dfrac12' },
      { q: '\\dfrac{x}{e^x-1}', ask: '$x^2$ の係数を求めよ', ans: '1/12', a: '\\dfrac1{12}' },
      { q: '\\log(1+x)', ask: '$x^3$ の係数を求めよ', ans: '1/3', a: '\\dfrac13' },
      { q: '\\tan x', ask: '$x^3$ の係数を求めよ', ans: '1/3', a: '\\dfrac13' },
      { q: '\\coth x-\\dfrac1x', ask: '$x$ の係数を求めよ（ランジュバン関数の展開）', ans: '1/3', a: '\\dfrac13' },
    ]),
  ],
  order: [
    () => { const T = pick([4, 77, 300, 1000, 5800, 1.0e4]);
      return { q: `T=${T}\\,\\mathrm{K}`, ask: '$k_BT$ は何 meV か（$k_B=8.617\\times10^{-5}\\,\\mathrm{eV/K}$）', ans: `≈${(8.617e-2 * T).toPrecision(3)}`, a: `${(8.617e-2 * T).toPrecision(3)}\\,\\mathrm{meV}` }; },
    () => { const l = pick([121.6, 250, 400, 532, 633, 1064, 1550]);
      return { q: `\\lambda=${l}\\,\\mathrm{nm}`, ask: '光子のエネルギーは何 eV か（$hc=1240\\,\\mathrm{eV\\,nm}$）', ans: `≈${(1239.84 / l).toPrecision(3)}`, a: `${(1239.84 / l).toPrecision(3)}\\,\\mathrm{eV}` }; },
    () => { const V = pick([1, 10, 54, 100, 150, 1000]);
      const lam = 1.226 / Math.sqrt(V);
      return { q: `V=${V}\\,\\mathrm{V}`, ask: '静止から加速した電子のド・ブロイ波長は何 nm か（非相対論的，$h/\\sqrt{2m_ee}=1.226\\,\\mathrm{nm\\,V^{1/2}}$）', ans: `≈${lam.toPrecision(3)}`, a: `${lam.toPrecision(3)}\\,\\mathrm{nm}` }; },
    () => { const Z = ri(1, 3), n = ri(1, 4);
      const E = -13.6 * Z * Z / (n * n);
      return { q: `Z=${Z},\\ n=${n}`, ask: '水素様原子のエネルギー準位は何 eV か（$R_\\infty hc=13.6\\,\\mathrm{eV}$）', ans: `≈${E.toPrecision(3)}`, a: `${E.toPrecision(3)}\\,\\mathrm{eV}` }; },
    () => { const B = pick([0.1, 0.5, 1, 3, 9]);
      return { q: `B=${B}\\,\\mathrm{T}`, ask: '電子のサイクロトロン周波数 $f=eB/2\\pi m_e$ は何 GHz か（$e/m_e=1.759\\times10^{11}\\,\\mathrm{C/kg}$）', ans: `≈${(1.759e11 * B / (2 * Math.PI) / 1e9).toPrecision(3)}`, a: `${(1.759e11 * B / (2 * Math.PI) / 1e9).toPrecision(3)}\\,\\mathrm{GHz}` }; },
    () => { const M = pick([1, 10, 4e6, 1e9]);
      const rs = 2.953 * M;
      return { q: `M=${M >= 1e6 ? tex(String(M)) : M}\\,M_\\odot`, ask: 'シュヴァルツシルト半径は何 km か（$2GM_\\odot/c^2=2.953\\,\\mathrm{km}$）', ans: `≈${rs.toPrecision(3)}`, a: tex(String(+rs.toPrecision(3))) + '\\,\\mathrm{km}' }; },
  ],
};
export const TOPICS = [
  { id: 'order', name: 'オーダー評価', sub: '物理定数で数値を出す', icon: '≈' },
  { id: 'vec', name: 'ベクトル解析', sub: '発散・回転・ラプラシアン', icon: '∇' },
  { id: 'mat', name: '行列と固有値', sub: '対角化・行列式・パウリ行列', icon: 'λ' },
  { id: 'gauss', name: '物理の積分', sub: 'ガウス積分・ガンマ関数', icon: '∫' },
  { id: 'series', name: '近似と展開', sub: 'テイラー展開の係数', icon: '≃' },
  { id: 'diff', name: '微分', sub: '積・商・合成関数', icon: 'd/dx' },
  { id: 'int', name: '積分', sub: '定積分・不定積分', icon: '∫dx' },
  { id: 'mix', name: 'ミックス', sub: 'すべての分野から', icon: '∗' },
];
export function makeProblem(topic) {
  const t = topic === 'mix' ? pick(TOPICS.map(x => x.id).filter(x => x !== 'mix')) : topic;
  for (let tries = 0; tries < 20; tries++) {
    const p = pick(GEN[t])();
    try {
      const spec = parseSpec(p.ans);
      const f = spec.parts[0].fields[0];
      if (checkField(f, { mode: 'plain', text: f.kind === 'expr' ? f.value.src : f.src }).ok !== true) continue;
      return { ...p, topic: t, field: f };
    } catch { /* 作り直す */ }
  }
  throw new Error('問題を作れませんでした');
}

// 「因数分解せよ」は積の形、「展開せよ」は和の形で答えているか
function formOK(text, form) {
  if (!form) return true;
  let ast;
  try { ast = parse(text.replace(/^[^=]*=(?!=)/, '')); } catch { return true; }
  while (ast.t === 'neg') ast = ast.a;
  if (form === 'factor') return ast.t === 'bin' && (ast.op === '*' || ast.op === '^');
  if (form === 'expand') {
    const noProd = (a) => a.t === 'num' || a.t === 'var' || (a.t === 'bin' && a.op === '^' && a.a.t === 'var') || (a.t === 'neg' && noProd(a.a)) ||
      (a.t === 'bin' && a.op === '*' && (a.a.t === 'num' || a.a.t === 'var' || a.a.t === 'bin' && a.a.op === '^') && (a.b.t === 'var' || a.b.t === 'bin' && a.b.op === '^' && a.b.a.t === 'var' || a.b.t === 'num'));
    const terms = (a) => a.t === 'bin' && (a.op === '+' || a.op === '-') ? [...terms(a.a), ...terms(a.b)] : [a];
    return terms(ast).every(noProd);
  }
  return true;
}

// ---------------------------------------------------------------- 画面
const KEYS = ['^', '(', ')', '/', '√', 'π', 'e', 'sin', 'cos', 'log', 'x', 'a', 'r', '+C', '{', '}', ','];

export function renderDrillHome(view, ctx) {
  const st = ctx.state.drill || (ctx.state.drill = { size: 10, best: {} });
  view.innerHTML = `
    <div class="fade-in">
      <div class="kicker">計算トレーニング</div>
      <h1>計算</h1>
      <p class="sub">物理でくり返し使う計算を、その場で作る問題で反復します。オーダー評価は有効数字3桁（2%以内で正解）。</p>
      <div class="toolbar"><span class="muted">1セット</span>
        <select id="dsize">${[5, 10, 20].map(n => `<option value="${n}" ${n === st.size ? 'selected' : ''}>${n}問</option>`).join('')}</select></div>
      <div class="drill-grid">${TOPICS.map(t => {
        const b = st.best[t.id];
        return `<button class="drill-card" data-t="${t.id}">
          <span class="dicon">${t.icon}</span>
          <b>${t.name}</b><span>${t.sub}</span>
          <small>${b ? `ベスト ${b.ok}/${b.n}・${fmtTime(b.ms)}` : 'まだ記録なし'}</small>
        </button>`;
      }).join('')}</div>
    </div>`;
  view.querySelector('#dsize').addEventListener('change', (e) => { st.size = +e.target.value; ctx.save(); });
  view.querySelectorAll('.drill-card').forEach(b => b.addEventListener('click', () => runDrill(view, ctx, b.dataset.t)));
}

function fmtTime(ms) { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`; }

function runDrill(view, ctx, topic) {
  const st = ctx.state.drill;
  const n = st.size || 10;
  const probs = [];
  for (let i = 0; i < n; i++) probs.push(makeProblem(topic));
  const res = [];
  const t0 = Date.now();
  let i = 0;
  ctx.setImmersive(true);
  const T = TOPICS.find(t => t.id === topic);

  function show() {
    const p = probs[i];
    view.innerHTML = `
      <div class="fade-in drill">
        <div class="player-top"><button class="icon-btn" id="dquit" aria-label="やめる">×</button>
          <div class="progress"><div style="width:${Math.round(i / n * 100)}%"></div></div>
          <span class="count">${i + 1} / ${n}</span></div>
        <div class="kicker">${T.name}</div>
        <div class="dq"><div class="dask">${p.ask.replace(/\$([^$]+)\$/g, (_, m) => `<span class="m">$${m}$</span>`)}</div><div class="dexpr" id="dexpr"></div></div>
        <div class="answer-row"><input class="answer-input" id="dans" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${p.form === 'factor' ? '例：(x+1)(2x-3)' : p.form === 'expand' ? '例：x^3+2x^2-x+5' : '答えを入力'}"></div>
        <div class="preview" id="dpv"></div>
        <div class="keypad" id="dkp">${KEYS.map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
        <div class="btn-row"><button class="btn primary" id="dgo">判定</button></div>
        <div id="dfb"></div>
      </div>`;
    ctx.tex(view.querySelector('#dexpr'), p.q, true);
    ctx.math(view.querySelector('.dask'));
    const inp = view.querySelector('#dans'), pv = view.querySelector('#dpv');
    inp.focus({ preventScroll: true });
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (!v) { pv.textContent = ''; return; }
      try { ctx.tex(pv, toTeX(parse(v.replace(/^[^=]*=(?!=)/, '')))); pv.className = 'preview'; } catch { pv.textContent = '…'; pv.className = 'preview err'; }
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); view.querySelector('#dgo')?.click(); } });
    view.querySelectorAll('#dkp button').forEach(b => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const k = b.dataset.k, ins = { sin: 'sin(', cos: 'cos(', log: 'log(', '√': 'sqrt(' }[k] ?? k;
        const s = inp.selectionStart ?? inp.value.length, e2 = inp.selectionEnd ?? s;
        inp.value = inp.value.slice(0, s) + ins + inp.value.slice(e2);
        inp.focus(); inp.setSelectionRange(s + ins.length, s + ins.length);
        inp.dispatchEvent(new Event('input'));
      });
    });
    view.querySelector('#dquit').addEventListener('click', () => { ctx.setImmersive(false); renderDrillHome(view, ctx); });
    view.querySelector('#dgo').addEventListener('click', () => {
      const v = inp.value.trim();
      if (!v) return;
      const r = checkField(p.field, { mode: 'plain', text: v });
      if (r.syntax) { view.querySelector('#dfb').innerHTML = `<div class="inline-err">${ctx.esc(r.error || '書き方を確かめてください')}</div>`; return; }
      let ok = r.ok === true, note = '';
      if (ok && !formOK(v, p.form)) { ok = false; note = p.form === 'factor' ? '値は合っていますが、因数分解した形（積の形）で答えます。' : '値は合っていますが、展開した形（和の形）で答えます。'; }
      res.push(ok);
      ctx.play(ok ? 'correct' : 'wrong');
      inp.readOnly = true;
      view.querySelector('#dgo').remove();
      const fb = view.querySelector('#dfb');
      fb.innerHTML = `<div class="result ${ok ? 'ok' : 'ng'} fade-in"><span class="mark">${ok ? ctx.ICON.ok : ctx.ICON.ng}</span><div>${ok ? '正解' : '違います'}${note ? `<small>${note}</small>` : ''}</div></div>
        ${ok ? '' : `<div class="solution"><div class="title">答</div><div class="dans" id="dkey"></div></div>`}
        <button class="btn primary block" id="dnext" style="margin-top:12px">${i + 1 < n ? '次へ' : '結果を見る'}</button>`;
      if (!ok) ctx.tex(fb.querySelector('#dkey'), p.a, true);
      const next = () => { i++; i < n ? show() : finish(); };
      fb.querySelector('#dnext').addEventListener('click', next);
      if (ok) setTimeout(() => { if (document.body.contains(fb) && fb.querySelector('#dnext')) next(); }, 650);
    });
  }

  function finish() {
    const ms = Date.now() - t0, ok = res.filter(Boolean).length;
    const prev = st.best[topic];
    const better = !prev || ok / n > prev.ok / prev.n || (ok / n === prev.ok / prev.n && ms < prev.ms);
    if (better) st.best[topic] = { ok, n, ms, at: Date.now() };
    ctx.save();
    ctx.play('finish');
    view.innerHTML = `
      <div class="fade-in">
        <div class="kicker">${T.name}</div>
        <h1>${ok} / ${n} 正解</h1>
        <div class="stat-row">
          <div class="stat"><b>${Math.round(ok / n * 100)}%</b><span>正答率</span></div>
          <div class="stat"><b>${fmtTime(ms)}</b><span>かかった時間</span></div>
          <div class="stat"><b>${Math.round(ms / n / 1000)}秒</b><span>1問あたり</span></div>
        </div>
        ${better ? '<p class="sub">自己ベストを更新しました。</p>' : ''}
        <div class="btn-row"><button class="btn" id="dagain">もう一度</button><button class="btn primary" id="dhome">計算トップへ</button></div>
      </div>`;
    ctx.setImmersive(false);
    ctx.birdSay(ok === n ? '全問正解！ 計算が安定してきました。' : ok >= n * 0.7 ? 'いい調子です。間違えた形を、次はゆっくり確かめよう。' : '計算はまず正確さから。符号と係数を1つずつ確認しよう。', { sound: false });
    view.querySelector('#dagain').addEventListener('click', () => runDrill(view, ctx, topic));
    view.querySelector('#dhome').addEventListener('click', () => renderDrillHome(view, ctx));
  }
  show();
}
