const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Load word data
const targetWords = JSON.parse(fs.readFileSync(path.join(__dirname, 'targetWords.json'), 'utf8'));
const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, 'dictionary.json'), 'utf8'));

// Serve static files
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return types[ext] || 'text/plain';
}

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  filePath = filePath.split('?')[0];
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// Game state storage
const rooms = new Map();
const players = new Map(); // ws -> playerInfo

// Generate a short readable room ID
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed confusing chars
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Avoid duplicates
  if (rooms.has(id)) return generateRoomId();
  return id;
}

function generatePlayerId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
}

function createRoom(settings) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    settings: {
      rounds: settings.rounds || 3,
      timePerRound: settings.timePerRound || 120, // seconds
      maxPlayers: settings.maxPlayers || 8,
    },
    players: [],
    rounds: [],
    currentRound: 0,
    state: 'lobby', // lobby, playing, roundEnd, finished
    timeRemaining: 0,
    timerInterval: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function getRoomState(room) {
  return {
    id: room.id,
    settings: room.settings,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      roundScores: p.roundScores,
      solved: p.solved,
      isHost: p.isHost,
    })),
    currentRound: room.currentRound,
    state: room.state,
    timeRemaining: room.timeRemaining,
    roundWord: room.state === 'roundEnd' ? room.rounds[room.currentRound - 1]?.word : null,
    roundResults: room.state === 'roundEnd' ? room.rounds[room.currentRound - 1]?.results : null,
  };
}

function startRound(room) {
  if (room.state === 'playing') return;
  
  const roundIndex = room.currentRound;
  if (roundIndex >= room.settings.rounds) {
    endGame(room);
    return;
  }

  const word = targetWords[Math.floor(Math.random() * targetWords.length)];
  
  room.rounds.push({
    word,
    results: {},
    startTime: Date.now(),
  });
  
  room.state = 'playing';
  room.timeRemaining = room.settings.timePerRound;
  room.players.forEach(p => { p.solved = false; });
  
  broadcastAll(room, {
    type: 'roundStart',
    round: roundIndex + 1,
    totalRounds: room.settings.rounds,
    timePerRound: room.settings.timePerRound,
  });
  
  // Start timer
  clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timeRemaining--;
    
    if (room.timeRemaining <= 0) {
      endRound(room);
      return;
    }
    
    // Broadcast time update every 5 seconds
    if (room.timeRemaining % 5 === 0 || room.timeRemaining <= 10) {
      broadcastAll(room, {
        type: 'timerUpdate',
        timeRemaining: room.timeRemaining,
      });
    }
  }, 1000);
}

function endRound(room) {
  if (room.state !== 'playing') return;
  
  clearInterval(room.timerInterval);
  room.state = 'roundEnd';
  
  const round = room.rounds[room.currentRound];
  const word = round.word;
  
  // Calculate results for players who didn't solve
  room.players.forEach(p => {
    if (!round.results[p.id]) {
      round.results[p.id] = {
        playerId: p.id,
        playerName: p.name,
        solved: false,
        attempts: 0,
        timeTaken: room.settings.timePerRound,
        roundScore: 0,
      };
    }
    // Add round score to total
    p.roundScores.push(round.results[p.id].roundScore);
    p.score += round.results[p.id].roundScore;
  });
  
  room.currentRound++;
  
  broadcastAll(room, {
    type: 'roundEnd',
    word: word,
    results: round.results,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      roundScores: p.roundScores,
    })),
    round: room.currentRound,
    totalRounds: room.settings.rounds,
  });
  
  // Auto-start next round after 15 seconds, or host can skip
  setTimeout(() => {
    if (room.state === 'roundEnd' && room.currentRound < room.settings.rounds) {
      startRound(room);
    } else if (room.currentRound >= room.settings.rounds) {
      endGame(room);
    }
  }, 15000);
}

function endGame(room) {
  room.state = 'finished';
  clearInterval(room.timerInterval);
  
  // Sort players by score
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
  
  broadcastAll(room, {
    type: 'gameEnd',
    players: sortedPlayers.map((p, i) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      roundScores: p.roundScores,
      rank: i + 1,
    })),
  });
}

function handlePlayerGuess(ws, data) {
  const player = players.get(ws);
  if (!player) {
    ws.send(JSON.stringify({ type: 'guessInvalid', message: 'Not in a room' }));
    return;
  }
  
  const roomId = player.roomId;
  const room = rooms.get(roomId);
  if (!room || room.state !== 'playing') {
    ws.send(JSON.stringify({ type: 'guessInvalid', message: 'No active round' }));
    return;
  }
  
  const guess = data.guess?.toLowerCase();
  if (!guess || guess.length !== 5) {
    ws.send(JSON.stringify({ type: 'guessInvalid', message: 'Invalid guess' }));
    return;
  }
  
  // Validate guess is in dictionary
  if (!dictionary.includes(guess)) {
    ws.send(JSON.stringify({
      type: 'guessInvalid',
      message: 'Not in word list',
    }));
    return;
  }
  
  const round = room.rounds[room.currentRound];
  if (!round) {
    ws.send(JSON.stringify({ type: 'guessInvalid', message: 'Round not found' }));
    return;
  }
  
  if (round.results[player.id]?.solved) {
    ws.send(JSON.stringify({
      type: 'alreadySolved',
    }));
    return;
  }
  
  const word = round.word;
  const attemptNumber = (round.results[player.id]?.attempts || 0) + 1;
  
  // Calculate feedback
  const feedback = calculateFeedback(guess, word);
  const solved = guess === word;
  
  ws.send(JSON.stringify({
    type: 'guessResult',
    guess: guess,
    feedback: feedback,
    attemptNumber: attemptNumber,
    solved: solved,
  }));
  
  if (solved) {
    const timeTaken = room.settings.timePerRound - room.timeRemaining;
    // Score formula: base 1000 + time bonus (up to 500) + attempt bonus
    const timeBonus = Math.floor((room.timeRemaining / room.settings.timePerRound) * 500);
    const attemptBonus = Math.max(0, (6 - attemptNumber) * 100);
    const roundScore = 1000 + timeBonus + attemptBonus;
    
    round.results[player.id] = {
      playerId: player.id,
      playerName: player.name,
      solved: true,
      attempts: attemptNumber,
      timeTaken: timeTaken,
      roundScore: roundScore,
    };
    player.solved = true;
    
    // Broadcast player progress
    broadcastAll(room, {
      type: 'playerProgress',
      playerId: player.id,
      playerName: player.name,
      solved: true,
      attempts: attemptNumber,
      timeTaken: timeTaken,
      roomState: getRoomState(room),
    });
    
    // Check if all players solved
    const allSolved = room.players.every(p => p.solved);
    if (allSolved) {
      endRound(room);
    }
  } else if (attemptNumber >= 6) {
    // Max attempts reached for this player
    const timeTaken = room.settings.timePerRound - room.timeRemaining;
    round.results[player.id] = {
      playerId: player.id,
      playerName: player.name,
      solved: false,
      attempts: 6,
      timeTaken: timeTaken,
      roundScore: 0,
    };
    player.solved = true;
    
    broadcastAll(room, {
      type: 'playerProgress',
      playerId: player.id,
      playerName: player.name,
      solved: false,
      attempts: 6,
      timeTaken: timeTaken,
      roomState: getRoomState(room),
    });
    
    // Check if all finished
    const allDone = room.players.every(p => p.solved);
    if (allDone) {
      endRound(room);
    }
  }
}

function calculateFeedback(guess, word) {
  const result = Array(5).fill('wrong');
  const wordArr = word.split('');
  const guessArr = guess.split('');
  const used = Array(5).fill(false);
  
  // First pass: correct positions
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === wordArr[i]) {
      result[i] = 'correct';
      used[i] = true;
    }
  }
  
  // Second pass: wrong locations
  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    for (let j = 0; j < 5; j++) {
      if (!used[j] && guessArr[i] === wordArr[j]) {
        result[i] = 'wrong-location';
        used[j] = true;
        break;
      }
    }
  }
  
  return result;
}

function broadcastAll(room, message) {
  const msg = JSON.stringify(message);
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('New connection');
  
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    
    switch (data.type) {
      case 'createRoom': {
        const playerName = data.playerName || 'Host';
        const room = createRoom({
          rounds: data.rounds || 3,
          timePerRound: data.timePerRound || 120,
          maxPlayers: data.maxPlayers || 8,
        });
        
        const playerInfo = {
          id: generatePlayerId(),
          name: playerName,
          ws: ws,
          roomId: room.id,
          isHost: true,
          score: 0,
          roundScores: [],
          solved: false,
        };
        
        room.players.push(playerInfo);
        players.set(ws, playerInfo);
        
        ws.send(JSON.stringify({
          type: 'roomCreated',
          roomId: room.id,
          playerId: playerInfo.id,
          roomState: getRoomState(room),
        }));
        break;
      }
      
      case 'joinRoom': {
        const roomId = data.roomId?.toUpperCase();
        const playerName = data.playerName || 'Player';
        const room = rooms.get(roomId);
        
        if (!room) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Room not found',
          }));
          return;
        }
        
        if (room.state !== 'lobby') {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Game already in progress',
          }));
          return;
        }
        
        if (room.players.length >= room.settings.maxPlayers) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Room is full',
          }));
          return;
        }
        
        // Check name uniqueness
        const nameExists = room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (nameExists) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Name already taken in this room',
          }));
          return;
        }
        
        const playerInfo = {
          id: generatePlayerId(),
          name: playerName,
          ws: ws,
          roomId: room.id,
          isHost: false,
          score: 0,
          roundScores: [],
          solved: false,
        };
        
        room.players.push(playerInfo);
        players.set(ws, playerInfo);
        
        ws.send(JSON.stringify({
          type: 'roomJoined',
          roomId: room.id,
          playerId: playerInfo.id,
          roomState: getRoomState(room),
        }));
        
        // Notify other players
        broadcastAll(room, {
          type: 'playerJoined',
          player: { id: playerInfo.id, name: playerInfo.name },
          roomState: getRoomState(room),
        });
        break;
      }
      
      case 'startGame': {
        const player = players.get(ws);
        if (!player || !player.isHost) return;
        
        const room = rooms.get(player.roomId);
        if (!room || room.state !== 'lobby') return;
        if (room.players.length < 2) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Need at least 2 players to start',
          }));
          return;
        }
        
        room.currentRound = 0;
        room.rounds = [];
        room.players.forEach(p => {
          p.score = 0;
          p.roundScores = [];
        });
        
        startRound(room);
        break;
      }
      
      case 'nextRound': {
        const player = players.get(ws);
        if (!player || !player.isHost) return;
        
        const room = rooms.get(player.roomId);
        if (!room || room.state !== 'roundEnd') return;
        if (room.currentRound >= room.settings.rounds) {
          endGame(room);
          return;
        }
        
        clearTimeout(room.autoStartTimeout);
        startRound(room);
        break;
      }
      
      case 'guess': {
        handlePlayerGuess(ws, data);
        break;
      }
      
      case 'leaveRoom': {
        handlePlayerLeave(ws);
        break;
      }
      
      case 'chatMessage': {
        const player = players.get(ws);
        if (!player) return;
        const room = rooms.get(player.roomId);
        if (!room) return;
        
        broadcastAll(room, {
          type: 'chatMessage',
          playerId: player.id,
          playerName: player.name,
          message: data.message?.substring(0, 200) || '',
        });
        break;
      }
    }
  });
  
  ws.on('close', () => {
    handlePlayerLeave(ws);
  });
  
  ws.on('error', () => {
    handlePlayerLeave(ws);
  });
});

function handlePlayerLeave(ws) {
  const player = players.get(ws);
  if (!player) return;
  
  const room = rooms.get(player.roomId);
  players.delete(ws);
  
  if (!room) return;
  
  const playerIdx = room.players.findIndex(p => p.ws === ws);
  if (playerIdx !== -1) {
    const wasHost = room.players[playerIdx].isHost;
    room.players.splice(playerIdx, 1);
    
    if (room.players.length === 0) {
      clearInterval(room.timerInterval);
      rooms.delete(room.id);
      return;
    }
    
    // Reassign host if needed
    if (wasHost) {
      room.players[0].isHost = true;
      room.players[0].ws.send(JSON.stringify({
        type: 'hostAssigned',
      }));
    }
    
    broadcastAll(room, {
      type: 'playerLeft',
      playerId: player.id,
      playerName: player.name,
      roomState: getRoomState(room),
    });
    
    // Check if all remaining players finished
    if (room.state === 'playing') {
      const allDone = room.players.every(p => p.solved);
      if (allDone) {
        endRound(room);
      }
    }
  }
}

// Clean up stale rooms after 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > 30 * 60 * 1000) {
      clearInterval(room.timerInterval);
      rooms.delete(id);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Wordle Multiplayer Server running on http://localhost:${PORT}`);
});