#!/bin/sh
# 入力用の答えの下書きを作る一連の処理（作成 → 書式の検査 → 整形 → SymPy で元の答えと照合 → 合わないものを自己採点に）
#   sh tools/build_input_answers.sh rows.json 作業用フォルダ
set -e
ROWS=$1; W=$2
D=$(dirname "$0")
python3 -I $D/make_input_answers.py $ROWS $W/specs.json
node $D/check_answers.mjs $W/specs.json $W/bad1.json > /dev/null
python3 -I $D/make_input_answers.py $ROWS $W/specs.json $W/bad1.json
node $D/pretty_specs.mjs $W/specs.json
python3 $D/crosscheck_answers.py $ROWS $W/specs.json $W/bad2.json
python3 -I -c "
import json,sys
a=json.load(open('$W/bad1.json')); b=json.load(open('$W/bad2.json'))
for k,v in b.items(): a[k]=sorted(set(a.get(k,[]))|set(v))
json.dump(a,open('$W/bad.json','w'))"
python3 -I $D/make_input_answers.py $ROWS $W/specs.json $W/bad.json
node $D/pretty_specs.mjs $W/specs.json
node $D/check_answers.mjs $W/specs.json $W/bad3.json
python3 $D/crosscheck_answers.py $ROWS $W/specs.json $W/bad4.json
