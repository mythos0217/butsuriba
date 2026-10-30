#!/usr/bin/env python3
"""new/*.json（検査済みの問題）→ ぶつりば問題管理表.xlsx

    python3 tools/make_xlsx.py [出力.xlsx]

シート：問題一覧・分野一覧・使い方・テスト記録（import_xlsx.py が読む見出しと同じ）
ID は「科目記号-分野番号-通し番号」（例 ME-03-002）。
"""
import json
import sys
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from physics_fields import SUBJECTS, LEVELS  # noqa: E402

COLS = ['ID', '作成日', '科目', '分野', '単元・テーマ', '難易度', '想定時間(分)', '問題文（LaTeX）', '答え', '解答・解説',
        '核となるアイデア', '参考元（非公開）', '作成方法', '検証:二重解答', '検証:SymPy等', '検証:人間確認', '検証済み', 'タグ', 'メモ',
        '入力用の答え']
WIDTH = {'ID': 13, '作成日': 11, '科目': 12, '分野': 20, '単元・テーマ': 26, '難易度': 7, '想定時間(分)': 8,
         '問題文（LaTeX）': 60, '答え': 34, '解答・解説': 60, '核となるアイデア': 34, 'タグ': 18, '入力用の答え': 34}
HEAD = PatternFill('solid', fgColor='1F3478')
SUBJ_ORDER = list(SUBJECTS)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / 'ぶつりば問題管理表.xlsx'
    items = []
    for f in sorted((HERE.parent / 'new').glob('*.json')):
        items += json.loads(f.read_text(encoding='utf-8'))
    items.sort(key=lambda it: (SUBJ_ORDER.index(it['subject']), SUBJECTS[it['subject']][1].index(it['field']), it['level']))

    wb = Workbook()
    ws = wb.active
    ws.title = '問題一覧'
    ws.append(COLS)
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = HEAD
        c.alignment = Alignment(vertical='center', wrap_text=True)
    counter = {}
    today = date.today().isoformat()
    for it in items:
        code = SUBJECTS[it['subject']][0]
        fno = SUBJECTS[it['subject']][1].index(it['field']) + 1
        k = (code, fno)
        counter[k] = counter.get(k, 0) + 1
        pid = f'{code}-{fno:02d}-{counter[k]:03d}'
        row = {'ID': pid, '作成日': today, '科目': it['subject'], '分野': it['field'], '単元・テーマ': it['theme'],
               '難易度': it['level'], '想定時間(分)': it['minutes'], '問題文（LaTeX）': it['q'], '答え': it['answer'],
               '解答・解説': it['solution'], '核となるアイデア': it['idea'], '参考元（非公開）': '', '作成方法': 'AI作成',
               '検証:二重解答': '', '検証:SymPy等': '✓', '検証:人間確認': '', '検証済み': '', 'タグ': it['tags'],
               'メモ': '', '入力用の答え': it['input']}
        ws.append([row[c] for c in COLS])
    for i, c in enumerate(COLS, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = WIDTH.get(c, 10)
    for r in ws.iter_rows(min_row=2):
        for c in r:
            c.alignment = Alignment(vertical='top', wrap_text=True)
    ws.freeze_panes = 'C2'
    ws.auto_filter.ref = ws.dimensions
    dv = DataValidation(type='whole', operator='between', formula1='0', formula2='5', showErrorMessage=True,
                        error='難易度は 0〜5')
    ws.add_data_validation(dv)
    dv.add(f'F2:F{max(ws.max_row, 2000)}')

    wf = wb.create_sheet('分野一覧')
    wf.append(['科目', '分野', '科目記号', '分野番号', '問題数'])
    for s, (code, fields) in SUBJECTS.items():
        for n, f in enumerate(fields, 1):
            wf.append([s, f, code, n, sum(1 for it in items if it['subject'] == s and it['field'] == f)])
    for c in wf[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = HEAD
    for col, w in zip('ABCDE', (16, 32, 9, 9, 8)):
        wf.column_dimensions[col].width = w

    wu = wb.create_sheet('使い方')
    lines = [
        'ぶつりば 問題管理表',
        '',
        '■ 列',
        '難易度：' + '・'.join(f'{k}={v}' for k, v in LEVELS.items()),
        '「参考元（非公開）」「作成方法」「メモ」はアプリに出ません。タグに「非表示」を付けた問題もアプリに出ません。',
        '科目・分野は「分野一覧」シートの名前と完全に一致させる（並び順もこのシートに従う）。',
        '',
        '■ 入力用の答え（アプリの自動採点はこの列を正とする）',
        '(1) ω：sqrt(g/l)                  ← 小問ごとに1行。ラベルは全角「：」',
        '(2) 周期 [s]：≈2.01               ← ≈ を付けた数値は相対誤差2%まで正解。単位はラベルの [ ]',
        '(3) E [J]：≈3.2e-19 (1%)          ← 許容幅の指定、指数表記',
        '(4) μ：m_1 m_2/(m_1+m_2) ; E：hbar omega/2   ← 欄は「 ; 」。添字 m_1・k_B、ギリシャ文字 omega/ω、ħ=hbar',
        '(5) {1/2, -1/2}                   ← 順不同の組。( ) は順序あり、1:2 は比、0<x<1 は範囲',
        '(6) 場合分け{ T<T_c → … | T>=T_c → 0 }',
        '(7) 記述：要点                    ← 証明・導出・説明は自己採点',
        '変数は1文字（＋添字）だけ。ab は a×b。e はネイピア数、E は変数。',
        '',
        '■ 取り込み',
        'python3 tools/import_xlsx.py ぶつりば問題管理表.xlsx',
        'node tools/check_answers.mjs data',
        'node tools/check_katex.cjs',
    ]
    for l in lines:
        wu.append([l])
    wu['A1'].font = Font(bold=True, size=14)
    wu.column_dimensions['A'].width = 110

    wt = wb.create_sheet('テスト記録')
    wt.append(['日付', '問題ID', '科目', '分野', '難易度', '正誤', '所要時間', '手応え', 'どこで詰まったか', '感想'])
    for c in wt[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = HEAD

    wb.save(out)
    print(f'{len(items)}問 → {out}')


if __name__ == '__main__':
    main()
