// 入力用の答えを読みやすい書式に整える（意味が変わらないことを確かめてから置き換える）
//   node tools/pretty_specs.mjs specs.json
import fs from 'fs';
import { parseSpec, specToText, checkField } from '../js/answer.js';

const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let changed = 0, kept = 0;
function inputFor(f) {
  if (f.kind === 'cases') return { mode: 'cases', rows: f.cases.map(c => ({ cond: c.condSrc, val: c.valSrc })) };
  if (f.kind === 'set') return { mode: 'plain', text: f.items.map(i => i.src).join(', ') };
  if (f.kind === 'expr') return { mode: 'plain', text: f.value.src };
  return { mode: 'plain', text: f.src };
}
for (const v of Object.values(data)) {
  if (!v.spec) continue;
  try {
    const a = parseSpec(v.spec);
    const text = specToText(a);
    const b = parseSpec(text);
    // 整えた答えを元の正解で採点し、逆も確かめる
    a.parts.forEach((p, i) => p.fields.forEach((f, j) => {
      const g = b.parts[i].fields[j];
      if (f.kind !== g.kind || (f.label || '') !== (g.label || '')) throw new Error('形が変わった');
      if (f.kind === 'self') return;
      if (checkField(f, inputFor(g)).ok !== true || checkField(g, inputFor(f)).ok !== true) throw new Error('値が変わった');
    }));
    if (text !== v.spec) { v.spec = text; changed++; }
  } catch (e) { kept++; }
}
fs.writeFileSync(file, JSON.stringify(data, null, 0));
console.log(`整えた ${changed}問・元のまま ${kept}問`);
