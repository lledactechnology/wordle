# Multiplayer Wordle Public Guardrails — AI Agent Implementation Plan

Copy and paste this implementation brief into the AI coding agent.

```text
You are implementing low-cost public-server guardrails for my multiplayer Wordle game.

Context:
This is a public website, but it is intended mainly for a few friends. I do not want a private access code, login system, invite code, password, or any extra friction before players can play. The game should remain easy to open, create a room, share a room code/link, and play.

The goal is not to scale to a large public audience. The goal is to prevent random traffic, bots, or accidental abuse from consuming too much CPU, memory, or server resources.

Tech stack:
- Node.js server
- Built-in `http` module for static files
- `ws` WebSocket library
- In-memory game state only
- `rooms` Map
- `players` Map
- Client file: `script.js`
- Server file: `server.js`
- No database
- No Redis
- No horizontal scaling
- No authentication system

Important existing architecture:
- Rooms have states: `lobby`, `playing`, `roundEnd`, `finished`
- Players have `playerId`, `playerToken`, `roomId`, `ws`, `score`, `roundScores`, `solved`, `hasSolved`, and `attemptsUsed`
- Reconnect should continue to work using `playerToken`
- New players should not be allowed into in-progress games
- Reconnecting players with valid tokens should be allowed back into in-progress games
- Solo mode should not be broken
- God Mode / spectator behavior should not be broken

Do NOT implement:
- Private site access code
- Password screen
- Login
- User accounts
- Email verification
- Database persistence
- Redis
- Horizontal scaling
- Any paid infrastructure dependency

Implement silent server-side guardrails only.

Required changes:

1. Add server constants
2. Add WebSocket max payload size
3. Add total active connection cap
4. Add total room cap
5. Add per-socket message rate limiting
6. Add server-side player name sanitization
7. Add guess hardening
8. Add explicit leave vs accidental disconnect behavior, if not already implemented
9. Add timer deadline logic to reduce drift, if practical
10. Add smarter abandoned-room cleanup using a 5-minute empty-room grace period
11. Preserve reconnection behavior
12. Preserve God Mode and solo mode

Use 5 minutes for empty room cleanup, not 2 minutes.

SERVER-SIDE IMPLEMENTATION DETAILS — `server.js`

1. Add constants near the top of `server.js`

Add these near the existing `PORT`, `rooms`, and `players` setup:

```js
const MAX_ROOMS = 25;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_TOTAL_CONNECTIONS = 100;

const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 20;

const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ROOM_AGE_MS = 60 * 60 * 1000; // 1 hour

const TYPING_UPDATE_THROTTLE_MS = 75;

let activeConnections = 0;
```

Notes:
- `MAX_ROOMS = 25` is enough for a casual friend game.
- `MAX_TOTAL_CONNECTIONS = 100` protects the server from too many open sockets.
- `MAX_MESSAGES_PER_WINDOW = 20` protects against spam without affecting normal play.
- Empty rooms should remain for 5 minutes to allow reconnects.
- Do not create extra infrastructure.

2. Add WebSocket max payload size

Change:

```js
const wss = new WebSocket.Server({ server });
```

To:

```js
const wss = new WebSocket.Server({
  server,
  maxPayload: 1024,
});
```

Reason:
All legitimate game messages are tiny JSON payloads. There is no reason to accept large messages.

3. Add per-socket rate limiting helper

Add this function in `server.js`:

```js
function isRateLimited(ws) {
  const now = Date.now();

  if (!ws.rateLimit) {
    ws.rateLimit = {
      windowStart: now,
      count: 0,
    };
  }

  if (now - ws.rateLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
    ws.rateLimit.windowStart = now;
    ws.rateLimit.count = 0;
  }

  ws.rateLimit.count++;

  return ws.rateLimit.count > MAX_MESSAGES_PER_WINDOW;
}
```

Then inside `ws.on('message', ...)`, before parsing JSON, add:

```js
if (isRateLimited(ws)) {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Slow down.',
  }));
  return;
}
```

Important:
- This should apply to all WebSocket message types, not just guesses.
- This protects against spam of `typingUpdate`, `chatMessage`, `joinRoom`, `guess`, etc.
- Do not disconnect immediately on the first rate-limit violation unless abuse continues.

Optional improvement:
Track repeated rate-limit violations and close the socket after several violations:

```js
if (isRateLimited(ws)) {
  ws.rateLimitViolations = (ws.rateLimitViolations || 0) + 1;

  if (ws.rateLimitViolations >= 5) {
    ws.close(1008, 'Rate limit exceeded');
    return;
  }

  ws.send(JSON.stringify({
    type: 'error',
    message: 'Slow down.',
  }));
  return;
}
```

4. Add total active connection cap

Update the WebSocket connection handler.

At the start of:

```js
wss.on('connection', (ws) => {
```

Add:

```js
if (activeConnections >= MAX_TOTAL_CONNECTIONS) {
  ws.close(1013, 'Server busy');
  return;
}

activeConnections++;
```

Then make sure `activeConnections` is decremented exactly once per socket.

Use a guard flag:

```js
ws.hasCountedClose = false;

function markSocketClosed() {
  if (ws.hasCountedClose) return;
  ws.hasCountedClose = true;
  activeConnections = Math.max(0, activeConnections - 1);
}
```

Then inside `ws.on('close', ...)`:

```js
ws.on('close', () => {
  markSocketClosed();
  handlePlayerLeave(ws);
});
```

And inside `ws.on('error', ...)`, do not decrement separately unless the socket will not emit close. Usually `close` will handle it. If current code calls `handlePlayerLeave(ws)` on error, make sure it does not double-clean the same player.

Safer pattern:

```js
ws.on('error', () => {
  if (players.has(ws)) {
    handlePlayerLeave(ws);
  }
});
```

But keep `activeConnections` decrement primarily in `close`.

5. Add room cap before creating a room

In the `createRoom` message handler, before calling `createRoom(...)`, add:

```js
if (rooms.size >= MAX_ROOMS) {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Server is busy. Try again later.',
  }));
  return;
}
```

This prevents unlimited room creation.

6. Enforce max players server-side

Do not rely only on client settings.

In `createRoom(settings)`, clamp settings:

```js
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
```

Then in `createRoom(settings)`:

```js
settings: {
  rounds: clampNumber(settings.rounds, 1, 10, 3),
  timePerRound: clampNumber(settings.timePerRound, 60, 300, 120),
  maxPlayers: clampNumber(settings.maxPlayers, 2, MAX_PLAYERS_PER_ROOM, 8),
},
```

Also in `joinRoom`, keep the existing room full check:

```js
if (room.players.length >= room.settings.maxPlayers) {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Room is full',
  }));
  return;
}
```

7. Add server-side player name sanitization

Add this helper:

```js
function sanitizePlayerName(name, fallback = 'Player') {
  if (typeof name !== 'string') return fallback;

  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 16);

  return cleaned || fallback;
}
```

Use it in `createRoom`:

```js
const playerName = sanitizePlayerName(data.playerName, 'Host');
```

Use it in `joinRoom`:

```js
const playerName = sanitizePlayerName(data.playerName, 'Player');
```

Important:
- The client may already escape names, but the server still needs to limit name length and characters.
- This reduces memory abuse and weird rendering cases.

8. Harden guess handling

In `handlePlayerGuess(ws, data)`, after finding `round`, add a defensive attempt guard.

Use:

```js
const guessesMade =
  round.playerGuesses && round.playerGuesses[player.id]
    ? round.playerGuesses[player.id].length
    : 0;

if (player.solved || guessesMade >= 6 || round.results[player.id]) {
  ws.send(JSON.stringify({ type: 'alreadySolved' }));
  return;
}
```

Then calculate attempt number from `guessesMade`:

```js
const attemptNumber = guessesMade + 1;
```

Important:
- This makes the 6-attempt limit impossible to bypass if state gets weird.
- This does not change normal gameplay.

9. Validate guess format before dictionary lookup

Before checking dictionary arrays, make sure the guess is exactly 5 lowercase letters:

```js
const guess = typeof data.guess === 'string' ? data.guess.toLowerCase() : '';

if (!/^[a-z]{5}$/.test(guess)) {
  ws.send(JSON.stringify({
    type: 'guessInvalid',
    message: 'Invalid guess',
  }));
  return;
}
```

Then keep dictionary validation:

```js
if (!dictionary.includes(guess) && !targetWords.includes(guess)) {
  ws.send(JSON.stringify({
    type: 'guessInvalid',
    message: 'Not in word list',
  }));
  return;
}
```

10. Throttle typing updates

Inside the `typingUpdate` case, after finding `player` and `room`, add:

```js
const now = Date.now();

if (player.lastTypingUpdateAt && now - player.lastTypingUpdateAt < TYPING_UPDATE_THROTTLE_MS) {
  return;
}

player.lastTypingUpdateAt = now;
```

Then sanitize `currentGuess`:

```js
const currentGuess = Array.isArray(data.currentGuess)
  ? data.currentGuess
      .slice(0, 5)
      .map(ch => typeof ch === 'string' ? ch.toLowerCase() : '')
      .filter(ch => /^[a-z]$/.test(ch))
  : [];
```

Then store and broadcast as before:

```js
player.currentGuess = currentGuess;
broadcastSpectateTypingUpdate(room, player.id, currentGuess);
```

Reason:
God Mode typing updates are useful but should not allow high-frequency spam.

11. Deadline-based timer to reduce drift

Current timer likely decrements `room.timeRemaining--` every second. Replace with deadline-based timing.

In `startRound(room)`, when the round starts, set:

```js
room.roundEndsAt = Date.now() + room.settings.timePerRound * 1000;
room.pausedAt = null;
room.timeRemaining = room.settings.timePerRound;
```

Create or update `startRoomTimer(room)`:

```js
function startRoomTimer(room) {
  if (room.timerInterval) return;

  room.timerInterval = setInterval(() => {
    const hasActive = room.players.some(
      p => p.ws && p.ws.readyState === WebSocket.OPEN
    );

    if (!hasActive) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      room.pausedAt = Date.now();
      return;
    }

    room.timeRemaining = Math.max(
      0,
      Math.ceil((room.roundEndsAt - Date.now()) / 1000)
    );

    if (room.timeRemaining <= 0) {
      endRound(room);
      return;
    }

    broadcastAll(room, {
      type: 'timerUpdate',
      timeRemaining: room.timeRemaining,
    });
  }, 1000);
}
```

In `startRound(room)`, replace the inline timer with:

```js
clearInterval(room.timerInterval);
room.timerInterval = null;
startRoomTimer(room);
```

When everyone disconnects:
- Timer stops.
- `room.pausedAt` is set.
- This keeps CPU low when nobody is there.

When a player reconnects during a playing room:

```js
if (room.state === 'playing') {
  if (room.pausedAt && room.roundEndsAt) {
    const pausedFor = Date.now() - room.pausedAt;
    room.roundEndsAt += pausedFor;
    room.pausedAt = null;
  }

  if (!room.timerInterval) {
    startRoomTimer(room);
  }
}
```

This pauses the round while everyone is disconnected and resumes when someone returns.

Important:
- Preserve the existing reconnect behavior.
- Do not let timers keep running forever when all players are gone.
- Do not run a timer per player. Keep one timer per active playing room.

12. Explicit leave vs accidental disconnect

Accidental disconnect:
- Browser refresh
- Tab close
- Temporary network issue
- Mobile browser sleep

For accidental disconnects, keep the player in `room.players` and set `player.ws = null` so they can reconnect with `playerToken`.

Explicit leave:
- User clicks Leave Room
- User clicks Leave Game
- User clicks Back to Menu intentionally

For explicit leave, remove the player from `room.players`.

If not already implemented, add a separate function:

```js
function handleExplicitLeave(ws) {
  const player = players.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  players.delete(ws);

  if (!room) return;

  const wasHost = player.isHost;

  room.players = room.players.filter(p => p.id !== player.id);

  broadcastAll(room, {
    type: 'playerLeft',
    playerId: player.id,
    playerName: player.name,
    roomState: getRoomState(room),
  });

  broadcastSpectatePlayerLeft(room, player.id);

  if (wasHost) {
    const nextHost = room.players.find(
      p => p.ws && p.ws.readyState === WebSocket.OPEN
    );

    if (nextHost) {
      nextHost.isHost = true;
      nextHost.ws.send(JSON.stringify({ type: 'hostAssigned' }));
    }
  }

  if (room.players.length === 0) {
    clearInterval(room.timerInterval);
    clearTimeout(room.autoStartTimeout);
    rooms.delete(room.id);
    return;
  }

  if (room.state === 'playing') {
    const activePlayers = room.players.filter(
      p => p.ws && p.ws.readyState === WebSocket.OPEN
    );

    if (activePlayers.length > 0) {
      const allDone = activePlayers.every(p => p.solved);
      if (allDone) endRound(room);
    }
  }
}
```

Then update the message handler:

```js
case 'leaveRoom': {
  handleExplicitLeave(ws);
  break;
}
```

Keep accidental disconnects using:

```js
ws.on('close', () => {
  handlePlayerLeave(ws);
});
```

13. Prevent stale socket close from disconnecting a newly reconnected player

In `handlePlayerLeave(ws)`, add a stale-socket check before setting `player.ws = null`:

```js
function handlePlayerLeave(ws) {
  const player = players.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  players.delete(ws);

  if (player.ws !== ws) {
    return;
  }

  player.ws = null;

  if (!room) return;

  // existing accidental-disconnect logic...
}
```

Reason:
On reconnect, the server may close an old socket. That old socket's close event should not null out the player's new socket.

14. Smarter abandoned-room cleanup with 5-minute grace period

Replace or update the existing stale room cleanup.

Use this:

```js
setInterval(() => {
  const now = Date.now();

  for (const [id, room] of rooms) {
    const hasActive = room.players.some(
      p => p.ws && p.ws.readyState === WebSocket.OPEN
    );

    if (!hasActive) {
      if (!room.emptiedAt) {
        room.emptiedAt = now;
      }

      if (now - room.emptiedAt > EMPTY_ROOM_GRACE_MS) {
        clearInterval(room.timerInterval);
        clearTimeout(room.autoStartTimeout);
        rooms.delete(id);
      }

      continue;
    }

    room.emptiedAt = null;

    if (now - room.createdAt > MAX_ROOM_AGE_MS) {
      clearInterval(room.timerInterval);
      clearTimeout(room.autoStartTimeout);
      rooms.delete(id);
      continue;
    }
  }
}, 60 * 1000);
```

Important:
- Empty rooms should have 5 minutes before deletion.
- Cleanup should run every 60 seconds, not too frequently.
- Clear `timerInterval` and `autoStartTimeout` when deleting rooms.
- Do not delete rooms too aggressively while active players are connected.

15. Keep reconnect behavior intact

In `joinRoom`, keep this order:

```js
const room = rooms.get(roomId);

if (!room) {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Room not found',
  }));
  return;
}

const playerToken = data.playerToken || '';
const existingIdx = playerToken
  ? room.players.findIndex(p => p.playerToken === playerToken)
  : -1;

if (existingIdx !== -1) {
  // Reconnect existing player
  // This must happen before checking room.state !== 'lobby'
  return;
}

if (room.state !== 'lobby') {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Game already in progress',
  }));
  return;
}
```

Do not move the `room.state !== 'lobby'` check above token reconnect.

16. In reconnect branch, resume paused timer if needed

Inside successful reconnect logic:

```js
existing.ws = ws;
existing.connected = true;
existing.lastSeenAt = Date.now();
players.set(ws, existing);
room.emptiedAt = null;

if (room.state === 'playing') {
  if (room.pausedAt && room.roundEndsAt) {
    const pausedFor = Date.now() - room.pausedAt;
    room.roundEndsAt += pausedFor;
    room.pausedAt = null;
  }

  if (!room.timerInterval) {
    startRoomTimer(room);
  }
}
```

Then send the reconnect payload as currently designed.

CLIENT-SIDE IMPLEMENTATION DETAILS — `script.js`

1. Do not add access code UI

Do not add:
- access code input
- password prompt
- login screen
- invite code screen

The public experience should stay the same.

2. Ensure intentional leave sends `leaveRoom`

When the user intentionally leaves, call:

```js
send({ type: 'leaveRoom' });
```

Then clear local reconnect data and return to menu.

If `resetToMenu()` currently closes the socket without sending `leaveRoom`, change the leave buttons to do something like:

```js
function leaveGameIntentionally() {
  if (ws && ws.readyState === WebSocket.OPEN && roomId && !isSoloMode) {
    send({ type: 'leaveRoom' });
  }

  clearReconnectSession();
  resetToMenu({ skipLeaveMessage: true });
}
```

If you do not want to refactor `resetToMenu`, keep changes minimal, but make sure intentional leave is distinguishable from accidental disconnect.

3. Preserve reconnect storage

Do not clear `localStorage` reconnect data on WebSocket close.

Only clear reconnect data when:
- the user intentionally leaves
- the room no longer exists
- the user intentionally goes back to menu

4. Keep solo mode separate

Solo mode should not create WebSocket rooms and should not trigger reconnect storage.

Acceptance tests:

Test 1 — Normal friend flow
- User opens public site.
- No access code required.
- User creates room.
- Friend joins with room code/link.
- Game starts and works normally.

Test 2 — Room cap
- Artificially set `MAX_ROOMS = 1`.
- Create one room.
- Try to create another room.
- Server should return “Server is busy. Try again later.”
- Server should not crash.

Test 3 — Connection cap
- Artificially set `MAX_TOTAL_CONNECTIONS = 1`.
- Open one connection.
- Open another tab.
- Second connection should close with “Server busy.”
- Server should not crash.

Test 4 — Rate limit
- Send more than 20 messages in 1 second from one socket.
- Server should respond with “Slow down.” or close after repeated violations if optional violation tracking is implemented.
- Normal typing and guessing should still work.

Test 5 — Large payload
- Send a WebSocket message larger than 1024 bytes.
- Server should reject/close the message through `ws` maxPayload behavior.
- Server should not crash.

Test 6 — Name sanitization
- Try joining with a very long name.
- Try joining with HTML/script characters.
- Server should trim/sanitize to max 16 safe characters.
- Client should still render safely.

Test 7 — Guess hardening
- Submit more than 6 guesses using a manual WebSocket client.
- Server should reject extra guesses.
- Player should not get extra attempts.

Test 8 — Typing throttle
- Spam `typingUpdate` rapidly.
- Server should ignore updates sent faster than `TYPING_UPDATE_THROTTLE_MS`.
- Normal typing should still appear in God Mode.

Test 9 — Reconnect still works
- Player joins game.
- Player makes guesses.
- Player refreshes.
- Player reconnects with token.
- Previous guesses are restored.
- Player can continue.
- Player is not rejected as a new player.

Test 10 — Everyone disconnects and reconnects within 5 minutes
- All players disconnect during active round.
- Timer stops.
- Room is not deleted immediately.
- One player reconnects within 5 minutes.
- Timer resumes.
- Player can continue.

Test 11 — Empty room cleanup after 5 minutes
- All players disconnect.
- Wait more than 5 minutes, plus up to 60 seconds for cleanup interval.
- Room should be deleted.
- Reconnect should return “Room not found.”

Test 12 — Explicit leave
- Player clicks Leave Room / Leave Game.
- Client sends `leaveRoom`.
- Server removes player from room.
- Client clears reconnect storage.
- Refreshing should not auto-reconnect that player.

Test 13 — New player blocked during active game
- Game is in progress.
- A new player without valid token tries to join.
- Server rejects with “Game already in progress.”

Test 14 — Fake reconnect token blocked
- Game is in progress.
- Client sends fake `playerToken`.
- Server should not match it.
- Since room is not lobby, server should reject.

Final constraints:
- Keep the game public and frictionless.
- Do not add a private access code.
- Keep CPU low.
- Keep memory bounded.
- Keep one timer per active playing room.
- Stop timers for rooms where all players are disconnected.
- Allow reconnects within 5 minutes after everyone disconnects.
- Do not add paid services.
- Do not add a database.
- Do not break solo mode.
- Do not break God Mode.
- Do not break player reconnect.

Deliverables:
1. Update `server.js` with silent guardrails.
2. Update `script.js` only where needed for explicit leave and reconnect preservation.
3. Briefly summarize what changed.
4. Confirm the acceptance tests manually or with notes.
```
