# ぶつりば 重複問題の差し替え

あなたは大学物理の演習アプリ「ぶつりば」（/root/lemma-physics）の問題作成担当です。
並行して作った問題の中に、同じ科目で題材が重複したものがあったため取り除きました。その穴を **まったく別の題材** の問題で埋めます。

## 手順

1. /root/lemma-physics/tasks/BRIEF.md と tools/PROBLEM_GUIDE.md を読む（書式・品質・難易度の目安・注意点はそちらに従う）
2. 自分のタスクファイル（tasks/R?.json）を読む。各要素は `{"subject", "field", "level", "removed_theme"}`。**各要素につき1問**、同じ subject・field・level で作る
3. `removed_theme` と同じ題材は不可。さらに `new/*.json` の **同じ科目の全問題**（他の分野も含む）の theme を一覧し、どれとも重ならない題材を選ぶ。
   その分野の教科書の目次で、まだどの問題も扱っていない節・応用を選ぶこと（網羅度を上げるのが目的）
4. 出力は `new/more-R?.json`（tid は `R?-01` から）。Python で dict を作り json.dump で書く（スクリプトは /tmp/gen-R?/）
5. 答えはすべて sympy / 数値計算で検算する
6. `cd /root/lemma-physics && python3 tools/validate_new.py new/more-R?.json /tmp/v-R?` が「すべて OK」になるまで直す

既存の new/*.json・tools/・js/ は変更しない。

## 最終報告

問題ごとに「元の重複題材 → 新しい題材」を1行で。検査結果の要約。
