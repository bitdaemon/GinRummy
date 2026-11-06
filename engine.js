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
  // Skill levels. noise: random error added to each discard choice; miss: chance of overlooking a useful discard;
  // knockP: chance it knocks the moment it can; pot/dan: weight on keeping live cards / avoiding feeding you;
  // look: look one draw ahead (Hard).
  const LEVELS = {
    beginner: { noise: 9, miss: 0.2, knockP: 0.85, pot: 0, dan: 0, look: false, label: 'Beginner' },
    easy:     { noise: 3, miss: 0.2, knockP: 1, pot: 0, dan: 0, look: false, label: 'Easy' },
    normal:   { noise: 0.5, miss: 0, knockP: 1, pot: 0.4, dan: 0.8, look: false, label: 'Normal' },
    hard:     { noise: 0.1, miss: 0, knockP: 1, pot: 0, dan: 1.2, look: true, label: 'Hard',
                lookW: 1, wk: 30, wg: 0, safety: 3, bigSave: 0 },
  };
  const lvl = view => LEVELS[view.difficulty] || LEVELS.normal;
  function knockThreshold(view) {
    const L = lvl(view);
    if (!L.knockAt) return 10;
    for (const [stock, t] of L.knockAt) if (view.stockCount >= stock) return t;
    return 10;
  }
  // Hard: chance the opponent can put this card straight into a meld, worked out only from what it has seen:
  // cards it knows are in the opponent's hand, and how many unseen cards could be there.
  function feedChance(c, view, unseen) {
    const known = new Set(view.oppPicked), un = new Set(unseen);
    const hidden = Math.max(0, 10 - view.oppPicked.length), p = unseen.length ? Math.min(1, hidden / unseen.length) : 0;
    const prob = id => known.has(id) ? 1 : un.has(id) ? p : 0;
    const r = R(c), s = S(c), card = (rr, ss) => (rr >= 1 && rr <= 13) ? RANKS[rr - 1] + ss : null;
    // set: at least two of the other three of this rank
    const ps = SUITS.filter(x => x !== s).map(x => prob(card(r, x)));
    const pNone = ps.reduce((a, q) => a * (1 - q), 1);
    const pOne = ps.reduce((a, q, i) => a + q * ps.reduce((b, q2, j) => j === i ? b : b * (1 - q2), 1), 0);
    const pSet = 1 - pNone - pOne;
    // run: any pair of same-suit neighbours that makes a three-card run with it
    let pNoRun = 1;
    for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
      const ca = card(r + a, s), cb = card(r + b, s);
      if (ca && cb) pNoRun *= 1 - prob(ca) * prob(cb);
    }
    let f = 1 - (1 - pSet) * pNoRun;
    if (view.oppDiscarded.some(x => R(x) === r || (S(x) === s && Math.abs(R(x) - r) === 1))) f *= 0.6;
    return f;
  }
  // Hard: expected deadwood after the next draw from the stock, over the cards it hasn't seen.
  function lookAhead(rest, unseen, thr) {
    const now = bestDw(rest);
    let sum = 0, knock = 0, gin = 0;
    for (const x of unseen) {
      const a = best(rest.concat(x));
      const after = Math.min(now, a.dead.length ? a.dw - Math.max(...a.dead.map(V)) : 0);
      sum += after; if (after <= thr) knock++; if (after === 0) gin++;
    }
    const n = unseen.length || 1;
    return { ev: unseen.length ? sum / n : now, pk: knock / n, pg: gin / n };
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
    const L = lvl(view);
    const canKnock = minDw <= 10 && minDw <= thr && rand() < L.knockP;
    if (canKnock) {
      const opts = evals.filter(e => e.dw === minDw);
      const e = opts[0];
      return { card: e.c, knock: true, reason: `Knocked with ${minDw} deadwood (its rule: knock at ≤ ${thr}).` };
    }
    if (L.look) {
      // Only look ahead for the most promising few discards (keeps it fast on phones).
      const shortlist = evals.slice().sort((a, b) => a.dw - b.dw).slice(0, 5);
      for (const e of shortlist) Object.assign(e, lookAhead(hand.filter(x => x !== e.c), unseen, thr));
      for (const e of evals) if (e.ev == null) e.ev = e.dw;
    }
    if (L.safety) for (const e of evals) e.feed = feedChance(e.c, view, unseen);
    const scored = evals.map(e => ({ e, s: (L.look ? (1 - L.lookW) * e.dw + L.lookW * e.ev : e.dw)
      - L.pot * e.pot + L.dan * e.dan + (L.safety ? L.safety * e.feed : 0)
      - (L.look ? (L.wk || 0) * (e.pk || 0) + (L.wg || 0) * (e.pg || 0) : 0) + rand() * L.noise }));
    scored.sort((a, b) => a.s - b.s);
    const e = scored[0].e;
    let why = `kept deadwood at ${e.dw}`;
    if (L.look && e.ev != null && e.ev < e.dw) why += ` (expects about ${e.ev.toFixed(1)} after its next draw)`;
    if (L.safety && e.feed != null && evals.some(x => x.feed > e.feed + 0.15)) why += `, choosing a card you're unlikely to use`;
    if (L.dan > 0) {
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
    const L = lvl(view);
    if (!take && L.look && bestAfter <= knockThreshold(view) && nowDw > knockThreshold(view)) {
      take = true; why = `${label(top)} lets it knock right away`;
    }
    if (!take && L.bigSave && nowDw - bestAfter >= L.bigSave) {
      take = true; why = `${label(top)} cuts its deadwood from ${nowDw} to ${bestAfter}`;
    }
    if (take && L.miss && rand() < L.miss) { take = false; why = `missed that ${label(top)} would help`; }
    const mm = MEMORY[view.memory];
    if (take && mm && rand() < mm.miss) { take = false; why = `overlooked that ${label(top)} would help`; }
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
      tick: 0, when: { [deck[20]]: 0 }, pickWhen: {}, memSalt: newSeed(),
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
    if (h.pickWhen) h.pickWhen[c] = h.tick || 0;
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
    h.tick = (h.tick || 0) + 1; if (h.when) h.when[c] = h.tick;
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

  // ---------- Opponent memory ----------
  // How likely the AI still remembers a public card, by its age in turns (one turn = one discard).
  // 'disc': buried cards in the discard pile, 'pick': cards its opponent took from the discard pile,
  // 'oppDisc': cards its opponent threw away. The top discard is always visible.
  const MEMORY = {
    perfect: null,
    human: { disc: a => a <= 3 ? 1 : Math.pow(0.82, a - 3), pick: a => a <= 6 ? 1 : Math.pow(0.9, a - 6),
             oppDisc: a => a <= 3 ? 1 : Math.pow(0.8, a - 3), misremember: 0.3, miss: 0.12 },
    forgetful: { disc: a => a <= 1 ? 1 : Math.pow(0.45, a - 1), pick: a => a <= 2 ? 1 : Math.pow(0.6, a - 2),
                 oppDisc: a => a <= 1 ? 1 : Math.pow(0.45, a - 1), misremember: 0.3, miss: 0.25 },
  };
  // Fixed per hand and card (from a separate random salt, never the deck seed), so once forgotten, a card stays forgotten.
  const memU = (salt, kind, c) => parseInt(sha256hex(salt + ':' + kind + ':' + c).slice(0, 8), 16) / 4294967296;

  // The ONLY thing the AI is given. No stock order, no opponent hand — and only the public cards it still remembers.
  function aiView(g, p, difficulty, memory) {
    const h = g.hand, m = MEMORY[memory] || null, tick = h.tick || 0, salt = h.memSalt || '';
    let discardPile = h.discard.slice(), oppPicked = h.picked[1 - p].slice(), oppDiscarded = h.discards[1 - p].slice();
    const misremembered = [];
    if (m && h.when) {
      const top = discardPile[discardPile.length - 1], mine = new Set(h.hands[p]);
      const age = c => tick - (h.when[c] || 0);
      discardPile = discardPile.filter(c => c === top || memU(salt, 'd', c) < m.disc(age(c)));
      oppDiscarded = oppDiscarded.filter(c => c === top || memU(salt, 'o', c) < m.oppDisc(age(c)));
      const kept = [];
      for (const c of oppPicked) {
        if (memU(salt, 'p', c) < m.pick(tick - ((h.pickWhen || {})[c] || 0))) { kept.push(c); continue; }
        if (memU(salt, 'x', c) < m.misremember) { // remembers it wrongly: a neighbouring rank in the same suit
          const r = R(c) + (memU(salt, 'y', c) < 0.5 ? -1 : 1);
          const alt = r >= 1 && r <= 13 ? RANKS[r - 1] + S(c) : null;
          if (alt && !mine.has(alt) && alt !== top && !kept.includes(alt)) { kept.push(alt); misremembered.push([c, alt]); }
        }
      }
      oppPicked = kept;
    }
    return Object.freeze({ hand: h.hands[p].slice(), discardPile, oppPicked, oppDiscarded, misremembered,
      stockCount: h.stock.length, mustStock: h.mustStock, takenFromDiscard: h.taken, difficulty, memory: memory || 'perfect' });
  }
  // Performs one AI action for player p. Returns {kind, card, reason}.
  function aiAct(g, p, difficulty, memory) {
    const h = g.hand, v = aiView(g, p, difficulty, memory);
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
    sha256hex, MEMORY, LEVELS, deckFromSeed, newSeed, freshDeck, R, S, V, SYM, RANKS, SUITS, label,
    findMelds, bestArrangements, best, bestDw, layOff, defenderBest, resolveKnock, BONUS,
    aiDiscard, aiDraw, aiUpcard, unseenCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Gin = api;
})(typeof window !== 'undefined' ? window : globalThis);
