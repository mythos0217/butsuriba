// アイコン・効果音・テーマ・アプリの猫「シュレ」
export const FILE_VERSION = '0.6.0';

// ---------------------------------------------------------------- アイコン（線画、currentColor）
const S = (body, extra = '') => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;
export const ICON = {
  // 自信度：自信なし（?）・たぶん（半分の円）・確実（チェック付きの円）
  low: S('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 3"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.1" fill="currentColor"/>'),
  mid: S('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" opacity=".55"/>'),
  high: S('<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".18"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.8 12.4l2.8 2.8 5.6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  // 採点：完答（二重丸）・一部正解（三角）・不正解（×）
  full: S('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="currentColor" stroke-width="2"/>'),
  part: S('<path d="M12 3.8l8.6 15.4H3.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  none: S('<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  ok: S('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
  ng: S('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  self: S('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 7.5l3 3" stroke="currentColor" stroke-width="1.8"/>'),
  hint: S('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'),
  cases: S('<path d="M5 4v16M5 7h4M5 17h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 7h7M12 17h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  sound: S('<path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
};

// ---------------------------------------------------------------- 効果音（音声ファイルを使わず合成）
let ctx = null;
let soundOn = true;
export function setSound(on) { soundOn = on; }
function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, start, dur, { type = 'sine', gain = 0.16, glide = null } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
export function play(name) {
  if (!soundOn) return;
  try {
    switch (name) {
      case 'correct': tone(1046.5, 0, 0.16); tone(1318.5, 0.09, 0.32); break;            // ド→ミ
      case 'full': tone(784, 0, 0.14); tone(1046.5, 0.08, 0.16); tone(1318.5, 0.16, 0.42); break;
      case 'part': tone(659.3, 0, 0.18, { gain: 0.12 }); tone(784, 0.1, 0.3, { gain: 0.12 }); break;
      case 'wrong': tone(233, 0, 0.26, { type: 'triangle', gain: 0.2, glide: 175 }); break;
      case 'tap': tone(1600, 0, 0.04, { gain: 0.05 }); break;
      case 'finish': [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.4, { gain: 0.12 })); break;
      case 'bird': tone(660, 0, 0.12, { gain: 0.05, glide: 880 }); tone(880, 0.12, 0.16, { gain: 0.045, glide: 620 }); break;   // にゃ
    }
  } catch { /* 音が出せない環境 */ }
}

// ---------------------------------------------------------------- テーマ（自動・ライト・ダーク）
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
  const dark = mode === 'dark' || (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#16171b' : '#f6f4ee'));
}

// ---------------------------------------------------------------- 猫「シュレ」（シュレーディンガーの猫から）
// 丸いしろ猫（オリジナル）。色はテーマに合わせて CSS 変数から（変数名は受験数学版の鳥のまま）
export const BIRD_SVG = `<svg viewBox="0 0 64 64" class="bird-svg" aria-hidden="true">
  <path d="M47 50c8 1 12-4 11-10-1-4-4-5-6-3 2 1 3 3 2 6-1 3-4 4-8 3z" fill="var(--bird-dark)"/>
  <ellipse cx="31" cy="44" rx="17" ry="14" fill="var(--bird-body)"/>
  <ellipse cx="31" cy="48" rx="10" ry="8.5" fill="var(--bird-belly)"/>
  <path d="M12 12l4 14 11-6z" fill="var(--bird-body)"/><path d="M50 12l-4 14-11-6z" fill="var(--bird-body)"/>
  <path d="M14.5 16l2.6 8.5 6.4-3.6z" fill="var(--bird-cheek)" opacity=".75"/><path d="M47.5 16l-2.6 8.5-6.4-3.6z" fill="var(--bird-cheek)" opacity=".75"/>
  <ellipse cx="31" cy="28" rx="19" ry="15" fill="var(--bird-body)"/>
  <path d="M24 15c2 3 2 5 1 7M31 14v7M38 15c-2 3-2 5-1 7" stroke="var(--bird-dark)" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".8"/>
  <ellipse cx="23.5" cy="28.5" rx="2.6" ry="3.2" fill="var(--bird-eye)"/><circle cx="24.3" cy="27.4" r=".9" fill="#fff"/>
  <ellipse cx="38.5" cy="28.5" rx="2.6" ry="3.2" fill="var(--bird-eye)"/><circle cx="39.3" cy="27.4" r=".9" fill="#fff"/>
  <path d="M29.6 33h2.8L31 34.6z" fill="var(--bird-beak)"/>
  <path d="M31 34.6c-.6 1.6-2.2 2-3.3 1.2M31 34.6c.6 1.6 2.2 2 3.3 1.2" stroke="var(--bird-beak)" stroke-width="1" fill="none" stroke-linecap="round"/>
  <ellipse cx="18.5" cy="34" rx="3" ry="1.8" fill="var(--bird-cheek)" opacity=".6"/><ellipse cx="43.5" cy="34" rx="3" ry="1.8" fill="var(--bird-cheek)" opacity=".6"/>
  <path d="M9 31l7 1.5M9 35.5l7-.5M53 31l-7 1.5M53 35.5l-7-.5" stroke="var(--bird-dark)" stroke-width=".9" stroke-linecap="round" opacity=".55"/>
  <path d="M23 57.5v-3M39 57.5v-3" stroke="var(--bird-dark)" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
</svg>`;

export const BIRD_NAME = 'シュレ';

const HEALTH = [
  'お身体は大丈夫ですか？ 肩に力が入っていたら、一度深呼吸しましょう。',
  '水分はとっていますか？ のどが渇く前に一口どうぞ。',
  '20分ごとに、20秒ほど遠くを見ると目が楽になります。',
  '背中が丸まっていませんか？ 画面は目の高さに近づけて。',
  '眠気が強いときは、5〜15分の短い仮眠も手です。',
];
const ADVICE = [
  '解説を読み返すより、閉じてもう一度解いてみる方が記憶に残ります（想起練習）。',
  '同じ問題を一気にやるより、日をあけて解き直す方が長持ちします（分散学習）。',
  '分野を混ぜて解くと「どの解法を使うか」を選ぶ力がつきます。',
  '間違えた問題は宝です。どこで道を誤ったか、1行で書いておこう。',
  '答えを見る前に「なぜその方針か」を説明してみると、理解が深まります。',
  '自信があったのに外した問題は、検算の習慣で防げます。',
  '解けない問題は、条件を1つ外した易しい問題から考えてみよう。',
  '眠っている間に記憶は整理されます。夜ふかしより、早めに寝る方が得です。',
  '計算はスピードより正確さから。正確になれば速さは後からついてきます。',
  '図やグラフを描くと、式だけでは見えない構造が見えてきます。',
  '答えが出たら、次元（単位）と極限（質量→0、角度→0 など）で確かめよう。',
  '最初に図を描き、座標の取り方と正の向きを決めておくと、符号のミスが減ります。',
  '保存量や対称性を探すと、運動方程式を正面から解かずに済むことがよくあります。',
  '数値を入れる前に文字のまま解き切ると、検算も応用も楽になります。',
];
const QUOTES = [
  ['自然という書物は、数学の言葉で書かれている。', 'ガリレオ・ガリレイ（趣意）'],
  ['想像力は知識よりも重要である。', 'アルベルト・アインシュタイン'],
  ['自分で作れないものは、理解しているとはいえない。', 'リチャード・ファインマン'],
  ['第一の原則は、自分をだまさないこと。そして自分こそ、いちばんだましやすい人間なのだ。', 'リチャード・ファインマン'],
  ['答えがわかるまで、計算を始めてはいけない。', 'ジョン・ホイーラー（とされる）'],
  ['専門家とは、ごく狭い分野で、ありうる間違いをすべてやりつくした人のことだ。', 'ニールス・ボーア（とされる）'],
  ['ふしぎだと思うこと、これが科学の芽です。', '朝永振一郎'],
  ['千里の行も足下に始まる。', '老子'],
  ['学びて思わざれば則ち罔し、思いて学ばざれば則ち殆し。', '孔子『論語』'],
  ['解けない問題があるなら、それより易しくて解ける問題がある。それを見つけよ。', 'ジョージ・ポリア'],
];

export function birdMessage(kind, ctxInfo = {}) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const h = new Date().getHours();
  if (kind === 'late') return 'もう遅い時間です。今日はここまでにして、ぐっすり眠ろう。睡眠中に記憶が整理されます。';
  if (kind === 'break') return ctxInfo.min >= 50
    ? `${ctxInfo.min}分続けて勉強しています。お身体は大丈夫ですか？ 5〜10分、立って体を伸ばしましょう。`
    : `${ctxInfo.min}分たちました。少し目を閉じて休憩しませんか？`;
  if (kind === 'summary') {
    const { solo = 0, missed = 0, n = 0 } = ctxInfo;
    if (n && solo === n) return '全部自力で解けました！ 次は難易度を1つ上げてみては？';
    if (n && missed >= n / 2) return '難しかったですね。でも、難しく感じた日の方があとで伸びます。間違えた問題は近いうちにまた出します。';
    return 'おつかれさま。間違えたところは、復習で必ず取り返せます。';
  }
  if (kind === 'greet') {
    const g = h < 5 ? 'こんばんは。夜遅くまでおつかれさま。' : h < 11 ? 'おはようございます。' : h < 18 ? 'こんにちは。' : 'こんばんは。';
    const r = Math.random();
    if (r < 0.3) return g + pick(HEALTH);
    if (r < 0.7) return g + pick(ADVICE);
    const q = pick(QUOTES); return `${g}今日のことば：「${q[0]}」（${q[1]}）`;
  }
  const r = Math.random();
  if (r < 0.3) return pick(HEALTH);
  if (r < 0.65) return pick(ADVICE);
  const q = pick(QUOTES); return `「${q[0]}」\n― ${q[1]}`;
}
