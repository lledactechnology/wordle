# Plan: Show Cumulative Scores During Gameplay, Round End, and God Mode

## Root Cause Analysis

### Issue 1: Leaderboard Toggle During Ongoing Game Shows Stale/No Scores

**Current flow:**
1. Server's [`startRound()`](server.js:307) broadcasts `roundStart` — it does **not** include `players` with their scores/cumulative totals.
2. Client's [`startRound()`](script.js:72) makes the leaderboard visible (`style.display=''`) but **never calls `updateLB()`**, so the leaderboard is empty/stale.
3. `updateLB()` is only called during [`handleReconnect()`](script.js:72) (when `d.roomState?.players` exists) and [`updateProgress()`](script.js:83) (when someone solves). If no one has solved yet, the leaderboard has nothing to show.

**Fix needed:**
- **Server:** Include `players` array (with scores) in the `roundStart` message.
- **Client:** Call `updateLB(d.players)` in `startRound()` to populate the leaderboard with current cumulative scores.

---

### Issue 2: No Cumulative Scores Visible During Round-End (Waiting for Next Round)

**Current flow:**
1. Server's [`endRound()`](server.js:349) already sends **both** `results` (per-round) **and** `players` (cumulative scores with `roundScores` breakdown).
2. Client's [`showRoundEnd()`](script.js:126) only renders `d.results` (the per-round scores like "Solved in 3 tries (+750)"). It **ignores** `d.players` which contains cumulative totals.
3. There is no "Toggle Cumulative Scores" button on the round-end screen.

**Fix needed:**
- Add a "🏆 Total Scores" toggle/button on the round-end screen that shows/hides cumulative scores rendered from `d.players`.
- When activated, display each player's total score with per-round breakdown (e.g., "500 + 750 + 300 = 1550").

---

### Issue 3: No Scores Visible in God Mode (Spectator Mode)

**Current flow:**
1. [`enterGodMode()`](script.js:88) explicitly hides the leaderboard: `document.querySelector('[data-leaderboard]').style.display='none'`.
2. The god-mode screen only shows spectate cards with mini-boards — no scores anywhere.
3. The "Back to My Board" button navigates back to the game board which does show the leaderboard, but there's no way to see scores while spectating.

**Fix needed:**
- Add a persistent score summary bar or section at the top of the god-mode screen showing cumulative scores of all players (including the spectator).
- Alternatively, include score data in each spectate card.

---

## Proposed Changes

### Files to modify:

| File | Changes |
|------|---------|
| [`server.js`](server.js) | Add `players` array to `roundStart` broadcast |
| [`script.js`](script.js) | Update `startRound()`, `showRoundEnd()`, and `enterGodMode()` / god-mode UI |
| [`index.html`](index.html) | Add "Total Scores" section in round-end screen; add score display area in god-mode screen |
| [`styles.css`](styles.css) | Style new UI elements |

### Detailed Implementation Steps

#### Step 1: Server — Include player scores in `roundStart`

In [`server.js` `startRound()`](server.js:336-341), modify the `broadcastAll` call to include player data:

```javascript
broadcastAll(room, {
  type: 'roundStart',
  round: roundIndex + 1,
  totalRounds: room.settings.rounds,
  timePerRound: room.settings.timePerRound,
  players: room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    roundScores: p.roundScores,
    solved: p.solved,
  })),
});
```

#### Step 2: Client — Populate leaderboard on round start

In [`script.js` `startRound()`](script.js:72), add a call to `updateLB()` with the player data:

```javascript
function startRound(d) {
  gameState = 'playing';
  // ... existing code ...
  if (d.players) {
    updateLB(d.players);  // NEW: populate leaderboard with current scores
  }
}
```

#### Step 3: Client — Add cumulative scores toggle to round-end screen

In [`index.html`](index.html), add a toggle button and a cumulative scores container inside the round-end screen:

```html
<div data-round-end class="round-end hidden">
  <div class="round-end-content">
    <h2 data-round-end-title></h2>
    <div class="word-reveal">The word was: <strong data-round-word></strong></div>
    <div class="word-definition" data-word-definition></div>
    
    <!-- Toggle between round results and total scores -->
    <div class="round-end-tabs">
      <button data-round-results-tab class="re-tab active">Round Results</button>
      <button data-total-scores-tab class="re-tab">🏆 Total Scores</button>
    </div>
    
    <div data-round-results class="round-results"></div>
    <div data-total-scores class="total-scores hidden"></div>
    
    <!-- Timer / Next Round button -->
    <div class="round-end-timer">Next round starting in <span data-round-end-countdown></span>...</div>
    <button data-next-round-btn class="menu-btn primary hidden">Start Next Round</button>
  </div>
</div>
```

In [`script.js` `showRoundEnd()`](script.js:126), after rendering round results, store `d.players` and add tab-switching logic:

```javascript
function showRoundEnd(d) {
  // ... existing results rendering ...
  
  // Store cumulative players data for tab toggle
  window._roundEndPlayers = d.players;
  
  // Render total scores container (hidden by default)
  const totalScoresEl = document.querySelector('[data-total-scores]');
  totalScoresEl.innerHTML = '';
  if (d.players) {
    const sorted = [...d.players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, i) => {
      const entry = document.createElement('div');
      entry.className = 'total-score-entry' + (p.id === playerId ? ' me' : '');
      entry.innerHTML = `
        <span class="ts-rank">#${i + 1}</span>
        <span class="ts-name">${esc(p.name)}</span>
        <span class="ts-breakdown">(${p.roundScores.join(' + ')})</span>
        <span class="ts-total">${p.score}</span>
      `;
      totalScoresEl.appendChild(entry);
    });
  }
}
```

Tab toggle listeners in the init block:

```javascript
document.querySelector('[data-round-results-tab]').addEventListener('click', () => {
  document.querySelector('[data-round-results-tab]').classList.add('active');
  document.querySelector('[data-total-scores-tab]').classList.remove('active');
  document.querySelector('[data-round-results]').classList.remove('hidden');
  document.querySelector('[data-total-scores]').classList.add('hidden');
});
document.querySelector('[data-total-scores-tab]').addEventListener('click', () => {
  document.querySelector('[data-total-scores-tab]').classList.add('active');
  document.querySelector('[data-round-results-tab]').classList.remove('active');
  document.querySelector('[data-total-scores]').classList.remove('hidden');
  document.querySelector('[data-round-results]').classList.add('hidden');
});
```

#### Step 4: Client — Show scores in god mode

In [`script.js` `enterGodMode()`](script.js:88), instead of hiding the leaderboard, keep it visible and consider adding a score summary:

**Option A (Recommended):** Show a compact score bar at the top of the god-mode screen.

In [`index.html`](index.html), add a score bar inside the god-mode screen:

```html
<div data-god-mode class="god-mode hidden">
  <div class="god-mode-top-bar">
    <h2>👁️ God Mode</h2>
    <p class="god-mode-subtitle">You can now watch everyone else finish.</p>
    <button data-god-mode-back-btn class="small-btn">Back to My Board</button>
  </div>
  <!-- NEW: Score summary bar -->
  <div data-god-mode-scores class="god-mode-scores"></div>
  <div data-god-mode-grid class="god-mode-grid">
    ...
  </div>
</div>
```

In [`script.js` `enterGodMode()`](script.js:88), render scores:

```javascript
function enterGodMode() {
  if (!myGameComplete) return;
  showGodModeReenterBtn(false);
  showScreen('godMode');
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: 'requestSpectate' });
  }
  document.querySelector('[data-game-main]').style.display = 'none';
  document.querySelector('[data-leaderboard]').style.display = 'none';
  
  // NEW: Render score summary from cached leaderboard data
  renderGodModeScores();
}

function renderGodModeScores() {
  const container = document.querySelector('[data-god-mode-scores]');
  if (!container || !leaderboardData.length) return;
  container.innerHTML = '';
  const sorted = [...leaderboardData].sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'gm-score-chip' + (p.id === playerId ? ' me' : '');
    chip.innerHTML = `
      <span class="gm-rank">#${i + 1}</span>
      <span class="gm-name">${esc(p.name)}</span>
      <span class="gm-score">${p.score}</span>
    `;
    container.appendChild(chip);
  });
}
```

Also update [`handleSpectateInit()`](script.js:90) and [`handleSpectateUpdate()`](script.js:92) to re-render scores whenever spectator data changes, since scores may update while spectating.

#### Step 5: Client — Keep leaderboard updated during spectating

In [`script.js` `handleSpectateInit()`](script.js:90), re-render the god-mode score bar:

```javascript
function handleSpectateInit(d) {
  if (!myGameComplete) return;
  renderSpectatePlayers(d.players);
  renderGodModeScores();  // NEW
}
```

And in the server's [`broadcastSpectateUpdate()`](server.js:199), consider also broadcasting player score updates to spectators. Currently it only sends guess/attempt data. We should add score info to the spectate update or send a standalone `spectateScoreUpdate` message. A simpler approach: include score in the existing `spectateUpdate` message.

#### Step 6: Styling (styles.css)

Add styles for:
- `.round-end-tabs` / `.re-tab` — tab buttons for round-end screen toggle
- `.total-scores` / `.total-score-entry` — cumulative scores list
- `.god-mode-scores` / `.gm-score-chip` — score bar chips in god mode
- `.ts-breakdown` — per-round breakdown styling
