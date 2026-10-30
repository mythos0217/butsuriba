// 間隔反復スケジューラ（FSRS の考え方を簡略化したもの）と、今日のセットの組み立て
// 記憶の安定度 S（日）と難しさ D（1〜10）を解法カードごとに持つ。
// 想起確率 R(t) = 1 / (1 + t / (9S))。R が 0.9 を切ったら復習（t = S 日後）。

import { CARDS, PROBLEMS, UNITS, cardById, problemsFor, unitOf, subjectOf } from './content.js';

// 新しいカードの導入順：単元を巡回して、科目が偏らないようにする
const CARD_ORDER = (() => {
  const byUnit = UNITS.map(u => CARDS.filter(c => c.unit === u.id));
  const out = [];
  for (let i = 0; out.length < CARDS.length; i++) for (const list of byUnit) if (list[i]) out.push(list[i]);
  return out;
})();

export const FILE_VERSION = '0.6.0';
const DAY = 86400000;
const INIT_S = { 1: 0.4, 2: 1.2, 3: 3, 4: 8 }; // 初回の評価ごとの安定度（日）
export const TARGET_R = 0.9;

export function retrievability(st, now = Date.now()) {
  if (!st || !st.reps) return 0;
  const t = Math.max(0, (now - st.last) / DAY);
  return 1 / (1 + t / (9 * st.S));
}

export function dueAt(st) { return st.last + st.S * DAY; }

// grade: 1 = 解けなかった / 2 = ヒントを使って解けた / 3 = 自力で解けた / 4 = 自信をもって即答
export function review(st, grade, now = Date.now()) {
  if (!st || !st.reps) {
    return { S: INIT_S[grade], D: Math.min(10, Math.max(1, 5 - (grade - 3) * 1.5)), last: now, reps: 1, lapses: grade === 1 ? 1 : 0 };
  }
  const R = retrievability(st, now);
  let S;
  if (grade === 1) {
    S = Math.max(0.3, st.S * 0.3);
  } else {
    const mult = { 2: 0.6, 3: 1, 4: 1.4 }[grade];
    const growth = Math.E * (11 - st.D) * Math.pow(st.S, -0.2) * (Math.exp(1 - R) - 1) * mult;
    S = st.S * (1 + Math.max(0.05, growth));
  }
  const D = Math.min(10, Math.max(1, st.D - 0.8 * (grade - 3)));
  return { S, D, last: now, reps: st.reps + 1, lapses: st.lapses + (grade === 1 ? 1 : 0) };
}

export function cardStatus(st, now = Date.now()) {
  if (!st || !st.reps) return 'new';
  if (st.S >= 21) return 'solid';
  return retrievability(st, now) < TARGET_R ? 'due' : 'learning';
}

export function isUnlocked(card, cards) {
  return card.pre.every(id => cards[id] && cards[id].reps > 0);
}

function shuffle(a, rand = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// カードの練習に使う問題を選ぶ：最後に解いてから最も時間が経った問題（初回は易しい順）
function pickProblem(cardId, state, used, first) {
  const cands = problemsFor(cardId).filter(p => !used.has(p.id));
  if (!cands.length) return null;
  if (first) return cands.slice().sort((a, b) => a.level - b.level)[0];
  return cands.slice().sort((a, b) => ((state.problems[a.id] || {}).last || 0) - ((state.problems[b.id] || {}).last || 0) || Math.random() - 0.5)[0];
}

// 単元が連続しないように並べ替える（交互練習）
function interleave(items) {
  const out = [];
  const pool = shuffle(items.slice());
  while (pool.length) {
    const prevUnit = out.length ? out[out.length - 1].unit : null;
    let i = pool.findIndex(it => it.unit !== prevUnit);
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// 今日のセット：期限の来たカード（忘れかけ順）＋新しいカード（前提を満たすもの）
export function buildSession(state, { size = 6, newPerDay = 2, now = Date.now(), focusCard = null } = {}) {
  const used = new Set();
  const blocks = [];
  if (focusCard) {
    const p = pickProblem(focusCard, state, used, false);
    if (p) blocks.push({ unit: unitOf(p), steps: [{ kind: 'problem', pid: p.id, card: focusCard }] });
    return blocks.flatMap(b => b.steps);
  }
  const due = CARDS
    .filter(c => state.cards[c.id] && state.cards[c.id].reps > 0)
    .map(c => ({ c, R: retrievability(state.cards[c.id], now) }))
    .filter(x => x.R < TARGET_R)
    .sort((a, b) => a.R - b.R);
  const newToday = state.newIntroduced && state.newIntroduced.date === dayKey(now) ? state.newIntroduced.count : 0;
  const fresh = CARD_ORDER.filter(c => !(state.cards[c.id] && state.cards[c.id].reps > 0) && isUnlocked(c, state.cards))
    .slice(0, Math.max(0, newPerDay - newToday));

  const dueSlots = Math.max(2, size - fresh.length * 2); // 入りきらない復習は次回・追加演習へ
  for (const { c } of due.slice(0, dueSlots)) {
    const p = pickProblem(c.id, state, used, false);
    if (!p) continue;
    used.add(p.id);
    blocks.push({ unit: c.unit, steps: [{ kind: 'problem', pid: p.id, card: c.id }] });
  }
  for (const c of fresh) {
    if (blocks.reduce((n, b) => n + b.steps.length, 0) >= size + 2) break;
    const p = pickProblem(c.id, state, used, true);
    if (!p) continue;
    used.add(p.id);
    // 新しい解法は「導入 → 易しい問題」をまとめて出す（初学はブロック練習のほうが効く）
    blocks.push({ unit: c.unit, steps: [{ kind: 'intro', cid: c.id }, { kind: 'problem', pid: p.id, card: c.id, fresh: c.id }] });
  }
  return interleave(blocks).flatMap(b => b.steps);
}

// 期限前でも演習したいとき：定着度の低い順に追加で出す
export function buildExtra(state, { size = 5, now = Date.now() } = {}) {
  const learned = CARDS.filter(c => state.cards[c.id] && state.cards[c.id].reps > 0)
    .map(c => ({ c, R: retrievability(state.cards[c.id], now) }))
    .sort((a, b) => a.R - b.R)
    .slice(0, size);
  const used = new Set();
  const blocks = [];
  for (const { c } of learned) {
    const p = pickProblem(c.id, state, used, false);
    if (!p) continue;
    used.add(p.id);
    blocks.push({ unit: c.unit, steps: [{ kind: 'problem', pid: p.id, card: c.id }] });
  }
  return interleave(blocks).flatMap(b => b.steps);
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function countDue(state, now = Date.now()) {
  return CARDS.filter(c => state.cards[c.id] && state.cards[c.id].reps > 0 && retrievability(state.cards[c.id], now) < TARGET_R).length;
}

export function nextDueTime(state) {
  const ts = CARDS.filter(c => state.cards[c.id] && state.cards[c.id].reps > 0).map(c => dueAt(state.cards[c.id]));
  return ts.length ? Math.min(...ts) : null;
}

export { PROBLEMS, cardById };

// 分野選択・ランダム演習：条件に合う問題から、未着手・久しぶりのものを優先して選び、単元を混ぜて並べる
export function buildPractice(state, { units = null, levels = null, size = 8 } = {}) {
  const pool = PROBLEMS.filter(p => (!units || units.includes(unitOf(p))) && (!levels || levels.includes(p.level)));
  const scored = pool.map(p => {
    const rec = state.problems[p.id];
    return { p, key: rec ? rec.last : -1e15 + Math.random() * 1e12 };
  }).sort((a, b) => a.key - b.key);
  const picked = scored.slice(0, size).map(x => x.p);
  const blocks = picked.map(p => ({ unit: unitOf(p), steps: [{ kind: 'problem', pid: p.id, card: p.cards[0] }] }));
  return interleave(blocks).flatMap(b => b.steps);
}

export function poolSize({ units = null, levels = null } = {}) {
  return PROBLEMS.filter(p => (!units || units.includes(unitOf(p))) && (!levels || levels.includes(p.level))).length;
}
