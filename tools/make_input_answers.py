#!/usr/bin/env python3
"""既存の「答え」（LaTeX）から「入力用の答え」の下書きを作る。

確実に読み取れる形（数・式・範囲・座標・比・場合分け・「最大値 ○○」など）だけを変換し、
読み取れない小問は「記述」（自己採点）にする。作ったものは node tools/check_answers.mjs で検査する。
"""
import json
import re
import sys

GREEK = {'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'theta': 'θ', 'varphi': 'φ', 'phi': 'φ',
         'omega': 'ω', 'lambda': 'λ', 'mu': 'μ', 'rho': 'ρ', 'sigma': 'σ', 'tau': 'τ', 'psi': 'ψ', 'xi': 'ξ',
         'eta': 'η', 'zeta': 'ζ', 'kappa': 'κ', 'nu': 'ν', 'varepsilon': 'ε', 'epsilon': 'ε'}
FUNCS = {'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan'}
DROP = {'left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'big', 'Big', 'biggl', 'biggr', 'displaystyle', 'textstyle',
        'quad', 'qquad', 'limits', ',', ';', '!', ' ', ':'}


class Fail(Exception):
    pass


def group(s, i):
    """s[i] から1つの引数（{...}・\\命令・1文字）を読む"""
    while i < len(s) and s[i] == ' ':
        i += 1
    if i >= len(s):
        raise Fail('引数なし')
    if s[i] == '{':
        d = 0
        for j in range(i, len(s)):
            if s[j] == '{':
                d += 1
            elif s[j] == '}':
                d -= 1
                if d == 0:
                    return s[i + 1:j], j + 1
        raise Fail('括弧')
    if s[i] == '\\':
        m = re.match(r'\\([a-zA-Z]+)', s[i:])
        if m:
            return s[i:i + m.end()], i + m.end()
        return s[i:i + 2], i + 2
    return s[i], i + 1


def tex2expr(t):
    """LaTeX の数式 → アプリの入力書式（失敗したら Fail）"""
    out, i, n = [], 0, len(t)
    while i < n:
        c = t[i]
        if c == '\\':
            m = re.match(r'\\([a-zA-Z]+|.)', t[i:])
            name = m.group(1)
            i += m.end()
            if name in DROP:
                continue
            if name in ('frac', 'dfrac', 'tfrac', 'cfrac'):
                a, i = group(t, i)
                b, i = group(t, i)
                out.append(f'(({tex2expr(a)})/({tex2expr(b)}))')
            elif name == 'sqrt':
                if i < n and t[i] == '[':
                    j = t.index(']', i)
                    k = t[i + 1:j]
                    i = j + 1
                    a, i = group(t, i)
                    out.append(f'(({tex2expr(a)})^(1/({tex2expr(k)})))')
                else:
                    a, i = group(t, i)
                    out.append(f'sqrt({tex2expr(a)})')
            elif name in ('boldsymbol', 'mathbf', 'bm'):
                a, i = group(t, i)
                out.append(tex2expr(a))
            elif name == 'pi':
                out.append('π')
            elif name in GREEK:
                out.append(GREEK[name])
            elif name in FUNCS:
                out.append(' ' + name + ' ')   # a\sin x が asin（アークサイン）にならないよう空白を入れる
            elif name in ('cdot', 'times'):
                out.append('*')
            elif name in ('leqq', 'leq', 'le', 'leqslant'):
                out.append('<=')
            elif name in ('geqq', 'geq', 'ge', 'geqslant'):
                out.append('>=')
            elif name in ('neq', 'ne'):
                out.append('≠')
            elif name == 'pm':
                out.append('±')
            elif name in ('lvert', 'rvert', 'vert', '|'):
                out.append('|')
            elif name in ('{', '}'):
                out.append('(' if name == '{' else ')')
            else:
                raise Fail(f'未対応 \\{name}')
            continue
        if c == '_':
            raise Fail('添字')
        if c == '^':
            i += 1
            if t[i:i + 5] == '\\circ':
                raise Fail('度数')
            a, i = group(t, i)
            out.append(f'^({tex2expr(a)})')
            continue
        if c == '{':
            a, i = group(t, i)
            out.append(f'({tex2expr(a)})')
            continue
        if c in '&':
            raise Fail('&')
        if c == '!':
            raise Fail('階乗')
        if re.match(r'[A-Za-z0-9+\-*/()|<>=., ]', c):
            out.append(c)
            i += 1
            continue
        raise Fail(f'文字 {c}')
    s = ''.join(out)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def simplify_parens(s):
    # ((a)/(b)) の数字だけの括弧を外して読みやすく
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r'(?<![A-Za-z])\((\d+|π|[a-zA-Zα-ω])\)', r'\1', s)
        s = re.sub(r'\(\((\d+)\)/\((\d+)\)\)', r'(\1/\2)', s)
        s = re.sub(r'(?<![\^/A-Za-z ])\((\d+/\d+)\)(?=$|[ ,;+\-)<>=]|\s)', r'\1', s)
    s = re.sub(r'^\((-?\d+/\d+)\)$', r'\1', s)
    return s


def expr(t):
    t = t.strip().rstrip('．。.')
    if re.search(r'[fghFGHPQSVEL]\s*(\(|\\left\()', re.sub(r'\\[a-zA-Z]+', ' ', t)):
        raise Fail('関数記号')
    deg = False
    if re.search(r'\^\s*\{?\\circ\}?$', t):
        deg = True
        t = re.sub(r'\^\s*\{?\\circ\}?$', '', t)
    if '\\circ' in t:
        raise Fail('度数')
    e = simplify_parens(tex2expr(t))
    if not e:
        raise Fail('空')
    return e + ('°' if deg else '')


def split_top(s, seps):
    out, d, last, i = [], 0, 0, 0
    while i < len(s):
        c = s[i]
        if s.startswith('\\left', i) or s.startswith('\\right', i):
            pass
        if c in '({[':
            d += 1
        elif c in ')}]':
            d -= 1
        elif d == 0:
            for sep in seps:
                if s.startswith(sep, i):
                    out.append(s[last:i])
                    i += len(sep)
                    last = i
                    break
            else:
                i += 1
                continue
            continue
        i += 1
    out.append(s[last:])
    return [x.strip() for x in out if x.strip()]


CMP = re.compile(r'(<|>|\\leqq|\\leq|\\le\b|\\geqq|\\geq|\\ge\b|\\neq|\\lneqq)')
SIMPLE_VAR = re.compile(r'^\s*([a-zA-Z]|\\(?:alpha|beta|gamma|theta|varphi|omega|lambda|mu))\s*$')


LABEL_OK = [
    r'^([a-zA-Z]|\\(?:alpha|beta|gamma|delta|theta|varphi|phi|omega|lambda|mu|rho|sigma|tau|psi|xi))$',     # a, θ
    r'^[a-zA-Z](_\{?[a-zA-Z0-9,+\-]+\}?)$',                       # c_4, a_n, a_{n+1}
    r'^[a-zA-Z](_\{?\w+\}?)?\((?:[a-z0-9.\-]+|\\theta)\)$',     # f(x), f(1), a(n)
    r'^[A-Z]\([A-Z0-9]+\)$',                                     # E(X), P(A)
    r'^(\\mathrm\{\s*[A-Z0-9_\s]+\}|[A-Z]{1,3}|\\overline\{\s*(\\mathrm\{)?[A-Z]+\}?\s*\})$',  # AB, \mathrm{PQ}
    r'^\\(angle|triangle)\s*\\?\w*\{?\s*\\?\w*\{?[A-Z]*\}?\}?$',   # ∠A, △ABC
    r'^\\(sin|cos|tan)\s*\\?\w+$',                               # cos θ
    r'^\\d?frac\{\\mathrm\{\w+\}\}\{\\mathrm\{\w+\}\}$',          # PR/PC
    r'^\((\s*\\?[a-zA-Z]+\w*\s*,)+\s*\\?[a-zA-Z]+\w*\s*\)$',          # (x,y), (a,b,c)
    r'^\\left\((\s*\\?[a-zA-Z]+\w*\s*,)+\s*\\?[a-zA-Z]+\w*\s*\\right\)$',
    r'^\\(int|iint|sum|lim|displaystyle\\int|displaystyle\\sum|displaystyle\\lim)',   # ∫…, Σ…, lim…
]


def label_tex(lhs):
    l = lhs.strip()
    if not any(re.match(p, l) for p in LABEL_OK):
        raise Fail('式＝値（方程式の答え）')
    return f'${l}$'


def set_literal(v):
    """集合の書き方 {a, b, c} → 順不同の組"""
    v = v.strip()
    mm = re.match(r'^(?:\\left)?\\\{(.*?)(?:\\right)?\\\}$', v, re.S)
    if not mm:
        return None
    items = split_top(mm.group(1), [',\\ ', ',\\,', ','])
    if len(items) < 2 or any(CMP.search(x) or '|' in x for x in items):
        raise Fail('集合')
    return '{' + ', '.join(expr(x) for x in items) + '}'


def math_fields(m, all_hint=False):
    """1つの数式（$...$ の中身）を、フィールドの書式（文字列のリスト）に"""
    m = m.strip().rstrip('．。.,，')
    sl = set_literal(m)
    if sl:
        return [sl]
    m = re.sub(r'\\(displaystyle|boldsymbol)\s*', lambda x: '' if x.group(1) == 'displaystyle' else '\\boldsymbol', m)
    if '\\begin{cases}' in m:
        return [cases_field(m)]
    items = split_top(m, [',\\ ', ',\\quad', ',\\,', ',', '，', '\\quad', '\\qquad'])
    if len(items) > 1:
        fields, cur_label, cur_vals = [], None, []

        def flush():
            if cur_label is None:
                return
            if len(cur_vals) == 1:
                fields.append(f'{label_tex(cur_label)}：{cur_vals[0]}')
            else:
                fields.append(f'{label_tex(cur_label)}：{{{", ".join(cur_vals)}}}')
        unlabeled = []
        for it in items:
            if CMP.search(it):
                raise Fail('組の中の不等式')
            eq = split_top(it, ['='])
            if len(eq) >= 2:
                flush()
                v0 = eq[-1].strip()
                cur_label, cur_vals = eq[0], [tuple_expr(v0) if re.match(r'^(\(|\\left\()', v0) and ',' in v0 else expr(v0)]
                if len(eq) > 2 and all(SIMPLE_VAR.match(x) for x in eq[:-1]):
                    for x in eq[1:-1]:
                        fields.append(f'{label_tex(x)}：{expr(eq[-1])}')
            else:
                if cur_label is None:
                    unlabeled.append(tuple_expr(it) if re.match(r'^(\(|\\left\()', it.strip()) else expr(it))
                elif all_hint and SIMPLE_VAR.match(cur_label) and not re.match(r'^(\(|\\left\()', it.strip()):
                    cur_vals.append(expr(it))
                elif re.match(r'^\(.*,.*\)$', cur_label.strip()) and re.match(r'^(\(|\\left\()', it.strip()):
                    cur_vals.append(tuple_expr(it))
                else:
                    raise Fail('ラベルと値の組み合わせ')
        flush()
        if unlabeled:
            if fields or not all_hint:
                raise Fail('ラベルのない複数の値')
            return ['{' + ', '.join(unlabeled) + '}']
        return expand_pm(fields)
    # 1つ
    if CMP.search(m):
        return [range_field(m)]
    ratio = re.match(r'^(.*?)=\s*(\d+\s*:\s*\d+(?:\s*:\s*\d+)*)$', m) or re.match(r'^()(\d+\s*:\s*\d+(?:\s*:\s*\d+)*)$', m)
    if ratio:
        lab = ratio.group(1).strip()
        val = ratio.group(2).replace(' ', '')
        return [f'{label_tex(lab)}：{val}' if lab else val]
    pt = re.match(r'^\\mathrm\{?([A-Z])\}?\s*(\(.*\))$', m) or re.match(r'^\\mathrm\{?([A-Z])\}?\s*(\\left\(.*\\right\))$', m)
    if pt:
        return expand_pm([f'${pt.group(1)}$：{tuple_expr(pt.group(2))}'])
    eq = split_top(m, ['='])
    if len(eq) >= 2:
        lab, val = eq[0], eq[-1]
        if '\\mathrm' in val or '\\text' in val:
            raise Fail('値に文字')
        sl = set_literal(val)
        if sl:
            return [f'{label_tex(lab)}：{sl}']
        if re.match(r'^\(.*,.*\)$|^\\left\(.*\\right\)$', val.strip()):
            return expand_pm([f'{label_tex(lab)}：{tuple_expr(val)}'])
        if len(eq) > 2 and all(SIMPLE_VAR.match(x) for x in eq[:-1]):
            return [f'{label_tex(x)}：{expr(val)}' for x in eq[:-1]]
        return expand_pm([f'{label_tex(lab)}：{expr(val)}'])
    if re.match(r'^\(.*,.*\)$|^\\left\(.*\\right\)$', m.strip()):
        return expand_pm([tuple_expr(m)])
    return expand_pm([expr(m)])


def expand_pm(fields):
    out = []
    for f in fields:
        lab, sep, val = f.rpartition('：')
        if re.search(r'(?<![a-zα-ω])i(?![a-z])', val):
            raise Fail('複素数')
        if '±' in val and val.startswith('(') and val.endswith(')') and val.count('±') == 1 and not val.startswith('{'):
            a, b = val.replace('±', '+', 1).replace('(+', '(', 1), val.replace('±', '-', 1)
            out.append(f'{lab}{sep}{{{a}, {b}}}')
            continue
        if '±' in val:
            if val.count('±') > 1 or val.startswith('{'):
                raise Fail('±が複数')
            a, b = val.replace('±', '+', 1), val.replace('±', '-', 1)
            val = '{' + a + ', ' + b + '}'
        out.append(f'{lab}{sep}{val}')
    return out


def tuple_expr(t):
    t = t.strip()
    t = re.sub(r'^\\left\(', '(', t)
    t = re.sub(r'\\right\)$', ')', t)
    inner = t[1:-1]
    items = split_top(inner, [',\\ ', ',\\,', ','])
    if len(items) < 2:
        raise Fail('組')
    return '(' + ', '.join(expr(x) for x in items) + ')'


def range_field(m):
    m = m.strip()
    if '=' in re.sub(r'\\[lg]eq?q?|<=|>=', '', m) and not re.search(r'\\[lg]eq', m):
        pass
    disj = re.split(r'\\text\{\s*または\s*\}|\\ \\text\{または\}\\ |\\text\{ または \}', m)
    conds = []
    for d in disj:
        parts = split_top(d, [',\\ ', ','])
        conds.extend(parts)
    out = []
    vars_ = set()
    for c in conds:
        if re.search(r'[a-zA-Z]\s*\(', re.sub(r'\\[a-zA-Z]+', '', c)):
            raise Fail('関数記号の範囲')
        e = tex2expr(c)
        if '±' in e:
            raise Fail('±の範囲')
        vs = set(re.findall(r'(?<![a-z])[a-zA-Zα-ω](?![a-z])', re.sub(r'sqrt|sin|cos|tan|log|π|exp', '', e)))
        vars_ |= vs
        out.append(simplify_parens(e))
    if len(vars_) > 2:
        raise Fail('範囲の文字が多い')
    if len(vars_) == 0:
        raise Fail('範囲に文字がない')
    return ' または '.join(out)


def cases_field(m):
    lab = ''
    mm = re.match(r'^(.*?)=\s*\\begin\{cases\}(.*)\\end\{cases\}\s*$', m, re.S)
    if mm:
        lab, body = mm.group(1).strip(), mm.group(2)
    else:
        mm = re.match(r'^\\begin\{cases\}(.*)\\end\{cases\}$', m.strip(), re.S)
        if not mm:
            raise Fail('cases')
        body = mm.group(1)
    rows = [r for r in re.split(r'\\\\', body) if r.strip()]
    cs = []
    for r in rows:
        if '&' not in r:
            raise Fail('cases行')
        v, c = r.split('&', 1)
        c = c.strip()
        c = re.sub(r'^\(|\)$', '', re.sub(r'^\\left\(|\\right\)$', '', c)).strip()
        c = re.sub(r'\\text\{[^}]*\}', '', c).strip().rstrip(',')
        if not c or not CMP.search(c) and '=' not in c:
            raise Fail('cases条件')
        cs.append(f'{simplify_parens(tex2expr(c))} → {expr(v)}')
    body = '場合分け{ ' + ' | '.join(cs) + ' }'
    return f'{label_tex(lab)}：{body}' if lab else body


WORD_LABEL = re.compile(r'^(最大値|最小値|最大|最小|極大値|極小値|面積|体積|長さ|個数|値|確率|期待値|分散|標準偏差|半径|中心|周の長さ|総数|和|積|答|解なし|無数|極限|極限値|傾き|切片|距離)\s*[：:]?\s*$')


def part_fields(text, qpart):
    """1小問の答え（LaTeX まじりの文章）→ フィールドの書式のリスト"""
    t = text.strip().rstrip('．。 　')
    if not t:
        return ['記述']
    if re.match(r'^(証明|略|〔?証明〕?|（証明）|示した|成り立つ|証明は解説参照)', t) and '$' not in t:
        return ['証明']
    if re.search(r'図示|図の', t) and '$' not in t:
        return ['図示']
    all_hint = bool(re.search(r'すべて|全て', qpart or ''))
    # 単位つきの数（18個、30通り）
    um = re.fullmatch(r'(\d+)\s*(個|通り|桁|本|人|回|枚|組|点|色|日|番目|倍|種類)', t)
    if um:
        return [f'{um.group(1)}{um.group(2)}']
    if re.fullmatch(r'-?\d+', t):
        return [t]
    if re.fullmatch(r'\$[^$]+\$', t):
        return math_fields(t[1:-1], all_hint)
    # 単位つきの数式  $90$ 通り
    um = re.fullmatch(r'\$([^$]+)\$\s*(個|通り|桁|本|人|回|枚|組|点|色|日|番目|倍|種類)', t)
    if um:
        f = math_fields(um.group(1))
        if len(f) == 1 and '：' not in f[0] and re.fullmatch(r'[\d+\-*/() ]+', f[0]):
            return [f[0] + um.group(2)]
        raise Fail('単位')
    # 「$A$ または $B$」の範囲
    if re.fullmatch(r'\$[^$]+\$(\s*(または|，または|,\s*または)\s*\$[^$]+\$)+', t):
        segs = re.findall(r'\$([^$]+)\$', t)
        if all(CMP.search(x) for x in segs):
            return [' または '.join(range_field(x) for x in segs)]
    # 「$C$ のとき $V$，…」の場合分け
    lab = ''
    lm = re.match(r'^([^$]{1,8})[：:]\s*(?=\$)', t)
    body = t
    if lm and WORD_LABEL.match(lm.group(1)):
        lab, body = lm.group(1), t[lm.end():]
    if re.fullmatch(r'(\$[^$]+\$\s*のとき\s*\$[^$]+\$[，、；,]?\s*)+', body):
        rows = re.findall(r'\$([^$]+)\$\s*のとき\s*\$([^$]+)\$', body)
        cs = []
        for c, v in rows:
            if not CMP.search(c) and '=' not in c:
                raise Fail('のとき条件')
            if '=' in v:
                v = split_top(v, ['='])[-1]
            cs.append(f'{simplify_parens(tex2expr(c))} → {expr(v)}')
        f = '場合分け{ ' + ' | '.join(cs) + ' }'
        return [f'{lab}：{f}' if lab else f]
    # 「最大値 $A$，最小値 $B$」「$A$（$x=…$）」などを「，」で分けて読む
    items = split_top(t, ['，', '、', '；', ';'])
    fields = []
    if len(items) > 1 and sum(1 for it in items if re.fullmatch(r'\$[^$=]+\$', re.sub(r'（[^（）]*）$', '', it.strip().rstrip('．。')).strip())) > 1:
        if not all_hint:
            raise Fail('ラベルのない複数の値')
    for it in items:
        it = it.strip().rstrip('．。')
        it = re.sub(r'（[^（）]*）$', '', it).strip()      # 末尾の補足（そのときの x など）は採点しない
        it = re.sub(r'\([^()]*\$[^()]*\)$', '', it).strip()
        m1 = re.fullmatch(r'\$([^$]+)\$', it)
        m2 = re.fullmatch(r'([^$\s]{1,6})\s*\$([^$]+)\$', it)
        if m1:
            fields.extend(math_fields(m1.group(1), all_hint))
        elif m2 and WORD_LABEL.match(m2.group(1)):
            inner = math_fields(m2.group(2))
            if len(inner) != 1:
                raise Fail('ラベルに複数')
            v = inner[0].split('：', 1)[-1] if '：' in inner[0] else inner[0]
            fields.append(f'{m2.group(1)}：{v}')
        else:
            raise Fail('読めない項目')
    return fields


def merge_same_labels(fields):
    """同じラベルが複数ある（例：接線 y=… が2本）→ 順不同の組にまとめる"""
    out, seen = [], {}
    for f in fields:
        lab, sep, val = f.partition('：')
        if not sep or lab in ('証明', '図示', '記述'):
            out.append(f)
            continue
        if lab in seen:
            k = seen[lab]
            prev = out[k].partition('：')[2]
            items = (split_top(prev[1:-1], [',']) if prev.startswith('{') else [prev]) + (split_top(val[1:-1], [',']) if val.startswith('{') else [val])
            out[k] = f'{lab}：{{{", ".join(items)}}}'
        else:
            seen[lab] = len(out)
            out.append(f)
    return out


def split_answer(ans):
    ans = ans.strip()
    idx = [m.start() for m in re.finditer(r'(?:(?<=^)|(?<=[\s　]))\((\d)\)', ans)]
    if not idx:
        return [('', ans)]
    out = []
    for k, s in enumerate(idx):
        e = idx[k + 1] if k + 1 < len(idx) else len(ans)
        seg = ans[s:e].strip()
        m = re.match(r'\((\d)\)\s*', seg)
        out.append((m.group(1), seg[m.end():].strip()))
    return out


def question_items(q):
    """問題文の enumerate の各 \\item の文（ラベルつき \\item は除く）"""
    m = re.search(r'\\begin\{enumerate\}(.*)\\end\{enumerate\}', q or '', re.S)
    if not m:
        return []
    body = m.group(1)
    body = re.sub(r'\\begin\{enumerate\}.*?\\end\{enumerate\}', '', body, flags=re.S)
    its = re.split(r'\\item(?!\[)', body)[1:]
    return its


def convert(q, ans):
    parts = split_answer(ans)
    qitems = question_items(q)
    numbered = parts[0][0] != ''
    if numbered:
        nums = [int(n) for n, _ in parts]
        if nums != list(range(1, len(parts) + 1)):
            return None, '小問番号が連続していない'
        if len(qitems) and len(qitems) != len(parts):
            return None, f'小問の数が合わない（問題{len(qitems)}・答え{len(parts)}）'
    lines, auto = [], 0
    for k, (n, text) in enumerate(parts):
        qpart = qitems[k] if k < len(qitems) else q
        try:
            fs = merge_same_labels(part_fields(text, qpart))
        except Fail:
            fs = ['記述']
        except Exception:
            fs = ['記述']
        if any(not re.match(r'^(証明|図示|記述)', f) for f in fs):
            auto += 1
        lines.append((f'({n}) ' if n else '') + ' ; '.join(fs))
    if not auto:
        return None, 'すべて自己採点'
    return '\n'.join(lines), None


def drop_parts(spec, idxs):
    lines = spec.split('\n')
    for k in idxs:
        m = re.match(r'^(\(\d+\)\s*)', lines[k])
        lines[k] = (m.group(1) if m else '') + '記述'
    if all(re.match(r'^(\(\d+\)\s*)?(証明|図示|記述)(\s*;\s*(証明|図示|記述))*$', l) for l in lines):
        return None
    return '\n'.join(lines)


if __name__ == '__main__':
    rows = json.load(open(sys.argv[1]))
    bad = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
    out = {}
    for r in rows:
        spec, why = convert(r[7], r[8])
        if spec and r[0] in bad:
            spec = drop_parts(spec, bad[r[0]])
            if not spec:
                why = '自動採点できる小問なし'
        out[r[0]] = {'spec': spec, 'why': why}
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
    n = sum(1 for v in out.values() if v['spec'])
    print(f'{n}/{len(out)} 問に入力用の答えを作成')
