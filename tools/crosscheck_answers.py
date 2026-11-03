#!/usr/bin/env python3
"""入力用の答えを、元の「答え」（LaTeX）と SymPy で独立に照合する。

入力用の答えに出てくる値・範囲の端の数・場合分けの値を1つずつ取り出し、
元の答えの数式のどれかと数値的に一致するかを調べる。一致しない小問は「記述」に戻す候補として出力する。

    python3 tools/crosscheck_answers.py rows.json specs.json mismatches.json
"""
import json
import random
import re
import sys
import warnings

warnings.filterwarnings('ignore')
from sympy import N, Symbol, pi, E, sqrt, sympify, Expr
from sympy.parsing.latex import parse_latex
from sympy.parsing.sympy_parser import (parse_expr, standard_transformations,
                                        implicit_multiplication_application, convert_xor, split_symbols)

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from make_input_answers import split_answer, split_top  # noqa: E402

GREEK_NAME = {'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'θ': 'theta', 'φ': 'phi', 'ω': 'omega',
              'λ': 'lambda_', 'μ': 'mu', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'ψ': 'psi', 'ξ': 'xi', 'η': 'eta',
              'ζ': 'zeta', 'ι': 'iota', 'κ': 'kappa', 'ν': 'nu', 'ε': 'epsilon', 'χ': 'chi',
              'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Σ': 'Sigma', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega'}
TRANS = standard_transformations + (convert_xor, split_symbols, implicit_multiplication_application)


# ---------------------------------------------------------------- 元の LaTeX → SymPy
def brace_args(t):
    """\\frac12 → \\frac{1}{2}、\\sqrt3 → \\sqrt{3}、x^2 はそのまま"""
    out, i, n = [], 0, len(t)

    def arg(i):
        while i < n and t[i] == ' ':
            i += 1
        if i >= n:
            return '{}', i
        if t[i] == '{':
            d = 0
            for j in range(i, n):
                if t[j] == '{':
                    d += 1
                elif t[j] == '}':
                    d -= 1
                    if d == 0:
                        return '{' + brace_args(t[i + 1:j]) + '}', j + 1
        if t[i] == '\\':
            m = re.match(r'\\[a-zA-Z]+', t[i:])
            if m:
                return '{' + m.group(0) + '}', i + m.end()
        return '{' + t[i] + '}', i + 1

    while i < n:
        m = re.match(r'\\(d?t?frac|cfrac)', t[i:])
        if m:
            i += m.end()
            a, i = arg(i)
            b, i = arg(i)
            out.append('\\frac' + a + b)
            continue
        m = re.match(r'\\sqrt', t[i:])
        if m:
            i += m.end()
            idx = ''
            if i < n and t[i] == '[':
                j = t.index(']', i)
                idx = t[i:j + 1]
                i = j + 1
            a, i = arg(i)
            out.append('\\sqrt' + idx + a)
            continue
        out.append(t[i])
        i += 1
    return ''.join(out)


def paren_mul(t):
    out, i = [], 0
    for i, ch in enumerate(t):
        k = i - 1
        while k >= 0 and t[k] == ' ':
            k -= 1
        if ch == '(' and k >= 0 and re.match(r'[a-zA-Z0-9}]', t[k]):
            j = k
            while j >= 0 and t[j].isalpha():
                j -= 1
            is_cmd = j >= 0 and t[j] == '\\' and j < k
            if not is_cmd:
                out.append(' \\times ')
        out.append(ch)
    return ''.join(out)


def clean_tex(t):
    # 物理用：\hbar、\approx、単位（\,\mathrm{m/s} など）を整理
    t = t.replace('\\hbar', ' Y_{9} ')
    t = re.sub(r'\\(approx|simeq|sim|propto)(?![a-zA-Z])', '=', t)
    t = re.sub(r'\\(,|;|\s)*\\(mathrm|text)\{\s*(?:[a-zA-Zμ°Ω/^\-0-9\s\\\{\}]*?)\}\s*$', '', t)   # 末尾の単位
    t = re.sub(r'(?:\\,|\\;|\\ |\s)+\\(?:mathrm|text)\{(?:[^{}]|\{[^{}]*\})*\}\s*$', '', t)   # 末尾の単位（括弧・\\, を含んでもよい）
    t = re.sub(r'\\mathrm\{([A-Za-z0-9]+)\}', r'\1', t)
    t = re.sub(r'\\(left|right|bigl|bigr|Bigl|Bigr|displaystyle|boldsymbol|mathrm|,|;|!|quad|qquad)\b\s*', ' ', t)
    t = re.sub(r'\\text\{[^}]*\}', ',', t)
    t = t.replace('\\ ', ' ').replace('\\dfrac', '\\frac').replace('\\tfrac', '\\frac')
    t = t.replace('\\leqq', '\\le').replace('\\geqq', '\\ge').replace('\\cdot', '\\times')
    t = re.sub(r'\^\s*\{?\\circ\}?\s*(\\mathrm\{C\}|\\mathrm\{K\})?', '', t)
    t = t.replace('\\{', '(').replace('\\}', ')')
    t = re.sub(r'\\(pi|varphi|phi|theta|vartheta|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|kappa|lambda|mu|nu|xi|rho|sigma|tau|chi|psi|omega|hbar|Gamma|Delta|Theta|Lambda|Sigma|Phi|Psi|Omega)\s*\(', r'\\\1 \\times (', t)
    t = re.sub(r'(?<![\\a-zA-Z])d(?![a-zA-Z_])', r'\\mathit{d}', t)   # 単独の d は微分記号でなく変数
    # \sin^4(\theta/2) → (\sin(\theta/2))^4（parse_latex が読めない形を直す）
    t = re.sub(r'\\(sin|cos|tan|sinh|cosh|tanh|cot)\s*\^\s*\{?(\d+)\}?\s*\(([^()]*)\)', r'(\\\1(\3))^{\2}', t)
    t = paren_mul(t)   # n(n-1)、aT(L_1-L_0)、wx(L-x) は掛け算（\\sin( などの命令は除く）
    return brace_args(t).strip()


def wraps_whole(p):
    if not (p.startswith('(') and p.endswith(')')):
        return False
    d = 0
    for i, c in enumerate(p):
        d += c == '('
        d -= c == ')'
        if d == 0 and i < len(p) - 1:
            return False
    return True


def fix_consts(e):
    return e.subs({Symbol('pi'): pi, Symbol('e'): E, Symbol('varphi'): Symbol('phi'), Symbol('vartheta'): Symbol('theta'),
                   Symbol('varepsilon'): Symbol('epsilon')})


def tex_values(part_text):
    """元の小問の答えから、数式の値の候補をすべて取り出す"""
    out = []
    maths = []
    for m in re.findall(r'\$([^$]+)\$', part_text):
        maths.append(m)
        if '\\pm' in m or '\\mp' in m:
            maths.append(m.replace('\\pm', '+').replace('\\mp', '-'))
            maths.append(m.replace('\\pm', '-').replace('\\mp', '+'))
    for m in maths:
        m = clean_tex(m)
        pieces = []
        for seg in split_top(m, [',', '，']):
            pieces.extend(re.split(r'\\le|\\ge|<|>|=|\\neq|&|\\\\|:', seg))
        expanded = []
        for p in pieces:
            p = p.strip()
            if wraps_whole(p) and ',' in p:
                expanded.extend(split_top(p[1:-1], [',']))
            elif wraps_whole(p):
                expanded.append(p[1:-1])
            else:
                expanded.append(p)
        for p in expanded:
            p = p.strip()
            if not p or not re.search(r'[0-9a-zA-Z\\]', p):
                continue
            for cand in (p, p.lstrip('-')):
                try:
                    out.append(fix_consts(parse_latex(cand)))
                except Exception:
                    pass
            if '\\pm' in seg or '\\mp' in seg:
                pass
        # ± の両方
        for pm in re.findall(r'([^=,<>]*)\\(?:pm|mp)([^=,<>]*)', m):
            for sgn in ('+', '-'):
                try:
                    out.append(fix_consts(parse_latex(f'{pm[0]}{sgn}{pm[1]}')))
                except Exception:
                    pass
    for m in re.findall(r'(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])', re.sub(r'\$[^$]*\$', ' ', part_text)):
        out.append(sympify(m))
    return [c for c in out if isinstance(c, Expr)]


# ---------------------------------------------------------------- 入力用の答え → SymPy
SUB_SYMS = {}


def protect_subscripts(s):
    """m_1・ω_0・k_B・m1・hbar を1つの記号にして、文字の分解から守る"""
    s = re.sub(r'(?<![A-Za-z])hbar(?![A-Za-z])|ħ', ' Hbarsym ', s)
    # x' → 記号 "x'"（LaTeX 側の parse_latex も x' を1つの記号として読む）
    def prime(m):
        tok = 'PRIMESYM' + ''.join(chr(ord('a') + int(c)) for c in str(len(SUB_SYMS)))
        SUB_SYMS[tok] = Symbol(m.group(1) + "'" * len(m.group(2)))
        return f' {tok} '
    s = re.sub(r"(?<![A-Za-z])([A-Za-z])('+)", prime, s)
    s = re.sub(r'(?<![A-Za-z])lambda(?![A-Za-z_])', ' lambda_ ', s)
    s = re.sub(r'(\d)[eE]([+-]?\d+)', r'\1*10**(\2)', s)
    s = re.sub(r'(\d)(?=[A-Za-z])', r'\1 ', s)   # 3J → 3 J（Python の虚数リテラルにしない）
    greek = '|'.join(sorted(list(GREEK_NAME.values()) + [k for k in GREEK_NAME], key=len, reverse=True)).replace('lambda_', 'lambda')

    def rep(m):
        base, sub = m.group(1), m.group(2)
        base = GREEK_NAME.get(base, base).rstrip('_')
        sub = {'+': 'plus', '-': 'minus'}.get(sub, GREEK_NAME.get(sub, sub).rstrip('_'))
        name = f'{base}_{sub}'
        key = f'Q{len(SUB_SYMS)}Q'.replace('Q', 'Zz' * 1)
        tok = 'SUBSYM' + ''.join(chr(ord('a') + int(c)) for c in str(len(SUB_SYMS)))
        SUB_SYMS[tok] = Symbol(name)
        return f' {tok} '
    s = re.sub(r'(' + greek + r'|[A-Za-z])_\{?(' + greek + r'|[A-Za-z0-9]+|[+\-](?![0-9A-Za-z(]))\}?', rep, s)
    s = re.sub(r'(?<![A-Za-z])([A-Za-z])(\d+)(?![\d.])', rep, s)   # m1 → m_1
    return s


def plain_to_sympy(s):
    s = s.strip()
    s = re.sub(r'^(≈|~|約)\s*', '', s)
    s = re.sub(r'\s*\(\d+(\.\d+)?%\)$', '', s)
    s = protect_subscripts(s)
    s = re.sub(r'(個|通り|桁|本|人|回|枚|組|点|色|日|番目|倍|種類|°)$', '', s)
    for g, name in GREEK_NAME.items():
        s = s.replace(g, f' {name} ')
    s = s.replace('π', ' pi ').replace('√', 'sqrt')
    s = re.sub(r'\|([^|]+)\|', r'Abs(\1)', s)
    funcs = {'coth', 'sech', 'csch', 'cot', 'sec', 'csc', 'arctan', 'arcsin', 'arccos', 'abs', 'EulerE', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'log', 'exp', 'Abs', 'pi', 'E', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
             'alpha', 'beta', 'gamma', 'delta', 'theta', 'phi', 'omega', 'lambda_', 'mu', 'rho', 'sigma', 'tau', 'psi', 'xi',
             'eta', 'zeta', 'kappa', 'nu', 'epsilon', 'chi', 'Gamma', 'Delta', 'Omega', 'Lambda', 'Phi', 'Psi', 'Sigma', 'Theta',
             'Hbarsym', *SUB_SYMS.keys()}
    # アプリの書式では e はいつも定数、文字の並びは掛け算
    s = re.sub(r'[A-Za-z_]+', lambda m: m.group(0) if m.group(0) in funcs else '*'.join('EulerE' if ch == 'e' else ch for ch in m.group(0)), s)
    s = re.sub(r'(\bpi\b|\bE\b|(?<![a-zA-Z])[a-zA-Z](?![a-zA-Z]))\s*\(', r'\1*(', s)   # π(…)、h(…) は掛け算
    s = re.sub(r'(?<![a-zA-Z])([a-zA-Z])\s+(?=sin|cos|tan|log|exp|sqrt)', r'\1*', s)
    from sympy import log as _log
    import string
    greek_syms = {n: Symbol(n) for n in ('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'kappa', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Omega', 'Lambda', 'Phi', 'Psi', 'Sigma', 'Theta')}
    from sympy import Abs as _Abs
    ld = {**{c: Symbol(c) for c in string.ascii_letters}, **greek_syms, 'abs': _Abs, 'arctan': __import__('sympy').atan, 'arcsin': __import__('sympy').asin, 'arccos': __import__('sympy').acos, 'EulerE': E, 'ln': _log, 'pi': pi, 'sqrt': sqrt, 'lambda_': Symbol('lambda'), 'Hbarsym': Symbol('Y_9'), **SUB_SYMS}
    return parse_expr(s, transformations=TRANS, local_dict=ld)


def atoms_of_field(f):
    """フィールドの書式から、照合する値（文字列）を取り出す"""
    if re.match(r'^\s*(証明|図示|記述|略|解答参照)', f) or re.search(r'：\s*(証明|図示|記述|略|解答参照)', f):
        return None
    lab, sep, val = f.rpartition('：') if '：' in f and not f.startswith('場合分け') else ('', '', f)
    val = val.strip()
    if re.match(r'^(証明|図示|記述)', val):
        return None
    cm = re.match(r'^場合分け\{(.*)\}$', val)
    if cm:
        out = []
        for c in split_top(cm.group(1), [' | ']):
            cond, _, v = re.split(r'(→)', c, maxsplit=1)
            out.append(v.strip())
            out.extend(x for x in re.split(r'<=|>=|<|>|=|≠| または | かつ ', cond) if x.strip() and re.search(r'\d', x))
        return out
    if val.startswith('{'):
        items = split_top(val[1:-1], [','])
        out = []
        for it in items:
            out.extend(split_top(it.strip()[1:-1], [',']) if it.strip().startswith('(') and ',' in it else [it])
        return out
    if re.match(r'^\d+(:\d+)+$', val):
        return val.split(':')
    if re.search(r'<|>|≠| または | かつ ', val):
        return [x for x in re.split(r'<=|>=|<|>|≠| または | かつ ', val) if x.strip() and re.search(r'[\dπ]|sqrt', x)]
    if val.startswith('(') and ',' in val and split_top(val[1:-1], [',']).__len__() > 1:
        return split_top(val[1:-1], [','])
    return [val]


def norm_name(s):
    n = re.sub(r'[{}\\ ]', '', str(s))
    n = re.sub(r'^var(epsilon|theta|phi|rho|sigma|pi)', r'\1', n)
    return n.replace('mathrm', '')


TOL = 1e-6


def same(a, b):
    syms = sorted(a.free_symbols | b.free_symbols, key=str)
    names = {}
    for s in syms:
        names.setdefault(norm_name(s), []).append(s)
    for _ in range(3):
        vals = {name: random.uniform(0.3, 2.2) for name in names}
        sub = {s: vals[norm_name(s)] for s in syms}
        try:
            x, y = complex(N(a.subs(sub))), complex(N(b.subs(sub)))
        except Exception:
            return False
        if abs(x - y) > (TOL * max(abs(x), abs(y)) if TOL > 1e-6 else 1e-6 * max(1, abs(x))):
            return False
    return True


def main():
    rows = {r[0]: r for r in json.load(open(sys.argv[1]))}
    specs = json.load(open(sys.argv[2]))
    bad, checked, unverifiable = {}, 0, 0
    detail = {}
    for pid, v in specs.items():
        if not v.get('spec'):
            continue
        parts = split_answer(rows[pid][8])
        lines = v['spec'].split('\n')
        for k, line in enumerate(lines):
            body = re.sub(r'^\(\d+\)\s*', '', line)
            ptext = parts[k][1] if k < len(parts) else rows[pid][8]
            cands = None
            for f in split_top(body, [' ; ']):
                atoms = atoms_of_field(f)
                if not atoms:
                    continue
                if cands is None:
                    cands = tex_values(ptext)
                global TOL
                TOL = 0.03 if re.search(r'：\s*(≈|~|約)|^(≈|~|約)', f.strip()) else 1e-6
                for a in atoms:
                    checked += 1
                    try:
                        sa = plain_to_sympy(a)
                        if not isinstance(sa, Expr):
                            raise ValueError
                    except Exception:
                        unverifiable += 1
                        bad.setdefault(pid, []).append(k)   # 照合できないものも安全のため自己採点に戻す
                        detail[f'{pid}#{k + 1}'] = f'（照合できない）{a}'
                        break
                    if not any(same(sa, c) or same(-sa, c) for c in cands):
                        bad.setdefault(pid, []).append(k)
                        detail[f'{pid}#{k + 1}'] = f'{a}  ｜ 元：{ptext[:120]}'
                        break
                else:
                    continue
                break
    for pid in bad:
        bad[pid] = sorted(set(bad[pid]))
    json.dump(bad, open(sys.argv[3], 'w'), ensure_ascii=False, indent=0)
    json.dump(detail, open(sys.argv[3].replace('.json', '-detail.json'), 'w'), ensure_ascii=False, indent=0)
    print(f'照合した値 {checked}（SymPy で読めず照合できない {unverifiable}）')
    print(f'元の答えと一致しない小問 {sum(len(x) for x in bad.values())}（{len(bad)}問）')


if __name__ == '__main__':
    random.seed(1)
    main()
