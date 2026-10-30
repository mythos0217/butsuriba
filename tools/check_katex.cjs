// data/*.json のすべての数式を KaTeX で描画できるか確かめる
//   node tools/check_katex.cjs [フォルダ（省略時は data）]
const fs = require('fs');
const path = require('path');
const katex = require(path.join(__dirname, '..', 'vendor', 'katex.min.js'));

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'data');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let total = 0, bad = [];
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith('f-'))) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [id, b] of Object.entries(data)) {
    for (const [k, html] of Object.entries(b)) {
      // 表示数式 \[...\] と 行内 $...$ を取り出す（\text{} の中の $ を考慮）
      const segs = [];
      let s = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => { segs.push([m, true]); return ' '; });
      let i = 0;
      while (i < s.length) {
        if (s[i] === '$') {
          let j = i + 1, depth = 0;
          while (j < s.length) {
            if (s[j] === '\\') { j += 2; continue; }
            if (s[j] === '{') depth++;
            else if (s[j] === '}') depth--;
            else if (s[j] === '$' && depth === 0) break;
            j++;
          }
          if (j >= s.length) { bad.push([id, k, '閉じていない $', s.slice(i, i + 60)]); break; }
          segs.push([s.slice(i + 1, j), false]);
          i = j + 1;
        } else i++;
      }
      for (const [m, disp] of segs) {
        total++;
        try { katex.renderToString(unesc(m), { throwOnError: true, displayMode: disp, strict: false }); }
        catch (e) { bad.push([id, k, e.message.replace(/^KaTeX parse error: /, '').slice(0, 120), unesc(m).slice(0, 100)]); }
      }
    }
  }
}
console.log(`数式 ${total}個を検査、描画できないもの ${bad.length}個`);
for (const b of bad.slice(0, 80)) console.log(b.join(' | '));
process.exitCode = bad.length ? 1 : 0;
