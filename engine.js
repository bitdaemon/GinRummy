/* Honest Gin — game engine
 * - Deck is shuffled ONCE per hand from a secret seed, and SHA-256(seed) is shown before the deal.
 *   The seed is revealed after the hand so the whole deck order can be checked independently.
 * - The AI only ever receives `view` objects built by aiView(): its own hand, the public discard
 *   pile, the cards you visibly took from the discard pile, and how many cards are left in the stock.
 *   It never sees your hand or the stock order.
 */
(function (root) {
  'use strict';

  // ---------- SHA-256 (pure JS, so it works offline and over plain http too) ----------
  const K = [], H0 = [];
  (function () {
    const frac = x => ((x - Math.floor(x)) * 4294967296) >>> 0;
    let n = 2;
    while (K.length < 64) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime) { if (H0.length < 8) H0.push(frac(Math.sqrt(n))); K.push(frac(Math.cbrt(n))); }
      n++;
    }
  })();
  function sha256(msg) {
    const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
    const l = bytes.length, padLen = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 4, (l * 8) >>> 0); dv.setUint32(padLen - 8, Math.floor(l / 536870912));
    const H = H0.slice(), w = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    H.forEach((v, i) => { out[i * 4] = v >>> 24; out[i * 4 + 1] = (v >>> 16) & 255; out[i * 4 + 2] = (v >>> 8) & 255; out[i * 4 + 3] = v & 255; });
    return out;
  }
  const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const sha256hex = s => toHex(sha256(s));

  // ---------- Cards ----------
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = 'A23456789TJQK';
  const SYM = { S: '♠\uFE0E', H: '♥\uFE0E', D: '♦\uFE0E', C: '♣\uFE0E' };
  const R = id => RANKS.indexOf(id[0]) + 1;
  const S = id => id[1];
  const V = id => Math.min(R(id), 10);
  const label = id => (id[0] === 'T' ? '10' : id[0]) + SYM[id[1]];
  const freshDeck = () => { const d = []; for (const s of SUITS) for (const r of RANKS) d.push(r + s); return d; };

  function newSeed() {
    const b = new Uint8Array(32);
    (root.crypto || require('crypto').webcrypto).getRandomValues(b);
    return toHex(b);
  }

  // Fisher–Yates driven by SHA-256(seed + ":" + counter), rejection-sampled so every order is equally likely.
  function deckFromSeed(seed) {
    const d = freshDeck();
    let words = [], i = 0;
    const next = () => {
      if (!words.length) {
        const h = sha256(seed + ':' + i); i++;
        for (let k = 0; k < 32; k += 4) words.push(((h[k] << 24) >>> 0) + (h[k + 1] << 16) + (h[k + 2] << 8) + h[k + 3]);
      }
      return words.shift();
    };
    for (let j = 51; j > 0; j--) {
      const n = j + 1, lim = Math.floor(4294967296 / n) * n;
      let u; do { u = next(); } while (u >= lim);
      const r = u % n; const t = d[j]; d[j] = d[r]; d[r] = t;
    }
    return d;
  }

  // ---------- Melds & deadwood ----------
  function findMelds(hand) {
    const melds = [], byRank = {};
    for (const c of hand) (byRank[R(c)] = byRank[R(c)] || []).push(c);
    for (const r in byRank) {
      const g = byRank[r];
      if (g.length === 4) { melds.push(g.slice()); for (let i = 0; i < 4; i++) melds.push(g.filter((_, j) => j !== i)); }
      else if (g.length === 3) melds.push(g.slice());
    }
    for (const s of SUITS) {
      const cs = hand.filter(c => S(c) === s).sort((a, b) => R(a) - R(b));
      for (let i = 0; i < cs.length; i++) {
        let j = i;
        while (j + 1 < cs.length && R(cs[j + 1]) === R(cs[j]) + 1) j++;
        for (let a = i; a <= j; a++) for (let b = a + 2; b <= j; b++) melds.push(cs.slice(a, b + 1));
        i = j;
      }
    }
    return melds;
  }

  // Calls cb(meldsChosen, deadCards, deadwood) for every non-overlapping combination of melds.
  function forEachArrangement(hand, cb) {
    const idx = new Map(hand.map((c, i) => [c, i]));
    const melds = findMelds(hand).map(m => ({ cards: m, mask: m.reduce((x, c) => x | (1 << idx.get(c)), 0), val: m.reduce((s, c) => s + V(c), 0) }));
    const total = hand.reduce((s, c) => s + V(c), 0);
    const chosen = [];
    (function rec(k, used, dw) {
      cb(chosen, used, dw, melds);
      for (let i = k; i < melds.length; i++) {
        if (melds[i].mask & used) continue;
        chosen.push(i); rec(i + 1, used | melds[i].mask, dw - melds[i].val); chosen.pop();
      }
    })(0, 0, total);
  }
  function materialize(hand, chosen, used, melds) {
    return { melds: chosen.map(i => melds[i].cards.slice()), dead: hand.filter((c, i) => !(used & (1 << i))) };
  }
  // All arrangements with minimum deadwood (capped).
  function bestArrangements(hand, cap = 48) {
    let best = Infinity, out = [];
    forEachArrangement(hand, (chosen, used, dw, melds) => {
      if (dw < best) { best = dw; out = [materialize(hand, chosen, used, melds)]; }
      else if (dw === best && out.length < cap) out.push(materialize(hand, chosen, used, melds));
    });
    out.forEach(a => a.dw = best);
    return out;
  }
  const best = hand => bestArrangements(hand, 1)[0];
  function bestDw(hand) { let b = Infinity; forEachArrangement(hand, (c, u, dw) => { if (dw < b) b = dw; }); return b; }

  // ---------- Layoffs ----------
  function describeMeld(m) {
    if (m.every(c => R(c) === R(m[0]))) return { set: true, r: R(m[0]), n: m.length };
    const rs = m.map(R); return { set: false, s: S(m[0]), lo: Math.min(...rs), hi: Math.max(...rs) };
  }
  function layOff(knockMelds, dead) {
    const ms = knockMelds.map(describeMeld);
    let rem = dead.slice(); const laid = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of rem) {
        for (let i = 0; i < ms.length && !changed; i++) {
          const m = ms[i]; let ok = false;
          if (m.set) { if (R(c) === m.r && m.n < 4) { m.n++; ok = true; } }
          else if (S(c) === m.s) { if (R(c) === m.lo - 1) { m.lo--; ok = true; } else if (R(c) === m.hi + 1) { m.hi++; ok = true; } }
          if (ok) { laid.push({ card: c, meld: i }); rem = rem.filter(x => x !== c); changed = true; }
        }
        if (changed) break;
      }
    }
    return { rem, laid };
  }
  // Defender's best result: try every arrangement of their own melds, then lay off what's left.
  function defenderBest(knockMelds, hand) {
    let res = null;
    forEachArrangement(hand, (chosen, used, dw, melds) => {
      const a = materialize(hand, chosen, used, melds);
      const lo = layOff(knockMelds, a.dead);
      const d = lo.rem.reduce((s, c) => s + V(c), 0);
      if (!res || d < res.dw) res = { melds: a.melds, laid: lo.laid, dead: lo.rem, dw: d };
    });
    return res;
  }

  const BONUS = { gin: 25, bigGin: 31, undercut: 25, game: 100, box: 25 };

  // knockerHand: 10 cards (or 11 for big gin), defHand: 10 cards
  function resolveKnock(knockerHand, defHand, bigGin) {
    const arrs = bestArrangements(knockerHand);
    let bestRes = null;
    for (const k of arrs) {
      let r;
      if (k.dw === 0) {
        const d = best(defHand);
        r = { type: bigGin ? 'bigGin' : 'gin', knocker: k, defender: { melds: d.melds, laid: [], dead: d.dead, dw: d.dw } };
        r.winner = 'knocker'; r.points = (bigGin ? BONUS.bigGin : BONUS.gin) + d.dw;
      } else {
        const d = defenderBest(k.melds, defHand);
        r = { knocker: k, defender: d };
        if (d.dw > k.dw) { r.type = 'knock'; r.winner = 'knocker'; r.points = d.dw - k.dw; }
        else { r.type = 'undercut'; r.winner = 'defender'; r.points = BONUS.undercut + (k.dw - d.dw); }
      }
      const score = r.winner === 'knocker' ? r.points : -r.points;
      if (!bestRes || score > bestRes._s) { bestRes = r; r._s = score; }
    }
    delete bestRes._s;
    return bestRes;
  }

  // ---------- AI (receives only a view; see aiView in the UI) ----------
  function unseenCards(view) {
    const known = new Set([...view.hand, ...view.discardPile, ...view.oppPicked]);
    return freshDeck().filter(c => !known.has(c));
  }
  // How many unseen cards could turn this card into part of a meld with what's in `hand`.
  function potential(c, hand, unseen) {
    const un = new Set(unseen), r = R(c), s = S(c);
    const has = (rr, ss) => rr >= 1 && rr <= 13 && hand.includes(RANKS[rr - 1] + ss);
    const live = (rr, ss) => rr >= 1 && rr <= 13 && un.has(RANKS[rr - 1] + ss);
    let p = 0;
    const sameRank = hand.filter(x => x !== c && R(x) === r).length;
    const rankLive = SUITS.filter(ss => live(r, ss)).length;
    if (sameRank >= 1) p += rankLive; else p += rankLive / 3;
    if (has(r - 1, s)) p += (live(r - 2, s) ? 1 : 0) + (live(r + 1, s) ? 1 : 0);
    if (has(r + 1, s)) p += (live(r - 1, s) ? 1 : 0) + (live(r + 2, s) ? 1 : 0);
    if (has(r - 2, s) && !has(r - 1, s)) p += live(r - 1, s) ? 1 : 0;
    if (has(r + 2, s) && !has(r + 1, s)) p += live(r + 1, s) ? 1 : 0;
    if (!has(r - 1, s) && !has(r + 1, s) && !has(r - 2, s) && !has(r + 2, s)) p += ((live(r - 1, s) ? 1 : 0) + (live(r + 1, s) ? 1 : 0)) / 3;
    return p;
  }
  // Does the opponent seem to want this card? Based only on what they took / threw away in public.
  function danger(c, view) {
    const r = R(c), s = S(c); let d = 0;
    for (const x of view.oppPicked) {
      if (R(x) === r) d += 2;
      if (S(x) === s && Math.abs(R(x) - r) <= 2) d += 2;
    }
    for (const x of view.oppDiscarded) {
      if (R(x) === r) d -= 1;
      if (S(x) === s && Math.abs(R(x) - r) === 1) d -= 1;
    }
    return d;
  }
  function knockThreshold(view) {
    if (view.difficulty !== 'hard') return 10;
    if (view.stockCount >= 20) return 10;
    if (view.stockCount >= 12) return 8;
    return 5;
  }
  const rand = () => Math.random();

  // Called with an 11-card hand.
  function aiDiscard(view) {
    const hand = view.hand, unseen = unseenCards(view), diff = view.difficulty;
    const cands = hand.filter(c => c !== view.takenFromDiscard);
    // Big gin
    if (bestDw(hand) === 0) return { bigGin: true, reason: 'All 11 cards melded — Big Gin.' };
    const evals = cands.map(c => {
      const rest = hand.filter(x => x !== c), a = best(rest);
      const pot = a.dead.reduce((s, x) => s + potential(x, rest, unseen), 0);
      return { c, dw: a.dw, pot, dan: danger(c, view) };
    });
    const minDw = Math.min(...evals.map(e => e.dw));
    const thr = knockThreshold(view);
    if (minDw === 0) {
      const e = evals.find(e => e.dw === 0);
      return { card: e.c, knock: true, gin: true, reason: `Discarded ${label(e.c)} face down and went Gin.` };
    }
    const canKnock = minDw <= 10 && (diff === 'easy' ? rand() < 0.85 : minDw <= thr);
    if (canKnock) {
      const opts = evals.filter(e => e.dw === minDw);
      const e = opts[0];
      return { card: e.c, knock: true, reason: `Knocked with ${minDw} deadwood (its rule: knock at ≤ ${thr}).` };
    }
    let scored;
    if (diff === 'easy') scored = evals.map(e => ({ e, s: e.dw + rand() * 9 }));
    else if (diff === 'normal') scored = evals.map(e => ({ e, s: e.dw - 0.4 * e.pot + 0.8 * e.dan + rand() * 0.5 }));
    else scored = evals.map(e => ({ e, s: e.dw - 0.8 * e.pot + 1.8 * e.dan + rand() * 0.2 }));
    scored.sort((a, b) => a.s - b.s);
    const e = scored[0].e;
    let why = `kept deadwood at ${e.dw}`;
    if (diff !== 'easy') {
      if (e.dan < 0) why += ', and you seemed not to want that kind of card';
      else if (evals.some(x => x.dw === e.dw && x.dan > e.dan)) why += ', avoiding cards you looked like you were collecting';
    }
    return { card: e.c, knock: false, reason: `Discarded ${label(e.c)} — ${why}.` };
  }

  // Called with a 10-card hand; decides stock vs discard top.
  function aiDraw(view) {
    const top = view.discardPile[view.discardPile.length - 1];
    if (view.mustStock || !top) return { from: 'stock', reason: 'Drew from the stock.' };
    const hand = view.hand, nowDw = bestDw(hand), withTop = hand.concat(top);
    let bestAfter = Infinity, bestArr = null;
    for (const c of hand) {
      const rest = withTop.filter(x => x !== c), a = best(rest);
      if (a.dw < bestAfter) { bestAfter = a.dw; bestArr = a; }
    }
    const melded = bestArr && bestArr.melds.some(m => m.includes(top));
    let take = melded && bestAfter < nowDw;
    let why = take ? `${label(top)} fits a meld (deadwood ${nowDw} → ${bestAfter})` : `${label(top)} didn't help`;
    if (!take && view.difficulty === 'hard' && bestAfter <= knockThreshold(view) && nowDw > knockThreshold(view)) {
      take = true; why = `${label(top)} lets it knock right away`;
    }
    if (take && view.difficulty === 'easy' && rand() < 0.2) { take = false; why = `missed that ${label(top)} would help`; }
    return take ? { from: 'discard', reason: `Took ${label(top)} — ${why}.` } : { from: 'stock', reason: `Drew from the stock — ${why}.` };
  }

  function aiUpcard(view) {
    const d = aiDraw(Object.assign({}, view, { mustStock: false }));
    return d.from === 'discard' ? { take: true, reason: d.reason } : { take: false, reason: `Passed on the upcard — ${label(view.discardPile[view.discardPile.length - 1])} didn't help.` };
  }

  // ---------- Game state machine (players 0 = you, 1 = AI) ----------
  function startHand(g) {
    const seed = newSeed(), deck = deckFromSeed(seed);
    const nd = 1 - g.dealer, hands = [[], []]; let k = 0;
    for (let i = 0; i < 10; i++) { hands[nd].push(deck[k++]); hands[g.dealer].push(deck[k++]); }
    const discard = [deck[k++]];
    g.handNo = (g.handNo || 0) + 1;
    g.hand = { seed, commit: sha256hex(seed), deck, hands, discard, stock: deck.slice(k), turn: nd, phase: 'upcard',
      passes: 0, mustStock: false, taken: null, picked: [[], []], discards: [[], []], lastDrawn: [null, null],
      aiLog: [], startDw: [bestDw(hands[0]), bestDw(hands[1])], result: null };
    return g.hand;
  }
  function check(h, p, phases) {
    if (h.phase === 'over') return 'Hand is over.';
    if (h.turn !== p) return 'Not your turn.';
    if (!phases.includes(h.phase)) return 'Not allowed right now.';
    return null;
  }
  function takeDiscard(g, p) {
    const h = g.hand, e = check(h, p, ['upcard', 'draw']); if (e) return e;
    if (h.mustStock) return 'You must draw from the stock this turn.';
    const c = h.discard.pop(); h.hands[p].push(c); h.taken = c; h.picked[p].push(c); h.lastDrawn[p] = c;
    h.phase = 'discard'; return null;
  }
  function pass(g, p) {
    const h = g.hand, e = check(h, p, ['upcard']); if (e) return e;
    h.passes++;
    if (h.passes === 1) h.turn = 1 - p;
    else { h.turn = 1 - g.dealer; h.phase = 'draw'; h.mustStock = true; }
    return null;
  }
  function drawStock(g, p) {
    const h = g.hand, e = check(h, p, ['draw']); if (e) return e;
    const c = h.stock.shift(); h.hands[p].push(c); h.taken = null; h.mustStock = false; h.lastDrawn[p] = c;
    h.phase = 'discard'; return null;
  }
  function removeCard(arr, c) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); return i >= 0; }
  function discardCard(g, p, c) {
    const h = g.hand, e = check(h, p, ['discard']); if (e) return e;
    if (!h.hands[p].includes(c)) return 'Card not in hand.';
    if (c === h.taken) return "You can't discard the card you just took from the discard pile.";
    removeCard(h.hands[p], c); h.discard.push(c); h.discards[p].push(c); removeCard(h.picked[p], c);
    h.taken = null; h.lastDrawn[p] = null;
    if (h.stock.length <= 2) { h.phase = 'over'; h.result = { type: 'draw' }; }
    else { h.turn = 1 - p; h.phase = 'draw'; }
    return null;
  }
  function finish(g, p, res) {
    const h = g.hand;
    res.knockerP = p;
    res.winnerP = res.winner === 'knocker' ? p : 1 - p;
    h.phase = 'over'; h.result = res;
  }
  function knock(g, p, c) {
    const h = g.hand, e = check(h, p, ['discard']); if (e) return e;
    if (!h.hands[p].includes(c)) return 'Card not in hand.';
    if (c === h.taken) return "You can't discard the card you just took from the discard pile.";
    const rest = h.hands[p].filter(x => x !== c);
    if (bestDw(rest) > 10) return 'You need 10 or less deadwood to knock.';
    h.hands[p] = rest; h.knockCard = c; h.lastDrawn[p] = null;
    finish(g, p, resolveKnock(rest, h.hands[1 - p], false));
    return null;
  }
  function bigGin(g, p) {
    const h = g.hand, e = check(h, p, ['discard']); if (e) return e;
    if (h.hands[p].length !== 11 || bestDw(h.hands[p]) !== 0) return 'Not Big Gin.';
    finish(g, p, resolveKnock(h.hands[p], h.hands[1 - p], true));
    return null;
  }
  // Apply a finished hand to the match score. Returns final-game summary if the game ended.
  function applyResult(g) {
    const r = g.hand.result;
    if (r && r.type !== 'draw') { g.scores[r.winnerP] += r.points; g.handsWon[r.winnerP]++; }
    if (!r || r.type !== 'draw') g.dealer = 1 - g.dealer; // dealer alternates; a dead hand is redealt by the same dealer
    const target = g.target || 100;
    if (g.scores[0] >= target || g.scores[1] >= target) {
      const w = g.scores[0] >= target ? 0 : 1;
      const tot = [0, 1].map(p => g.scores[p] + BONUS.box * g.handsWon[p] + (p === w ? BONUS.game : 0));
      const shutout = g.handsWon[1 - w] === 0;
      if (shutout) tot[w] *= 2;
      g.over = { winner: w, totals: tot, shutout };
      return g.over;
    }
    return null;
  }

  // The ONLY thing the AI is given. No stock order, no opponent hand.
  function aiView(g, p, difficulty) {
    const h = g.hand;
    return Object.freeze({ hand: h.hands[p].slice(), discardPile: h.discard.slice(), oppPicked: h.picked[1 - p].slice(),
      oppDiscarded: h.discards[1 - p].slice(), stockCount: h.stock.length, mustStock: h.mustStock,
      takenFromDiscard: h.taken, difficulty });
  }
  // Performs one AI action for player p. Returns {kind, card, reason}.
  function aiAct(g, p, difficulty) {
    const h = g.hand, v = aiView(g, p, difficulty);
    let out;
    if (h.phase === 'upcard') {
      const top = h.discard[h.discard.length - 1], d = aiUpcard(v);
      out = d.take ? { kind: 'takeUp', card: top, reason: d.reason } : { kind: 'pass', card: top, reason: d.reason };
      d.take ? takeDiscard(g, p) : pass(g, p);
    } else if (h.phase === 'draw') {
      const top = h.discard[h.discard.length - 1], d = aiDraw(v);
      if (d.from === 'discard') { takeDiscard(g, p); out = { kind: 'takeDiscard', card: top, reason: d.reason }; }
      else { drawStock(g, p); out = { kind: 'drawStock', reason: d.reason }; }
    } else if (h.phase === 'discard') {
      const d = aiDiscard(v);
      if (d.bigGin) { bigGin(g, p); out = { kind: 'bigGin', reason: d.reason }; }
      else if (d.knock) { knock(g, p, d.card); out = { kind: d.gin ? 'gin' : 'knock', card: d.card, reason: d.reason }; }
      else { discardCard(g, p, d.card); out = { kind: 'discard', card: d.card, reason: d.reason }; }
    }
    if (out) h.aiLog.push(out.reason);
    return out;
  }

  const api = { startHand, takeDiscard, pass, drawStock, discardCard, knock, bigGin, applyResult, aiView, aiAct,
    sha256hex, deckFromSeed, newSeed, freshDeck, R, S, V, SYM, RANKS, SUITS, label,
    findMelds, bestArrangements, best, bestDw, layOff, defenderBest, resolveKnock, BONUS,
    aiDiscard, aiDraw, aiUpcard, unseenCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Gin = api;
})(typeof window !== 'undefined' ? window : globalThis);
