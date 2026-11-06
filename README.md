# Honest Gin

Gin Rummy for the browser, with a deck you can check and an opponent that can't see your cards. It works on Mac, iPhone and iPad, and installs as an app (PWA) with offline play.

## Why it can't be rigged

1. **The deck is fixed before the deal.** Each hand starts from a 256-bit seed made by your device's secure random generator. The full 52-card order comes from that seed, and `SHA-256(seed)` (the 🔒 lock) is shown before any card is dealt. After that, nothing can reorder the stock.
2. **The seed is revealed after every hand.** The app checks the seed against the lock and rebuilds the deck from it. You can also check it yourself with `tools/verify.py` (see below).
3. **The opponent plays blind.** The AI only ever gets the object built by `aiView()` in `engine.js`: its own cards, the discard pile, the cards you picked up from the discard pile, and the stock count. It never gets your hand or the stock order. Its reasoning for each hand is shown afterwards.
4. **Same rules for both players.** Every move, yours or the AI's, goes through the same rule functions.

### Shuffle algorithm

The shuffle is a Fisher–Yates shuffle over the deck `AS 2S … KS AH … KH AD … KD AC … KC` (spades, hearts, diamonds, clubs; ace to king in each suit). The random numbers come from `SHA-256(seed + ":" + i)` for `i = 0, 1, 2, …`, read as big-endian 32-bit words. Rejection sampling keeps the shuffle unbiased.

Cards are dealt from the start of the list: one to the non-dealer, one to the dealer, alternating, until each player has 10. The 21st card is the upcard, and the stock is drawn in order after that.

## Verify a hand yourself

```sh
python3 tools/verify.py <seed>
```

This prints the lock and the full deck order. Compare them with what the game showed.

## Run locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. In Safari, File → Add to Dock installs it on your Mac.

## Host on GitHub Pages

1. Push this repo to GitHub. Pages needs a public repository on a free plan.
2. In the repo, open Settings → Pages, choose Source: **Deploy from a branch**, then **main** and **/ (root)**.
3. After a minute or two the game is live at `https://<user>.github.io/<repo>/`.
4. On iPhone or iPad, open that address in Safari, then Share → **Add to Home Screen**.

When you change any file, bump `VERSION` in `sw.js` so installed copies download the new version.

## Files

| File | Purpose |
|---|---|
| `index.html` | UI |
| `engine.js` | Rules, SHA-256, committed shuffle, scoring, AI |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icon-*.png` | App install metadata |
| `tools/verify.py` | Independent deck verifier |

## Rules

Standard Gin Rummy:

- **Upcard:** the non-dealer can take the first upcard or pass, then the dealer. If both pass, the non-dealer draws from the stock.
- **Knocking:** you can knock once your deadwood is 10 or less.
- **Gin:** 25 bonus plus the opponent's deadwood. **Big Gin** (all 11 cards melded): 31 plus the opponent's deadwood.
- **Undercut:** if the defender's deadwood is equal to or less than the knocker's, the defender scores 25 plus the difference.
- **Laying off:** the defender can lay off cards onto the knocker's melds, except against gin.
- **Dead hand:** if two cards are left in the stock and nobody has knocked, the hand scores nothing and the same dealer deals again.
- **Game:** first to 100 (configurable). The winner gets a 100 game bonus, both players get 25 per hand won, and a shutout doubles the winner's total.
