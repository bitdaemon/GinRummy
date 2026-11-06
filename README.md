# Honest Gin

**Gin Rummy where the deck can be checked and the opponent can't see your cards.**

Honest Gin is a free, single-player Gin Rummy game against a computer opponent. It runs in any modern browser and installs as an app on Mac, iPhone and iPad. Once installed, it works fully offline.

It was built as an answer to card games that *feel* rigged, where the opponent always seems to know what you're holding or draws the exact card it needs. Here you don't have to take fairness on trust. Every hand can be checked.

---

## Contents

- [Features](#features)
- [How fairness works](#how-fairness-works)
- [How to play](#how-to-play)
- [Rules of Gin Rummy](#rules-of-gin-rummy)
- [Playing offline (PWA)](#playing-offline-pwa)
- [Install it](#install-it)
- [Run or host it yourself](#run-or-host-it-yourself)
- [Verify a hand yourself](#verify-a-hand-yourself)
- [Project structure](#project-structure)
- [License](#license)

---

## Features

- **Provably fair deck.** Each deck order is locked in before the deal and revealed after the hand.
- **An opponent that plays blind.** The computer never sees your hand or the stock.
- **Three difficulty levels:** Easy, Normal and Hard.
- **Opponent reasoning.** After every hand you can read why the opponent made each move.
- **Seen-cards chart.** It shows you exactly the information the opponent has: the discard pile and the cards you've picked up from it.
- **Automatic meld detection.** Your hand is grouped into melds, and your deadwood is counted live.
- **Full standard scoring:** knock, gin, big gin, undercut, layoffs, box bonus, game bonus and shutout.
- **Statistics,** including a luck tracker that compares your average starting hand with the opponent's.
- **Saved progress.** If you close the app mid-hand, you continue where you left off.
- **Animated play.** The deal, every draw, the opponent's moves and every discard are animated, so you can follow what's happening. Speed can be set to Off, Fast, Normal or Slow.
- **Customisable look.** Choose the table colour (presets or any custom colour), the card face style (Classic, Modern, Jumbo for small screens, Vintage), the card back colour and pattern, and optional four-colour suits.
- **Works offline,** with no account, no ads, no tracking and no server.

---

## How fairness works

### 1. The deck is fixed before the deal
At the start of every hand the game creates a random 256-bit **seed** using your device's secure random number generator (`crypto.getRandomValues`). The complete order of all 52 cards comes from that seed.

Before any card is dealt, the game shows the seed's **SHA-256 fingerprint**, the 🔒 *lock*. Once the lock is shown, the deck can't be changed. That rules out slipping the opponent a perfect card, or keeping the card you need away from you.

### 2. The seed is revealed after the hand
When the hand ends, the game reveals the seed and checks two things:

- ✓ SHA-256 of the seed matches the lock shown before the deal.
- ✓ Rebuilding the deck from the seed gives exactly the cards that were dealt and drawn.

You don't have to trust the app's own check. `tools/verify.py` rebuilds the deck independently (see [Verify a hand yourself](#verify-a-hand-yourself)).

### 3. The opponent only knows what a human opponent would know
The computer player's code only ever receives this information (built by `aiView()` in `engine.js`):

| The opponent knows | The opponent never knows |
|---|---|
| Its own cards | Your hand |
| The discard pile | The order of the stock |
| The cards you picked up from the discard pile | The seed |
| How many cards are left in the stock | |

Its decisions are logged with a plain-language reason for each move, for example "Took 7♥, it fits a meld (deadwood 17 → 10)". The log is shown after every hand.

### 4. Same rules for both players
Every move, yours and the opponent's, goes through the same rule functions in `engine.js`.

---

## How to play

| Action | How |
|---|---|
| Draw from the stock | Tap the face-down **Stock** pile |
| Take the top discard | Tap the **Discard** pile |
| Discard a card | Tap a card to select it, then tap it again (or tap the Discard pile) |
| Knock or go Gin | Select the card to discard, then press **Knock** or **Gin!** |
| Big Gin | Press **Big Gin!** when all 11 cards are melded |
| Pass on the first upcard | Press **Pass** |
| Sort your deadwood | **Deadwood by suit / rank**. Melds and sets always stay grouped on the left; only the deadwood is re-sorted |
| See what's known | **Seen cards** |
| Settings, stats, rules | **☰** menu |
| Table, cards, animation speed | **☰** menu → **Appearance & animation speed** |

The 🔒 line under the piles shows the current hand's lock. Tap it for the full fairness explanation.

---

## Rules of Gin Rummy

### Goal
Form your cards into **melds** and get your unmatched cards (**deadwood**) as low as possible. Then knock to end the hand before your opponent does.

### The deal
- Each player gets **10 cards**. The deal alternates between you and the computer.
- The next card is turned face up to start the **discard pile** (the *upcard*). The rest form the face-down **stock**.

### Melds
- **Set:** 3 or 4 cards of the same rank, such as 7♠ 7♥ 7♦.
- **Run:** 3 or more cards in sequence in the same suit, such as 4♣ 5♣ 6♣. The ace is **low only**: A-2-3 is a run, but Q-K-A is not.
- Each card can belong to only one meld.

### Card values (deadwood)
| Card | Value |
|---|---|
| Ace | 1 |
| 2 – 10 | Face value |
| Jack, Queen, King | 10 |

### The first upcard
1. The non-dealer may take the upcard or pass.
2. If they pass, the dealer may take it or pass.
3. If both pass, the non-dealer starts by drawing from the stock.

### A normal turn
1. **Draw** one card, either the top of the stock or the top of the discard pile.
2. **Discard** one card face up.

You can't discard the same card you just picked up from the discard pile.

### Ending the hand
- **Knock:** if your deadwood is **10 or less** after discarding, you may knock. Your discard goes face down and both hands are shown.
- **Gin:** knocking with **0 deadwood**.
- **Big Gin:** all **11 cards** melded right after drawing, so no discard is needed.

### Laying off
When you knock (without gin), your opponent may **lay off** their deadwood cards onto your melds to reduce their count. For example, they can add 8♣ to your 5♣ 6♣ 7♣, or the fourth 9 to your three 9s. No laying off is allowed against Gin or Big Gin.

### Scoring a hand
| Result | Points |
|---|---|
| **Knock** (knocker has less deadwood) | Knocker scores the difference in deadwood |
| **Undercut** (defender's deadwood is equal or lower) | Defender scores **25** + the difference |
| **Gin** | **25** + opponent's deadwood |
| **Big Gin** | **31** + opponent's deadwood |

### Dead hand
If only **two cards** remain in the stock and nobody has knocked, the hand is cancelled with no score. The same dealer deals again.

### Winning the game
The first player to reach the target score (**100** by default; 50 or 150 can be chosen in the menu) wins the game. Final scoring:

- **Game bonus:** +100 to the winner.
- **Box bonus:** +25 to each player for every hand they won.
- **Shutout:** if the loser didn't win a single hand, the winner's total is doubled.

---

## Playing offline (PWA)

Honest Gin is a **Progressive Web App (PWA)**. You open it from a web address like any website, but you can install it on your device like an app.

When you first open it from a hosted address, a small **service worker** (`sw.js`) saves the whole game to your device. From then on:

- **It works with no internet connection:** on a plane, on the train, or in airplane mode.
- **It opens full-screen** from its own icon, without browser bars.
- **It loads instantly,** because everything comes from the local cache.
- **Your game and stats are saved** on the device. Nothing is sent anywhere.

The game has no server component at all. Shuffling, the opponent and scoring all run on your device, so playing offline works exactly the same as playing online.

Offline mode needs the game to be served over **HTTPS** (or `localhost`), as on GitHub Pages. Opening `index.html` directly as a file still lets you play, but it won't install or cache for offline use.

---

## Install it

### iPhone / iPad
1. Open the game's address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch it from the new **Honest Gin** icon.

### Mac
1. Open the game's address in **Safari**.
2. Choose **File** → **Add to Dock**.

Chrome or Edge on Mac and Windows: click the **install icon** in the address bar.

### Android
Open the address in **Chrome**, then tap **⋮** → **Install app** (or **Add to Home screen**).

Each device keeps its own saved game and statistics.

---

## Run or host it yourself

There's no build step and there are no dependencies. It's plain HTML, CSS and JavaScript.

### Locally
```sh
python3 -m http.server 8000
```
Open <http://localhost:8000>.

### GitHub Pages
1. Push this repository to GitHub. Pages needs a public repository on a free plan.
2. Go to **Settings → Pages**. Under Source choose **Deploy from a branch**, then **main** and **/ (root)**, and click **Save**.
3. After a minute or two the game is live at `https://<your-username>.github.io/<repository-name>/`.

### Updating
When you change any file, bump `VERSION` in `sw.js` (e.g. `honest-gin-v1` → `honest-gin-v2`). Installed copies then download the new version.

---

## Verify a hand yourself

After a hand, tap **Copy seed** on the results screen, then run:

```sh
python3 tools/verify.py <seed>
```

It prints:
- `lock:` this should match the lock that was shown before the deal.
- `deck:` the full deck order, which you can compare with what happened in the hand.

The **Fairness** screen in the menu also lists the seeds of recent hands.

**How the deck is built:**

1. Start from `AS 2S … KS AH … KH AD … KD AC … KC`.
2. Shuffle it with **Fisher–Yates**. The random numbers come from `SHA-256(seed + ":" + i)` for `i = 0, 1, 2, …`, read as big-endian 32-bit words. Rejection sampling keeps every order equally likely.
3. Deal from the start of the list: one card to the non-dealer, one to the dealer, alternating, until each has 10.
4. The 21st card is the upcard, and the stock is drawn in order after that.

---

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Game interface: table, cards, menus, results screens |
| `engine.js` | Game logic: SHA-256, committed shuffle, meld finding, layoffs, scoring, the computer opponent |
| `sw.js` | Service worker that caches the game for offline play |
| `manifest.webmanifest` | App name, colours and icons used when installing |
| `icon-180.png`, `icon-192.png`, `icon-512.png` | App icons |
| `tools/verify.py` | Independent deck verifier (Python 3, standard library only) |

---

## A note on how this was built

This is a vibe-coded project. I designed what it should do (a deck locked before the deal and revealed afterwards, an opponent that only sees what a human opponent would, how melds and deadwood are laid out, the animations and the look), and I tested it by playing it on my own Mac and phone, but most of the code was written with an AI assistant.

The fairness parts can be checked without trusting the app: `tools/verify.py` rebuilds any hand's deck from its seed using nothing but Python's standard library. During development the shuffle was also checked for bias over tens of thousands of shuffles, and the rules engine was run through thousands of computer-vs-computer hands. Those checks aren't in this repository yet, though, and the code hasn't had a professional code review. If you spot something off, please open an issue.

---

## License

MIT. See [LICENSE](LICENSE).
