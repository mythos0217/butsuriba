#!/usr/bin/env python3
"""新しく作った問題（JSON）を、問題管理表に入れる前に検査する。

    python3 tools/validate_new.py new.json [作業用フォルダ]

new.json は次の形のオブジェクトの配列：
  {"subject": "力学", "field": "質点の運動", "level": 0, "theme": "…", "minutes": 8,
   "q": "問題文（LaTeX）", "answer": "答え（LaTeX）", "solution": "解答・解説（LaTeX）",
   "idea": "核となるアイデア", "tags": "タグ1,タグ2", "input": "入力用の答え"}
（"tid" を付けると報告にその名前が使われる。無ければ 通し番号）

検査すること：
  1. 必須の項目・科目と分野の組・難易度（0〜4）
  2. 問題文などがアプリ用 HTML に変換でき、未対応の命令がないこと
  3. すべての数式が KaTeX で描画できること
  4. 入力用の答えがアプリで読め、正解を入れると正解になること
  5. 小問の数（\\item の数）と入力用の答えの行数が合うこと
  6. 入力用の答えの値が「答え」列の数式と SymPy で一致すること
  7. 既存の問題（data/）と問題文がまったく同じでないこと
問題がなければ終了コード 0。
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import import_xlsx as IX  # noqa: E402

from physics_fields import FIELDS  # noqa: E402
REQ = ['subject', 'field', 'level', 'theme', 'minutes', 'q', 'answer', 'solution', 'idea', 'tags', 'input']


def main():
    src = Path(sys.argv[1])
    work = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp())
    work.mkdir(parents=True, exist_ok=True)
    items = json.loads(src.read_text(encoding='utf-8'))
    errs = []
    existing_q = set()
    data = HERE.parent / 'data'
    for f in data.glob('f-*.json'):
        for b in json.loads(f.read_text(encoding='utf-8')).values():
            existing_q.add(re.sub(r'\s+', '', b['q']))
    html, specs, rows, seen_q = {}, {}, [], {}
    for n, it in enumerate(items):
        tid = str(it.get('tid') or f'#{n + 1}')
        miss = [k for k in REQ if k not in it or it[k] in (None, '')]
        if miss:
            errs.append(f'{tid}: 項目がない {miss}')
            continue
        if it['field'] not in FIELDS.get(it['subject'], []):
            errs.append(f'{tid}: 科目と分野の組が不明 {it["subject"]} / {it["field"]}')
        if it['level'] not in (0, 1, 2, 3, 4):
            errs.append(f'{tid}: 難易度が 0〜4 でない')
        unknown = set()
        ctx = {'id': tid, 'unknown': unknown}
        try:
            h = {k: IX.render(it[s], ctx) for k, s in [('q', 'q'), ('a', 'answer'), ('s', 'solution'), ('k', 'idea'), ('th', 'theme')]}
        except Exception as e:  # noqa: BLE001
            errs.append(f'{tid}: HTML に変換できない {e}')
            continue
        if unknown:
            errs.append(f'{tid}: 未対応の命令 {sorted(unknown)}')
        html[tid] = h
        key = re.sub(r'\s+', '', h['q'])
        if key in existing_q:
            errs.append(f'{tid}: 既存の問題と問題文が同じ')
        if key in seen_q:
            errs.append(f'{tid}: {seen_q[key]} と問題文が同じ')
        seen_q[key] = tid
        inp = str(it['input']).strip()
        # 小問は enumerate の \item だけを数える（itemize の箇条書きは小問ではない）
        q_no_itemize = re.sub(r'\\begin\{itemize\}.*?\\end\{itemize\}', '', it['q'], flags=re.S)
        items_q = len(re.findall(r'\\item\b', q_no_itemize))
        lines = inp.split('\n')
        nums = [m.group(1) for l in lines if (m := re.match(r'^\((\d+)\)', l))]
        if items_q:
            if len(lines) != items_q or nums != [str(k + 1) for k in range(items_q)]:
                errs.append(f'{tid}: 小問 {items_q}個 に対し 入力用の答えの行が {len(lines)}行（番号 {nums}）')
        elif len(lines) != 1 or nums:
            errs.append(f'{tid}: 小問のない問題は、入力用の答えを番号なしの1行にする')
        specs[tid] = {'spec': inp}
        rows.append([tid] + [''] * 7 + [it['answer']])
    (work / 'html').mkdir(exist_ok=True)
    (work / 'html' / 'f-new.json').write_text(json.dumps(html, ensure_ascii=False), encoding='utf-8')
    (work / 'specs.json').write_text(json.dumps(specs, ensure_ascii=False), encoding='utf-8')
    (work / 'rows.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')

    r = subprocess.run(['node', str(HERE / 'check_katex.cjs'), str(work / 'html')], capture_output=True, text=True)
    print('[KaTeX]', r.stdout.strip().split('\n')[0])
    if r.returncode:
        errs += ['KaTeX: ' + l for l in r.stdout.strip().split('\n')[1:]]
    r = subprocess.run(['node', str(HERE / 'check_answers.mjs'), str(work / 'specs.json'), str(work / 'bad1.json')], capture_output=True, text=True)
    out = r.stdout.strip().split('\n')
    k = next((i for i, l in enumerate(out) if l.startswith('読めない')), len(out) - 1)
    print('[入力用の答え]', ' '.join(l.strip() for l in out[:k + 1]))
    bad1 = json.loads((work / 'bad1.json').read_text()) if (work / 'bad1.json').exists() else {}
    for l in out[k + 1:]:
        errs.append('入力用の答え:' + l)
    if r.returncode and not bad1:
        errs.append('check_answers.mjs が失敗: ' + r.stderr[-500:])
    r = subprocess.run([sys.executable, str(HERE / 'crosscheck_answers.py'), str(work / 'rows.json'), str(work / 'specs.json'), str(work / 'bad2.json')], capture_output=True, text=True)
    print('[SymPy 照合]', ' / '.join(r.stdout.strip().split('\n')))
    if r.returncode:
        errs.append('crosscheck_answers.py が失敗: ' + r.stderr[-800:])
    else:
        detail = json.loads((work / 'bad2-detail.json').read_text())
        for k, v in detail.items():
            errs.append(f'SymPy 照合で不一致: {k} {v}')
    print(f'[件数] {len(items)}問')
    if errs:
        print(f'\n問題 {len(errs)}件:')
        for e in errs:
            print(' -', e)
        sys.exit(1)
    print('すべて OK')


if __name__ == '__main__':
    main()
