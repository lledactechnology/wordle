````markdown
# Solo Mode Optimal Guess Review — Full Implementation Plan

## Goal

Add a solo-mode post-game review where, after the player either solves the puzzle or fails after 6 guesses, they can choose to see:

1. The most optimal word they could have played at each guess.
2. How optimal their actual guess was.
3. How many possible answers remained before and after each guess.
4. A simple rating such as `Excellent`, `Strong`, `Decent`, or `Weak`.

This should only appear **after solo mode ends**, not during the round, so it does not spoil the answer.

---

## Current Solo Mode Behavior

Currently, solo mode:

- Picks a random target word from `targetWords`.
- Resets the board.
- Shows the game screen.
- Sets the timer to `∞`.
- Displays a simple `Solo Play` leaderboard entry.
- Uses `handleSolo(g)` to calculate feedback, update the board, and either show a solved/fail alert or reset to menu after a delay. :contentReference[oaicite:0]{index=0}

The current HTML has screens for menu, game, god mode, round end, and game end, but there is no dedicated solo results or solo analysis screen yet. :contentReference[oaicite:1]{index=1}

---

# Recommended UX Flow

## 1. User plays solo normally

No analysis is shown during the game.

## 2. User solves or fails

Instead of immediately calling:

```js
setTimeout(resetToMenu, 5000);
````

show a new **Solo Results** screen.

Example:

```text
Solved in 4 guesses!

The word was: CRANE

[View Optimal Play]
[Play Again]
[Back to Menu]
```

If failed:

```text
Out of guesses!

The word was: CRANE

[View Optimal Play]
[Play Again]
[Back to Menu]
```

## 3. User clicks “View Optimal Play”

Show a detailed review table:

```text
Guess 1: ADIEU
Rating: Decent — 72% optimal
Your guess ranked #843 out of 12,947 possible guesses.
Best word: SLATE
Possible answers before guess: 2,315
Possible answers after your guess: 184
Best word expected remaining: 63.2
Your word expected remaining: 87.4
```

Then repeat for each guess.

---

# Core Concept

At each guess, calculate the best word based only on the information the player had **before** making that guess.

For example:

```text
Before Guess 1:
Possible answers = all target words

Player guessed: ADIEU

System checks every allowed guess:
- SLATE
- CRANE
- ADIEU
- TRACE
- ...
```

Each possible guess is scored by how well it splits the remaining possible answers into smaller groups.

The best guess is the one that leaves the lowest expected number of possible answers.

---

# Definition of “Optimal”

Use this as the main metric:

```js
expectedRemaining =
  sum((bucketSize * bucketSize) / totalPossibleAnswers)
```

Where:

* Each bucket represents a possible feedback pattern.
* Smaller `expectedRemaining` means a better information-gathering guess.
* The best word is the one with the lowest `expectedRemaining`.

Example:

```text
SLATE:
Expected remaining answers: 51.2

CRANE:
Expected remaining answers: 56.8

ADIEU:
Expected remaining answers: 88.3
```

So `SLATE` would be considered the most optimal guess.

---

# Files to Update

## 1. `index.html`

Add a new solo results screen near the existing game end screen.

```html
<!-- Solo End Screen -->
<div data-solo-end class="solo-end hidden">
  <div class="solo-end-content">
    <h2 data-solo-end-title></h2>

    <div class="word-reveal">
      The word was: <strong data-solo-word></strong>
    </div>

    <div class="word-definition" data-solo-word-definition></div>

    <div class="solo-summary" data-solo-summary></div>

    <div class="solo-end-actions">
      <button data-view-optimal-play-btn class="menu-btn primary">
        View Optimal Play
      </button>
      <button data-solo-play-again-btn class="menu-btn">
        Play Again
      </button>
      <button data-solo-back-menu-btn class="menu-btn">
        Back to Menu
      </button>
    </div>

    <div data-solo-analysis class="solo-analysis hidden">
      <h3>Optimal Play Review</h3>
      <div data-solo-analysis-list></div>
    </div>
  </div>
</div>
```

Also update `showScreen(sc)` in `script.js` to include the new screen:

```js
const soloEndScreen = document.querySelector('[data-solo-end]');
```

Then:

```js
function showScreen(sc) {
  const m = {
    menu: mainMenu,
    createRoom: createRoomModal,
    joinRoom: joinRoomModal,
    lobby,
    game: gameScreen,
    godMode: godModeScreen,
    roundEnd: roundEndScreen,
    gameEnd: gameEndScreen,
    soloEnd: soloEndScreen,
  };

  Object.values(m).forEach(s => s && s.classList.add('hidden'));

  if (m[sc]) m[sc].classList.remove('hidden');

  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
}
```

---

## 2. `script.js`

Add new solo-mode state variables.

```js
let soloGuessHistory = [];
let soloAnalysisCache = null;
```

Each guess should be stored as:

```js
{
  guess: 'adieu',
  feedback: ['wrong', 'wrong-location', 'wrong', 'correct', 'wrong'],
  attemptNumber: 1,
  solved: false
}
```

---

# Solo Mode Flow Changes

## Update `startSolo()`

Current solo mode already chooses a random word and resets the game. Add history reset:

```js
function startSolo() {
  if (!targetWords || !targetWords.length) {
    showAlert('Word list not loaded. Refresh and try again.', 3000);
    return;
  }

  if (ws) {
    try { ws.close(); } catch(e) {}
    ws = null;
  }

  isSoloMode = true;
  gameState = 'playing';
  currentRow = 0;
  currentGuess = [];
  roundSolved = false;
  myGameComplete = false;

  soloTargetWord = targetWords[Math.floor(Math.random() * targetWords.length)];

  soloGuessHistory = [];
  soloAnalysisCache = null;

  resetBoard();
  showScreen('game');

  document.querySelector('[data-round-num]').textContent = '1';
  document.querySelector('[data-total-rounds]').textContent = '1';

  if (timerDisplay) {
    timerDisplay.textContent = '∞';
    timerDisplay.classList.remove('warning', 'danger');
  }

  if (leaderboardList) {
    leaderboardList.innerHTML =
      '<div class="leaderboard-entry"><span>Solo Play</span></div>';
  }
}
```

---

## Update `handleSolo(g)`

After calculating feedback, store the guess.

Current solo mode already uses `calcFb(g, soloTargetWord)` to calculate feedback. Reuse that same function for the analysis engine so solo feedback and optimal-review feedback stay consistent. 

Add this after:

```js
const fb = calcFb(g, soloTargetWord);
const solved = g === soloTargetWord;
```

```js
soloGuessHistory.push({
  guess: g,
  feedback: fb,
  attemptNumber: currentRow + 1,
  solved,
});
```

Then replace the current solved/fail `showAlert(...)` and `setTimeout(resetToMenu, 5000)` behavior with:

```js
if (solved) {
  roundSolved = true;

  for (let i = 0; i < WL; i++) {
    const t = guessGrid.children[currentRow * WL + i];
    setTimeout(() => {
      t.classList.add('dance');
      t.addEventListener('animationend', () => t.classList.remove('dance'), {
        once: true,
      });
    }, i * 100);
  }

  setTimeout(() => {
    showSoloEnd(true);
  }, 1200);

} else if (currentRow >= WR - 1) {
  roundSolved = true;

  setTimeout(() => {
    showSoloEnd(false);
  }, 800);
}

currentRow++;
currentGuess = [];
```

---

# New Function: `showSoloEnd(won)`

```js
function showSoloEnd(won) {
  gameState = 'soloEnd';

  const title = document.querySelector('[data-solo-end-title]');
  const word = document.querySelector('[data-solo-word]');
  const summary = document.querySelector('[data-solo-summary]');
  const analysis = document.querySelector('[data-solo-analysis]');
  const analysisList = document.querySelector('[data-solo-analysis-list]');

  if (title) {
    title.textContent = won
      ? 'Solved in ' + soloGuessHistory.length + ' guesses!'
      : 'Out of guesses!';
  }

  if (word) {
    word.textContent = soloTargetWord.toUpperCase();
  }

  const def = wordDefinitions[soloTargetWord] || null;
  renderSoloDefinition(def);

  if (summary) {
    summary.innerHTML = won
      ? '<p>You solved the puzzle. Want to see how close your guesses were to optimal?</p>'
      : '<p>You did not solve this one. Review the optimal path to see what would have narrowed it down faster.</p>';
  }

  if (analysis) analysis.classList.add('hidden');
  if (analysisList) analysisList.innerHTML = '';

  showScreen('soloEnd');
}
```

---

# New Function: `renderSoloDefinition(definition)`

You already have `renderDefinition(definition)` for the round-end definition area. Use a solo-specific version so it targets the solo screen.

```js
function renderSoloDefinition(definition) {
  const el = document.querySelector('[data-solo-word-definition]');
  if (!el) return;

  if (definition && definition.found && definition.definition) {
    el.innerHTML =
      '<em>' + esc(definition.partOfSpeech || 'word') + ':</em> ' +
      esc(definition.definition);
  } else {
    el.innerHTML = '<em>No definition available for this word yet.</em>';
  }
}
```

---

# Optimal Analysis Engine

## Function 1: Convert feedback to a stable pattern string

```js
function feedbackToPattern(feedback) {
  return feedback.join('|');
}
```

Example:

```js
['wrong', 'correct', 'wrong-location', 'wrong', 'wrong']
```

becomes:

```text
wrong|correct|wrong-location|wrong|wrong
```

---

## Function 2: Filter possible answers after a guess

```js
function filterPossibleAnswers(possibleAnswers, guess, feedback) {
  const targetPattern = feedbackToPattern(feedback);

  return possibleAnswers.filter(answer => {
    const pattern = feedbackToPattern(calcFb(guess, answer));
    return pattern === targetPattern;
  });
}
```

This means:

> Keep only the answers that would have produced the same feedback if they were the real answer.

---

## Function 3: Score a single guess

```js
function scoreGuessByExpectedRemaining(guess, possibleAnswers) {
  const buckets = {};
  const total = possibleAnswers.length;

  for (const answer of possibleAnswers) {
    const pattern = feedbackToPattern(calcFb(guess, answer));
    buckets[pattern] = (buckets[pattern] || 0) + 1;
  }

  const bucketSizes = Object.values(buckets);

  const expectedRemaining = bucketSizes.reduce((sum, size) => {
    return sum + (size * size) / total;
  }, 0);

  const worstCaseRemaining = Math.max(...bucketSizes);
  const guaranteedSolveChance = possibleAnswers.includes(guess)
    ? 1 / total
    : 0;

  return {
    guess,
    expectedRemaining,
    worstCaseRemaining,
    bucketCount: bucketSizes.length,
    guaranteedSolveChance,
  };
}
```

---

## Function 4: Rank all candidate guesses

Use `dictionary + targetWords` as allowed guesses, but deduplicate it.

```js
function getAllowedAnalysisGuesses() {
  return [...new Set([...dictionary, ...targetWords])];
}
```

Then:

```js
function rankOptimalGuesses(possibleAnswers, allowedGuesses) {
  const ranked = allowedGuesses.map(guess => {
    return scoreGuessByExpectedRemaining(guess, possibleAnswers);
  });

  ranked.sort((a, b) => {
    if (a.expectedRemaining !== b.expectedRemaining) {
      return a.expectedRemaining - b.expectedRemaining;
    }

    if (a.worstCaseRemaining !== b.worstCaseRemaining) {
      return a.worstCaseRemaining - b.worstCaseRemaining;
    }

    const aIsAnswer = possibleAnswers.includes(a.guess);
    const bIsAnswer = possibleAnswers.includes(b.guess);

    if (aIsAnswer !== bIsAnswer) {
      return aIsAnswer ? -1 : 1;
    }

    return a.guess.localeCompare(b.guess);
  });

  return ranked;
}
```

Tie-break order:

1. Lowest expected remaining answers.
2. Lowest worst-case remaining answers.
3. Prefer actual possible answers.
4. Alphabetical fallback.

---

# Main Review Function

```js
function analyzeSoloGame() {
  if (soloAnalysisCache) return soloAnalysisCache;

  const allowedGuesses = getAllowedAnalysisGuesses();
  let possibleAnswers = [...targetWords];

  const review = [];

  for (const entry of soloGuessHistory) {
    const possibleBefore = possibleAnswers.length;

    const ranked = rankOptimalGuesses(possibleAnswers, allowedGuesses);

    const userRankIndex = ranked.findIndex(r => r.guess === entry.guess);
    const userRank = userRankIndex >= 0 ? userRankIndex + 1 : null;

    const best = ranked[0];
    const userScore = userRankIndex >= 0
      ? ranked[userRankIndex]
      : scoreGuessByExpectedRemaining(entry.guess, possibleAnswers);

    const possibleAfter = filterPossibleAnswers(
      possibleAnswers,
      entry.guess,
      entry.feedback
    );

    const optimalityPercent = calculateOptimalityPercent(
      best.expectedRemaining,
      userScore.expectedRemaining
    );

    review.push({
      attemptNumber: entry.attemptNumber,
      guess: entry.guess,
      feedback: entry.feedback,
      solved: entry.solved,

      possibleBefore,
      possibleAfter: possibleAfter.length,

      bestGuess: best.guess,
      bestExpectedRemaining: best.expectedRemaining,
      bestWorstCaseRemaining: best.worstCaseRemaining,

      userRank,
      totalRanked: ranked.length,
      userExpectedRemaining: userScore.expectedRemaining,
      userWorstCaseRemaining: userScore.worstCaseRemaining,

      optimalityPercent,
      rating: getOptimalityRating(optimalityPercent),

      topSuggestions: ranked.slice(0, 5),
    });

    possibleAnswers = possibleAfter;
  }

  soloAnalysisCache = review;
  return review;
}
```

---

# Optimality Percentage

```js
function calculateOptimalityPercent(bestExpected, userExpected) {
  if (!Number.isFinite(bestExpected) || !Number.isFinite(userExpected)) {
    return 0;
  }

  if (userExpected <= 0) return 100;

  return Math.max(
    0,
    Math.min(100, Math.round((bestExpected / userExpected) * 100))
  );
}
```

Example:

```text
Best expected remaining: 40
User expected remaining: 50

40 / 50 = 0.8

Optimality = 80%
```

---

# Rating Labels

```js
function getOptimalityRating(percent) {
  if (percent >= 95) return 'Excellent';
  if (percent >= 85) return 'Strong';
  if (percent >= 70) return 'Decent';
  if (percent >= 50) return 'Weak';
  return 'Poor';
}
```

Suggested colors:

```text
Excellent: green
Strong: blue/teal
Decent: yellow
Weak: orange
Poor: red
```

---

# Rendering the Review

## Button handler

Add event binding near the existing event bindings in `script.js`.

```js
document
  .querySelector('[data-view-optimal-play-btn]')
  ?.addEventListener('click', () => {
    renderSoloAnalysis();
  });

document
  .querySelector('[data-solo-play-again-btn]')
  ?.addEventListener('click', () => {
    startSolo();
  });

document
  .querySelector('[data-solo-back-menu-btn]')
  ?.addEventListener('click', () => {
    resetToMenu();
  });
```

---

## `renderSoloAnalysis()`

```js
function renderSoloAnalysis() {
  const analysis = document.querySelector('[data-solo-analysis]');
  const list = document.querySelector('[data-solo-analysis-list]');
  if (!analysis || !list) return;

  const review = analyzeSoloGame();

  list.innerHTML = '';

  review.forEach(item => {
    const card = document.createElement('div');
    card.className =
      'solo-analysis-card rating-' + item.rating.toLowerCase();

    card.innerHTML = `
      <div class="solo-analysis-header">
        <span class="solo-attempt">Guess ${item.attemptNumber}</span>
        <span class="solo-guess">${esc(item.guess.toUpperCase())}</span>
        <span class="solo-rating">${esc(item.rating)} — ${item.optimalityPercent}%</span>
      </div>

      <div class="solo-analysis-grid">
        <div>
          <strong>Your Rank</strong>
          <span>#${item.userRank || '?'} / ${item.totalRanked}</span>
        </div>

        <div>
          <strong>Best Word</strong>
          <span>${esc(item.bestGuess.toUpperCase())}</span>
        </div>

        <div>
          <strong>Possible Before</strong>
          <span>${item.possibleBefore}</span>
        </div>

        <div>
          <strong>Possible After Your Guess</strong>
          <span>${item.possibleAfter}</span>
        </div>

        <div>
          <strong>Your Expected Remaining</strong>
          <span>${item.userExpectedRemaining.toFixed(1)}</span>
        </div>

        <div>
          <strong>Best Expected Remaining</strong>
          <span>${item.bestExpectedRemaining.toFixed(1)}</span>
        </div>
      </div>

      <details class="solo-top-suggestions">
        <summary>Top suggested words</summary>
        <ol>
          ${item.topSuggestions.map(s => `
            <li>
              <strong>${esc(s.guess.toUpperCase())}</strong>
              — expected ${s.expectedRemaining.toFixed(1)},
              worst case ${s.worstCaseRemaining}
            </li>
          `).join('')}
        </ol>
      </details>
    `;

    list.appendChild(card);
  });

  analysis.classList.remove('hidden');
}
```

---

# Performance Considerations

## The expensive part

Ranking every allowed guess against every possible answer can be heavy.

If:

```text
allowed guesses ≈ 12,000
possible answers ≈ 2,300
```

Then guess 1 requires roughly:

```text
12,000 × 2,300 = 27.6 million feedback calculations
```

That may cause a short freeze in the browser.

## Recommended first implementation

For the first version, calculate the analysis only after the user clicks:

```text
View Optimal Play
```

Not immediately when solo mode ends.

Also show a temporary message:

```text
Analyzing your game...
```

Then run the analysis.

## Better implementation

Use one of these:

### Option A: Limit analysis guesses

Only rank words from `targetWords`.

This is faster and still useful.

```js
const allowedGuesses = [...targetWords];
```

Pros:

* Much faster.
* Easier for users to understand.
* Best suggestion is always a possible answer.

Cons:

* Sometimes the mathematically best information-gathering word may be a valid dictionary word that is not an answer word.

### Option B: Two modes

Add a simple constant:

```js
const SOLO_ANALYSIS_MODE = 'answers-only';
// or
const SOLO_ANALYSIS_MODE = 'all-valid-guesses';
```

Then:

```js
function getAllowedAnalysisGuesses() {
  if (SOLO_ANALYSIS_MODE === 'answers-only') {
    return [...targetWords];
  }

  return [...new Set([...dictionary, ...targetWords])];
}
```

I recommend starting with:

```js
const SOLO_ANALYSIS_MODE = 'answers-only';
```

Then upgrading later if performance is acceptable.

---

# Optional Upgrade: Web Worker

If the analysis freezes the UI, move the heavy calculations into a Web Worker.

Create:

```text
soloAnalysisWorker.js
```

The worker receives:

```js
{
  targetWords,
  dictionary,
  soloGuessHistory,
  mode: 'answers-only'
}
```

And returns:

```js
{
  review: [...]
}
```

This keeps the UI responsive while analysis runs.

Recommended only after the first version works.

---

# Styling Plan

Add to `styles.css`:

```css
.solo-end {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.solo-end-content {
  width: min(900px, 100%);
  background: var(--panel-bg, #111);
  border-radius: 20px;
  padding: 24px;
}

.solo-end-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 20px 0;
}

.solo-analysis {
  margin-top: 24px;
}

.solo-analysis-card {
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
  background: rgba(255, 255, 255, 0.06);
}

.solo-analysis-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.solo-guess {
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.solo-analysis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.solo-analysis-grid div {
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
}

.solo-analysis-grid strong {
  display: block;
  font-size: 0.8rem;
  opacity: 0.75;
  margin-bottom: 4px;
}

.solo-top-suggestions {
  margin-top: 12px;
}

.rating-excellent {
  border-left: 5px solid #22c55e;
}

.rating-strong {
  border-left: 5px solid #14b8a6;
}

.rating-decent {
  border-left: 5px solid #eab308;
}

.rating-weak {
  border-left: 5px solid #f97316;
}

.rating-poor {
  border-left: 5px solid #ef4444;
}
```

Adjust colors to match your existing theme.

---

# Edge Cases to Handle

## 1. Player exits solo mode early

Clear history:

```js
soloGuessHistory = [];
soloAnalysisCache = null;
```

inside `resetToMenu()`.

Your current `resetToMenu()` already clears many solo/multiplayer state values, so add those two there. 

## 2. Dictionary not loaded

If `targetWords` or `dictionary` are empty, hide the optimal play button or show:

```text
Analysis unavailable. Word list was not loaded.
```

## 3. User guess is valid but not in analysis list

This can happen if analysis mode is `answers-only` and the user guessed a dictionary-only word.

In that case:

* Still score the user’s guess manually.
* Show rank as:

```text
Not ranked in answers-only mode
```

Or:

```text
Dictionary guess — compared against answer-only suggestions
```

## 4. Possible answers becomes 1

If only one answer remains, the optimal guess should almost always be that answer.

Add shortcut:

```js
if (possibleAnswers.length === 1) {
  return [{
    guess: possibleAnswers[0],
    expectedRemaining: 1,
    worstCaseRemaining: 1,
    bucketCount: 1,
    guaranteedSolveChance: 1,
  }];
}
```

## 5. Solved guess

For the solved guess, `possibleAfter` should become `1`.

The review should say:

```text
You solved it.
```

Instead of implying the user needed to narrow the list further.

---

# Suggested Implementation Order

## Phase 1 — Store solo guess history

* Add `soloGuessHistory`.
* Reset it in `startSolo()`.
* Push `{ guess, feedback, attemptNumber, solved }` inside `handleSolo(g)`.

## Phase 2 — Add solo end screen

* Add `data-solo-end` markup to `index.html`.
* Add `soloEndScreen` query selector.
* Add `soloEnd` to `showScreen(sc)`.
* Replace immediate solo reset with `showSoloEnd(won)`.

## Phase 3 — Add basic post-game buttons

* `View Optimal Play`
* `Play Again`
* `Back to Menu`

## Phase 4 — Build analysis engine

Add:

* `feedbackToPattern()`
* `filterPossibleAnswers()`
* `scoreGuessByExpectedRemaining()`
* `rankOptimalGuesses()`
* `calculateOptimalityPercent()`
* `getOptimalityRating()`
* `analyzeSoloGame()`

## Phase 5 — Render analysis UI

* Add `renderSoloAnalysis()`.
* Render one card per guess.
* Show rank, rating, optimal word, expected remaining, possible before/after, and top 5 suggestions.

## Phase 6 — Optimize if needed

Start with:

```js
const SOLO_ANALYSIS_MODE = 'answers-only';
```

Then test performance.

Later, consider:

```js
const SOLO_ANALYSIS_MODE = 'all-valid-guesses';
```

or move the calculation to a Web Worker.

---

# Recommended Default Settings

Use these defaults for the first version:

```js
const SOLO_ANALYSIS_MODE = 'answers-only';
const SOLO_ANALYSIS_TOP_N = 5;
const SOLO_ANALYSIS_SHOW_DETAILS = true;
```

This gives a useful analysis without making the browser do too much work.

---

# Final Expected User Experience

After a solo game, the player sees:

```text
Solved in 4 guesses!
The word was: CRANE

[View Optimal Play]
[Play Again]
[Back to Menu]
```

After clicking review:

```text
Guess 1 — ADIEU
Decent — 72% optimal
Best word: SLATE
Your rank: #312 / 2315
Possible answers: 2315 → 184

Guess 2 — PRINT
Strong — 88% optimal
Best word: TRICE
Your rank: #43 / 184
Possible answers: 184 → 19

Guess 3 — CRATE
Excellent — 97% optimal
Best word: CRANE
Your rank: #2 / 19
Possible answers: 19 → 1

Guess 4 — CRANE
Solved
Excellent — 100% optimal
```

This makes solo mode feel much more educational and replayable without affecting multiplayer or exposing hints during active play.

```
```
