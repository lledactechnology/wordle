// == Wordle Multiplayer Client ==
let targetWords = [], dictionary = [], wordDefinitions = {};

const ac = document.querySelector('[data-alert-container]');
const mainMenu = document.querySelector('[data-main-menu]');
const createRoomModal = document.querySelector('[data-create-room-modal]');
const joinRoomModal = document.querySelector('[data-join-room-modal]');
const lobby = document.querySelector('[data-lobby]');
const gameScreen = document.querySelector('[data-game-screen]');
const godModeScreen = document.querySelector('[data-god-mode]');
const roundEndScreen = document.querySelector('[data-round-end]');
const gameEndScreen = document.querySelector('[data-game-end]');
const guessGrid = document.querySelector('[data-guess-grid]');
const keyboardEl = document.querySelector('[data-keyboard]');
const leaderboardList = document.querySelector('[data-leaderboard-list]');
const playerList = document.querySelector('[data-player-list]');
const lobbyMessages = document.querySelector('[data-lobby-messages]');
const chatInput = document.querySelector('[data-chat-input]');
const timerDisplay = document.querySelector('[data-timer-display]');
const godModeGrid = document.querySelector('[data-god-mode-grid]');
const godModeReenterBtn = document.querySelector('[data-god-mode-reenter-btn]');

let ws=null,playerId=null,playerName='',roomId=null,isHost=false,gameState='menu',leaderboardData=[];
let isSoloMode=false,soloTargetWord='',currentRow=0,currentGuess=[],roundSolved=false;
let myGameComplete=false;
const WR=6,WL=5;

// ── Reconnect persistence (localStorage) ──
function saveReconnectSession(roomId, playerName, playerToken) {
  localStorage.setItem('wordle_roomId', roomId);
  localStorage.setItem('wordle_playerName', playerName);
  localStorage.setItem('wordle_playerToken', playerToken);
  localStorage.setItem('wordle_reconnectSavedAt', String(Date.now()));
}

function getReconnectSession() {
  return {
    roomId: localStorage.getItem('wordle_roomId'),
    playerName: localStorage.getItem('wordle_playerName'),
    playerToken: localStorage.getItem('wordle_playerToken'),
    savedAt: Number(localStorage.getItem('wordle_reconnectSavedAt') || 0),
  };
}

function clearReconnectSession() {
  localStorage.removeItem('wordle_roomId');
  localStorage.removeItem('wordle_playerName');
  localStorage.removeItem('wordle_playerToken');
  localStorage.removeItem('wordle_reconnectSavedAt');

  sessionStorage.removeItem('wordle_roomId');
  sessionStorage.removeItem('wordle_playerName');
  sessionStorage.removeItem('wordle_playerToken');
  sessionStorage.removeItem('wordle_roundComplete');
}

async function loadDicts(){targetWords=await fetch('targetWords.json').then(r=>r.json());dictionary=await fetch('dictionary.json').then(r=>r.json());try{wordDefinitions=await fetch('wordDefinitions.json').then(r=>r.json());}catch(e){wordDefinitions={};}}

function showAlert(msg,dur=2000){const a=document.createElement('div');a.className='alert';a.textContent=msg;ac.appendChild(a);setTimeout(()=>a.classList.add('hide'),dur-500);setTimeout(()=>a.remove(),dur);}

function showScreen(sc){const m={menu:mainMenu,createRoom:createRoomModal,joinRoom:joinRoomModal,lobby,game:gameScreen,godMode:godModeScreen,roundEnd:roundEndScreen,gameEnd:gameEndScreen};Object.values(m).forEach(s=>s&&s.classList.add('hidden'));if(m[sc])m[sc].classList.remove('hidden');if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();}
function showGodModeReenterBtn(show){if(godModeReenterBtn)godModeReenterBtn.classList.toggle('hidden',!show);}

let _reconnectAttempts=0,_reconnectTimer=null,_reconnecting=false;function connectWS(){if(_reconnecting)return;_reconnecting=true;if(_reconnectTimer){clearTimeout(_reconnectTimer);_reconnectTimer=null;}const p=location.protocol==='https:'?'wss:':'ws:';ws=new WebSocket(p+'//'+location.host);ws.onopen=()=>{console.log('WS OPEN');_reconnectAttempts=0;_reconnecting=false;if(!isSoloMode){const saved=getReconnectSession();if(saved.roomId&&saved.playerName&&saved.playerToken&&!roomId){playerName=saved.playerName;send({type:'joinRoom',playerName:saved.playerName,roomId:saved.roomId,playerToken:saved.playerToken});showAlert('Reconnecting...',3000);if(sessionStorage.getItem('wordle_roundComplete')==='true'){myGameComplete=true;}}}};ws.onmessage=e=>handleServer(JSON.parse(e.data));ws.onclose=()=>{_reconnecting=false;if(gameState!=='menu'){_reconnectAttempts++;if(_reconnectAttempts>8){showAlert('Unable to reconnect. Please refresh the page.',5000);resetToMenu();return;}const delay=Math.min(3000*Math.pow(1.5,_reconnectAttempts-1),30000);console.log('WS closed, reconnecting in '+Math.round(delay/1000)+'s (attempt '+_reconnectAttempts+'/8)');_reconnectTimer=setTimeout(connectWS,delay);}};ws.onerror=e=>{console.error('WS ERR',e);_reconnecting=false;};}

function send(data){if(ws&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify(data));return true;}else{showAlert('Connection lost — reconnecting...',2000);if(gameState!=='menu'&&!_reconnecting&&(!ws||ws.readyState!==WebSocket.CONNECTING)){connectWS();}return false;}}

function handleServer(d){switch(d.type){case'roomCreated':playerId=d.playerId;roomId=d.roomId;isHost=true;myGameComplete=false;saveReconnectSession(roomId,playerName,d.playerToken||'');sessionStorage.removeItem('wordle_roundComplete');updateLobby(d.roomState);showScreen('lobby');showAlert('Room created!',3000);break;case'roomJoined':playerId=d.playerId;roomId=d.roomId;{const me=d.roomState&&d.roomState.players?d.roomState.players.find(p=>p.id===d.playerId):null;isHost=me?me.isHost:false;}if(d.playerToken){saveReconnectSession(roomId,playerName||localStorage.getItem('wordle_playerName')||'',d.playerToken);}if(d.reconnectState){handleReconnect(d);}else{updateLobby(d.roomState);showScreen('lobby');}if(myGameComplete&&d.roomState&&d.roomState.state==='playing'){send({type:'requestSpectate'});}break;case'error':showAlert(d.message,3000);if(d.message==='Room not found'){clearReconnectSession();resetToMenu();}break;case'playerJoined':updateLobby(d.roomState);addChat('system',d.player.name+' joined');break;case'playerRejoined':updateLobby(d.roomState);addChat('system',d.player.name+' reconnected');if(gameState==='playing')updateLB(d.roomState.players);break;case'playerLeft':updateLobby(d.roomState);addChat('system',d.playerName+' left');if(gameState==='playing')updateLB(d.roomState.players);break;case'hostAssigned':isHost=true;showAlert('You are host now',2000);break;case'chatMessage':addChat(d.playerName,d.message);break;case'roundStart':startRound(d);break;case'timerUpdate':updateTimer(d.timeRemaining);break;case'guessResult':handleResult(d);break;case'guessInvalid':showAlert(d.message,1500);break;case'alreadySolved':showAlert('Already solved!',1500);break;case'playerProgress':updateProgress(d);break;case'roundEnd':showRoundEnd(d);break;case'gameEnd':showGameEnd(d);break;case'roomRestarted':handleRoomRestart(d);break;case'spectateInit':handleSpectateInit(d);break;case'spectateUpdate':handleSpectateUpdate(d);break;case'spectatePlayerLeft':handleSpectatePlayerLeft(d);break;case'spectateTypingUpdate':handleSpectateTypingUpdate(d);break;}}

function updateLobby(rs){document.querySelector('[data-room-id-display]').textContent=rs.id;document.querySelector('[data-room-code]').textContent=rs.id;document.querySelector('[data-lobby-rounds]').textContent=rs.settings.rounds;document.querySelector('[data-lobby-time]').textContent=rs.settings.timePerRound;document.querySelector('[data-lobby-players]').textContent=rs.players.length+'/'+rs.settings.maxPlayers;playerList.innerHTML='';rs.players.forEach(p=>{const b=document.createElement('div');b.className='player-badge'+(p.isHost?' host':'');b.innerHTML=(p.isHost?'<span class="crown">👑</span>':'')+'<span>'+esc(p.name)+'</span>';playerList.appendChild(b);});document.querySelector('[data-start-game-btn]').classList.toggle('hidden',!isHost);}
function addChat(name,msg){const d=document.createElement('div');d.className='chat-msg';if(name==='system')d.innerHTML='<em style="color:gray">'+esc(msg)+'</em>';else d.innerHTML='<b style="color:#6c6">'+esc(name)+':</b> '+esc(msg);lobbyMessages.appendChild(d);lobbyMessages.scrollTop=lobbyMessages.scrollHeight;}
function startRound(d){gameState='playing';myGameComplete=false;roundSolved=false;showGodModeReenterBtn(false);sessionStorage.removeItem('wordle_roundComplete');showScreen('game');resetBoard();updateTimer(d.timePerRound);document.querySelector('[data-round-num]').textContent=d.round;document.querySelector('[data-total-rounds]').textContent=d.totalRounds;document.querySelector('[data-game-main]').style.display='';document.querySelector('[data-leaderboard]').style.display='';}function handleReconnect(d){var rs=d.reconnectState;if(!rs)return;var state=d.gameState||d.roomState?.state||'lobby';gameState=state;currentRow=rs.guesses?rs.guesses.length:0;currentGuess=[];roundSolved=rs.solved||false;myGameComplete=rs.solved||(rs.attemptsUsed>=6);if(myGameComplete){sessionStorage.setItem('wordle_roundComplete','true');}else{sessionStorage.removeItem('wordle_roundComplete');}if(d.roomState?.players){updateLB(d.roomState.players);}if(state==='playing'){showScreen('game');resetBoard();updateTimer(d.timeRemaining??d.roomState?.timeRemaining??0);document.querySelector('[data-round-num]').textContent=typeof d.currentRound==='number'?d.currentRound+1:1;document.querySelector('[data-total-rounds]').textContent=d.totalRounds||d.roomState?.settings?.rounds||1;document.querySelector('[data-game-main]').style.display='';document.querySelector('[data-leaderboard]').style.display='';if(rs.guesses&&rs.guesses.length>0){rebuildBoard(rs.guesses);}if(myGameComplete){setTimeout(function(){enterGodMode();},1000);}return;}if(state==='roundEnd'){
showScreen('roundEnd');
document.querySelector('[data-round-end-title]').textContent='Round '+(d.currentRound||1)+' Complete!';
if(d.roomState&&d.roomState.roundWord){
document.querySelector('[data-round-word]').textContent=d.roomState.roundWord.toUpperCase();
const rd=wordDefinitions[d.roomState.roundWord]||null;
renderDefinition(rd);
}if(d.roomState&&d.roomState.roundResults){const div=document.querySelector('[data-round-results]');div.innerHTML='';Object.values(d.roomState.roundResults).sort((a,b)=>b.roundScore-a.roundScore).forEach(r=>{const e=document.createElement('div');e.className='round-result-entry';e.innerHTML='<span class="r-name">'+esc(r.playerName)+'</span><span class="r-stats">'+(r.solved?('Solved in '+r.attempts+' '+(r.attempts===1?'try':'tries')+' ('+r.timeTaken+'s)'):'Did not solve')+'</span><span class="r-score">+'+r.roundScore+'</span>';div.appendChild(e);});}const nb=document.querySelector('[data-next-round-btn]'),td=document.querySelector('.round-end-timer'),cs=document.querySelector('[data-round-end-countdown]');if(isHost&&d.currentRound<d.totalRounds){nb.classList.remove('hidden');td.classList.add('hidden');}else if(d.currentRound<d.totalRounds){nb.classList.add('hidden');td.classList.remove('hidden');let c=15;cs.textContent=c;const iv=setInterval(()=>{c--;if(c<=0)clearInterval(iv);else cs.textContent=c;},1000);}else{nb.classList.add('hidden');td.classList.add('hidden');}return;}if(state==='finished'){showScreen('gameEnd');return;}if(state==='lobby'){updateLobby(d.roomState);showScreen('lobby');}}function rebuildBoard(guesses){for(var r=0;r<guesses.length;r++){var g=guesses[r];for(var c=0;c<5;c++){var tile=guessGrid.children[r*5+c];tile.textContent=g.word?g.word[c].toUpperCase():'';tile.dataset.state=g.feedback?g.feedback[c]:'';}for(var c=0;c<5;c++){var key=keyboardEl.querySelector('[data-key="'+g.word[c].toUpperCase()+'"]');if(!key)continue;var cs=key.dataset.state,ns=g.feedback[c];if(ns==='correct'||(ns==='wrong-location'&&cs!=='correct')||(ns==='wrong'&&!cs)){key.dataset.state=ns;key.classList.remove('wrong','wrong-location','correct');key.classList.add(ns);}}}}
function updateTimer(t){if(!timerDisplay)return;timerDisplay.textContent=t;timerDisplay.classList.remove('warning','danger');if(t<=10)timerDisplay.classList.add('danger');else if(t<=30)timerDisplay.classList.add('warning');}
function resetBoard(){currentRow=0;currentGuess=[];roundSolved=false;guessGrid.querySelectorAll('.tile').forEach(t=>{t.textContent='';t.dataset.state='';t.classList.remove('shake','dance','flip');});keyboardEl.querySelectorAll('.key').forEach(k=>{k.classList.remove('wrong','wrong-location','correct');k.dataset.state='';});}
function updateLB(players){if(!leaderboardList)return;leaderboardData=[...players].sort((a,b)=>b.score-a.score);leaderboardList.innerHTML='';leaderboardData.forEach((p,i)=>{const e=document.createElement('div');e.className='leaderboard-entry'+(p.id===playerId?' me':'');e.innerHTML='<span class="rank">#'+(i+1)+'</span><span class="name">'+esc(p.name)+'</span><span class="score">'+p.score+'</span><span class="solved-dot '+(p.solved?'done':'pending')+'"></span>';leaderboardList.appendChild(e);});}
function updateProgress(d){if(d.playerId===playerId)return;const s=d.solved?('solved in '+d.attempts+' '+(d.attempts===1?'try':'tries')+' ('+d.timeTaken+'s)'):'done without solving';showAlert(d.playerName+' '+s,2500);const p=leaderboardData.find(x=>x.id===d.playerId);if(p){p.solved=true;updateLB(leaderboardData);}}

function handleResult(d){if(roundSolved)return;const row=currentRow;for(let i=0;i<WL;i++){const tile=guessGrid.children[row*WL+i];tile.textContent=d.guess[i].toUpperCase();tile.dataset.state=d.feedback[i];tile.classList.add('flip');tile.addEventListener('transitionend',()=>tile.classList.remove('flip'),{once:true});}for(let i=0;i<WL;i++){const key=keyboardEl.querySelector('[data-key="'+d.guess[i].toUpperCase()+'"]');if(!key)continue;const cs=key.dataset.state,ns=d.feedback[i];if(ns==='correct'||(ns==='wrong-location'&&cs!=='correct')||(ns==='wrong'&&!cs)){key.dataset.state=ns;key.classList.remove('wrong','wrong-location','correct');key.classList.add(ns);}}
if(d.solved){roundSolved=true;myGameComplete=true;sessionStorage.setItem('wordle_roundComplete','true');showAlert('Puzzle complete — God Mode unlocked!',4000);for(let i=0;i<WL;i++){const t=guessGrid.children[row*WL+i];setTimeout(()=>{t.classList.add('dance');t.addEventListener('animationend',()=>t.classList.remove('dance'),{once:true});},i*100);}setTimeout(()=>{enterGodMode();},2000);}else if(d.attemptNumber>=6){roundSolved=true;myGameComplete=true;sessionStorage.setItem('wordle_roundComplete','true');showAlert('Out of attempts — God Mode unlocked!',4000);setTimeout(()=>{enterGodMode();},2000);}currentRow++;currentGuess=[];}

function enterGodMode(){if(!myGameComplete)return;showGodModeReenterBtn(false);showScreen('godMode');if(ws&&ws.readyState===WebSocket.OPEN){send({type:'requestSpectate'});}document.querySelector('[data-game-main]').style.display='none';document.querySelector('[data-leaderboard]').style.display='none';}

function handleSpectateInit(d){if(!myGameComplete)return;renderSpectatePlayers(d.players);}

function handleSpectateUpdate(d){if(!myGameComplete)return;updateSpectatePlayerBoard(d.playerId,d.guess,d.attemptNumber,d.status);}

function handleSpectatePlayerLeft(d){if(!myGameComplete)return;const card=document.querySelector('[data-spectate-player="'+d.playerId+'"]');if(card)card.remove();delete spectateData[d.playerId];}

function handleSpectateTypingUpdate(d){if(!myGameComplete)return;const p=spectateData[d.playerId];if(!p)return;p.currentGuess=d.currentGuess||[];const card=document.querySelector('[data-spectate-player="'+d.playerId+'"]');if(!card)return;const miniBoard=card.querySelector('[data-miniboard="'+d.playerId+'"]');if(miniBoard)miniBoard.innerHTML=renderMiniBoard(p.guesses,p.currentGuess);}

// Spectator board storage
let spectateData = {};

function renderSpectatePlayers(players){if(!godModeGrid)return;spectateData={};godModeGrid.innerHTML='';if(!players||players.length===0){godModeGrid.innerHTML='<div class="god-mode-empty"><h3>👀 Waiting for players...</h3><p>All other players have finished or left the room.</p></div>';return;}
players.forEach(p=>{spectateData[p.id]=p;const card=document.createElement('div');card.className='spectate-card';card.setAttribute('data-spectate-player',p.id);
let statusBadge='',statusLabel='';
switch(p.status){case'solved':statusBadge='solved';statusLabel='✅ Solved';break;case'failed':statusBadge='failed';statusLabel='❌ Out of attempts';break;default:statusBadge='playing';statusLabel='🎯 Still thinking…';}
card.innerHTML='<div class="spectate-header"><span class="spectate-name">'+esc(p.name)+'</span><span class="spectate-status spectate-status-'+statusBadge+'">'+statusLabel+'</span><span class="spectate-attempts">Attempts: '+p.attemptsUsed+'/6</span></div><div class="spectate-miniboard" data-miniboard="'+p.id+'">'+renderMiniBoard(p.guesses,p.currentGuess)+'</div><div class="spectate-status-msg">'+getStatusMessage(p.status,p.attemptsUsed)+'</div>';
godModeGrid.appendChild(card);});}

function renderMiniBoard(guesses,currentGuess){let html='';const guessCount=guesses?guesses.length:0;const curGuess=currentGuess||[];for(let r=0;r<6;r++){html+='<div class="mini-row">';if(r<guessCount){const g=guesses[r];for(let c=0;c<5;c++){const letter=g.word?g.word[c].toUpperCase():'';const state=g.feedback?g.feedback[c]:'';html+='<div class="mini-tile mini-'+state+'">'+letter+'</div>';}}else if(r===guessCount&&curGuess.length>0){for(let c=0;c<5;c++){const letter=c<curGuess.length?curGuess[c].toUpperCase():'';const state=c<curGuess.length?'active':'';html+='<div class="mini-tile mini-'+state+'">'+letter+'</div>';}}else{for(let c=0;c<5;c++){html+='<div class="mini-tile"></div>';}}html+='</div>';}return html;}

function updateSpectatePlayerBoard(playerId,guess,attemptNum,status){if(!spectateData[playerId]){spectateData[playerId]={id:playerId,name:'Player',guesses:[],attemptsUsed:0,status:'playing',currentGuess:[]};}
const p=spectateData[playerId];p.guesses.push(guess);p.attemptsUsed=attemptNum;p.currentGuess=[];
if(status!=='playing')p.status=status;
const card=document.querySelector('[data-spectate-player="'+playerId+'"]');if(!card)return;
const miniBoard=card.querySelector('[data-miniboard="'+playerId+'"]');if(miniBoard)miniBoard.innerHTML=renderMiniBoard(p.guesses,p.currentGuess);
const statusEl=card.querySelector('.spectate-status');if(statusEl){let label='',cls='';switch(p.status){case'solved':label='✅ Solved';cls='solved';break;case'failed':label='❌ Out of attempts';cls='failed';break;default:label='🎯 Still thinking…';cls='playing';}statusEl.textContent=label;statusEl.className='spectate-status spectate-status-'+cls;}
const attemptsEl=card.querySelector('.spectate-attempts');if(attemptsEl)attemptsEl.textContent='Attempts: '+p.attemptsUsed+'/6';
const msgEl=card.querySelector('.spectate-status-msg');if(msgEl)msgEl.textContent=getStatusMessage(p.status,p.attemptsUsed);
if(status==='solved'){card.classList.add('spectate-card-solved');}else if(status==='failed'){card.classList.add('spectate-card-failed');}}

function getStatusMessage(status,attempts){const rem=6-attempts;switch(status){case'solved':return '🎉 Solved the puzzle!';case'failed':return '💔 Ran out of attempts';default:if(rem<=1)return '⚠️ One guess away!';if(rem<=2)return '🔍 Getting close…';if(rem<=3)return '🤔 Still thinking…';return '📝 Working on it…';}}

function submitGuess(gs){if(roundSolved||currentRow>=WR)return;const g=gs.toLowerCase();if(!dictionary.includes(g)&&!targetWords.includes(g)){showAlert('Not in word list',1500);for(let i=0;i<WL;i++){const t=guessGrid.children[currentRow*WL+i];t.classList.add('shake');t.addEventListener('animationend',()=>t.classList.remove('shake'),{once:true});}return;}if(isSoloMode)handleSolo(g);else send({type:'guess',guess:g});}

function handleKey(key){if(gameState!=='playing'||roundSolved)return;if(key==='Enter'){if(currentGuess.length===WL)submitGuess(currentGuess.join(''));else showAlert('Not enough letters',1000);}else if(key==='Backspace'||key==='Delete'){if(currentGuess.length>0){currentGuess.pop();const t=guessGrid.children[currentRow*WL+currentGuess.length];t.textContent='';t.dataset.state='';}if(!isSoloMode)send({type:'typingUpdate',currentGuess:[...currentGuess]});}else if(/^[a-zA-Z]$/.test(key)&&currentGuess.length<WL){currentGuess.push(key.toLowerCase());const t=guessGrid.children[currentRow*WL+currentGuess.length-1];t.textContent=key.toUpperCase();t.dataset.state='active';if(!isSoloMode)send({type:'typingUpdate',currentGuess:[...currentGuess]});}}

function showRoundEnd(d){gameState='roundEnd';roundSolved=true;myGameComplete=false;sessionStorage.removeItem('wordle_roundComplete');document.querySelector('[data-round-end-title]').textContent='Round '+d.round+' Complete!';document.querySelector('[data-round-word]').textContent = d.word.toUpperCase();
renderDefinition(d.definition);
const div = document.querySelector('[data-round-results]');
div.innerHTML='';Object.values(d.results).sort((a,b)=>b.roundScore-a.roundScore).forEach(r=>{const e=document.createElement('div');e.className='round-result-entry';e.innerHTML='<span class="r-name">'+esc(r.playerName)+'</span><span class="r-stats">'+(r.solved?('Solved in '+r.attempts+' '+(r.attempts===1?'try':'tries')+' ('+r.timeTaken+'s)'):'Did not solve')+'</span><span class="r-score">+'+r.roundScore+'</span>';div.appendChild(e);});showScreen('roundEnd');const nb=document.querySelector('[data-next-round-btn]'),td=document.querySelector('.round-end-timer'),cs=document.querySelector('[data-round-end-countdown]');if(isHost&&d.round<d.totalRounds){nb.classList.remove('hidden');td.classList.add('hidden');}else if(d.round<d.totalRounds){nb.classList.add('hidden');td.classList.remove('hidden');let c=15;cs.textContent=c;const iv=setInterval(()=>{c--;if(c<=0)clearInterval(iv);else cs.textContent=c;},1000);}else{nb.classList.add('hidden');td.classList.add('hidden');}}
function handleRoomRestart(d){gameState='lobby';myGameComplete=false;sessionStorage.removeItem('wordle_roundComplete');updateLobby(d.roomState);showScreen('lobby');}
function showGameEnd(d){gameState='finished';myGameComplete=false;sessionStorage.removeItem('wordle_roundComplete');showScreen('gameEnd');const pod=document.querySelector('[data-podium]');pod.innerHTML='';const t3=d.players.slice(0,3);[t3[1],t3[0],t3[2]].filter(Boolean).forEach((p,i)=>{const s=document.createElement('div');s.className='podium-spot '+['second','first','third'][i];const em=p===t3[0]?'🥇':p===t3[1]?'🥈':'🥉';s.innerHTML='<div class="pos">'+em+'</div><div class="pname">'+esc(p.name)+'</div><div class="pscore">'+p.score+' pts</div>';pod.appendChild(s);});const fs=document.querySelector('[data-final-scores]');fs.innerHTML='';d.players.forEach(p=>{const e=document.createElement('div');e.className='final-score-entry';e.innerHTML='<span class="f-rank">#'+p.rank+'</span><span class="f-name">'+esc(p.name)+'</span><span class="f-rounds">('+p.roundScores.join(' + ')+')</span><span class="f-total">'+p.score+'</span>';fs.appendChild(e);});const gw=document.querySelector('[data-game-end-words]');if(gw&&d.words){gw.innerHTML='';d.words.forEach((rw,i)=>{const de=document.createElement('div');de.className='game-end-word-entry';const def=rw.definition;let defHtml='';if(def&&def.found&&def.definition){defHtml='<em>'+esc(def.partOfSpeech||'word')+':</em> '+esc(def.definition);}else{defHtml='<em>No definition available.</em>';}de.innerHTML='<span class="gew-round">#'+(i+1)+'</span><span class="gew-word">'+esc(rw.word.toUpperCase())+'</span><span class="gew-def">'+defHtml+'</span>';gw.appendChild(de);});}const pa=document.querySelector('[data-play-again-btn]');if(pa){pa.style.display='inline-block';pa.textContent='Back to Lobby';}document.querySelector('[data-timer-display]').textContent='';}
function startSolo(){if(!targetWords||!targetWords.length){showAlert('Word list not loaded. Refresh and try again.',3000);return;}if(ws){try{ws.close();}catch(e){}ws=null;}isSoloMode=true;gameState='playing';currentRow=0;currentGuess=[];roundSolved=false;myGameComplete=false;soloTargetWord=targetWords[Math.floor(Math.random()*targetWords.length)];resetBoard();showScreen('game');document.querySelector('[data-round-num]').textContent='1';document.querySelector('[data-total-rounds]').textContent='1';if(timerDisplay){timerDisplay.textContent='∞';timerDisplay.classList.remove('warning','danger');}if(leaderboardList)leaderboardList.innerHTML='<div class="leaderboard-entry"><span>Solo Play</span></div>';}
function handleSolo(g){const fb=calcFb(g,soloTargetWord),solved=g===soloTargetWord;for(let i=0;i<WL;i++){const t=guessGrid.children[currentRow*WL+i];t.textContent=g[i].toUpperCase();t.dataset.state=fb[i];t.classList.add('flip');t.addEventListener('transitionend',()=>t.classList.remove('flip'),{once:true});}for(let i=0;i<WL;i++){const k=keyboardEl.querySelector('[data-key="'+g[i].toUpperCase()+'"]');if(!k)continue;const cs=k.dataset.state,ns=fb[i];if(ns==='correct'||(ns==='wrong-location'&&cs!=='correct')||(ns==='wrong'&&!cs)){k.dataset.state=ns;k.classList.remove('wrong','wrong-location','correct');k.classList.add(ns);}}if(solved){roundSolved=true;for(let i=0;i<WL;i++){const t=guessGrid.children[currentRow*WL+i];setTimeout(()=>{t.classList.add('dance');t.addEventListener('animationend',()=>t.classList.remove('dance'),{once:true});},i*100);}let soloDef=wordDefinitions[soloTargetWord]||null;
let defSuffix='';
if(soloDef&&soloDef.found&&soloDef.definition){
defSuffix=' — '+soloDef.definition;
}else{
defSuffix=' — No definition available for this word yet.';
}
showAlert('Solved in '+(currentRow+1)+' '+(currentRow===0?'try':'tries')+'!'+defSuffix,5000);
setTimeout(resetToMenu,5000);
}else if(currentRow>=WR-1){
roundSolved=true;
let soloDef2=wordDefinitions[soloTargetWord]||null;
let defSuffix2='';
if(soloDef2&&soloDef2.found&&soloDef2.definition){
defSuffix2=' — '+soloDef2.definition;
}else{
defSuffix2=' — No definition available for this word yet.';
}
showAlert('The word was: '+soloTargetWord.toUpperCase()+defSuffix2,5000);
setTimeout(resetToMenu,5000);}currentRow++;currentGuess=[];}
function calcFb(guess,word){const r=Array(WL).fill('wrong'),wa=word.split(''),ga=guess.split(''),used=Array(WL).fill(false);for(let i=0;i<WL;i++){if(ga[i]===wa[i]){r[i]='correct';used[i]=true;}}for(let i=0;i<WL;i++){if(r[i]==='correct')continue;for(let j=0;j<WL;j++){if(!used[j]&&ga[i]===wa[j]){r[i]='wrong-location';used[j]=true;break;}}}return r;}
function resetToMenu(){if(_reconnectTimer){clearTimeout(_reconnectTimer);_reconnectTimer=null;}_reconnecting=false;_reconnectAttempts=0;if(ws){try{ws.close();}catch(e){}}clearReconnectSession();gameState='menu';isSoloMode=false;isHost=false;roomId=null;playerId=null;soloTargetWord='';roundSolved=false;myGameComplete=false;currentRow=0;currentGuess=[];leaderboardData=[];spectateData={};resetBoard();showGodModeReenterBtn(false);showScreen('menu');}
function renderDefinition(definition){const el=document.querySelector('[data-word-definition]');if(!el)return;if(definition&&definition.found&&definition.definition){el.innerHTML='<em>'+esc(definition.partOfSpeech||'word')+':</em> '+esc(definition.definition);}else{el.innerHTML='<em>No definition available for this word yet.</em>';}}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// Event bindings
document.querySelector('[data-create-room-btn]').addEventListener('click',()=>showScreen('createRoom'));
document.querySelector('[data-join-room-btn]').addEventListener('click',()=>showScreen('joinRoom'));
document.querySelector('[data-play-solo-btn]').addEventListener('click',startSolo);
document.querySelector('[data-create-cancel]').addEventListener('click',()=>showScreen('menu'));
document.querySelector('[data-create-confirm]').addEventListener('click',()=>{const n=document.getElementById('create-player-name').value.trim();if(!n){showAlert('Enter name',2000);return;}playerName=n;send({type:'createRoom',playerName,rounds:+document.getElementById('create-rounds').value,timePerRound:+document.getElementById('create-time').value,maxPlayers:+document.getElementById('create-max-players').value});});
document.querySelector('[data-join-cancel]').addEventListener('click',()=>showScreen('menu'));
document.querySelector('[data-join-confirm]').addEventListener('click',()=>{const n=document.getElementById('join-player-name').value.trim();const c=document.getElementById('join-room-id').value.trim().toUpperCase();if(!n){showAlert('Enter name',2000);return;}if(!c){showAlert('Enter room ID',2000);return;}playerName=n;const saved=getReconnectSession();const reconnectToken=saved.roomId&&saved.roomId.toUpperCase()===c&&saved.playerToken?saved.playerToken:'';send({type:'joinRoom',playerName,roomId:c,playerToken:reconnectToken});});
document.querySelector('[data-start-game-btn]').addEventListener('click',function(){this.disabled=true;setTimeout(()=>{this.disabled=false;},1000);send({type:'startGame'});});
document.querySelector('[data-leave-room-btn]').addEventListener('click',()=>{send({type:'leaveRoom'});resetToMenu();});
document.querySelector('[data-copy-room-btn]').addEventListener('click',()=>{if(roomId)navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${roomId}`).then(()=>showAlert('Link copied!',1500)).catch(()=>{});});
document.querySelector('[data-chat-send]').addEventListener('click',()=>{const m=chatInput.value.trim();if(m){send({type:'chatMessage',message:m});chatInput.value='';}});
chatInput.addEventListener('keypress',(e)=>{if(e.key==='Enter'){const m=chatInput.value.trim();if(m){send({type:'chatMessage',message:m});chatInput.value='';}}});
document.querySelector('[data-next-round-btn]').addEventListener('click',()=>{send({type:'nextRound'});showScreen('game');resetBoard();});
document.querySelector('[data-leave-game-btn]').addEventListener('click',()=>{if(confirm('Leave game?')){send({type:'leaveRoom'});resetToMenu();}});
document.querySelector('[data-back-to-menu-btn]').addEventListener('click',()=>{send({type:'leaveRoom'});resetToMenu();});
const playAgainBtn = document.querySelector('[data-play-again-btn]');
if(playAgainBtn)playAgainBtn.addEventListener('click',()=>{send({type:'restartGame'});showScreen('lobby');});
// God Mode back button
const godModeBackBtn = document.querySelector('[data-god-mode-back-btn]');
if(godModeBackBtn)godModeBackBtn.addEventListener('click',()=>{showScreen('game');document.querySelector('[data-game-main]').style.display='';document.querySelector('[data-leaderboard]').style.display='';showGodModeReenterBtn(true);});
// Keyboard click
keyboardEl.addEventListener('pointerdown', (e) => { if (gameState !== 'playing') return; e.preventDefault(); const k = e.target.closest('[data-key]'); if (k) { keyboardEl._lastPointerDown = Date.now(); handleKey(k.dataset.key); } else if (e.target.closest('[data-enter]')) { keyboardEl._lastPointerDown = Date.now(); handleKey('Enter'); } else if (e.target.closest('[data-delete]')) { keyboardEl._lastPointerDown = Date.now(); handleKey('Backspace'); } });
// Physical keyboard
document.addEventListener('keydown', (e) => { if (gameState !== 'playing') return; if (keyboardEl._lastPointerDown && Date.now() - keyboardEl._lastPointerDown < 300) return; e.preventDefault(); if (e.key === 'Enter') handleKey('Enter'); else if (e.key === 'Backspace' || e.key === 'Delete') handleKey('Backspace'); else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key); });
// Room ID input
document.getElementById('join-room-id').addEventListener('input',(e)=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');});

// ===== LEADERBOARD TOGGLE (Drawer on desktop, sheet on mobile) =====
(function() {
  const toggle = document.querySelector('[data-leaderboard-toggle]');
  const overlay = document.querySelector('[data-leaderboard-overlay]');
  const closeBtn = document.querySelector('[data-leaderboard-close]');
  const sidebar = document.querySelector('[data-leaderboard]');
  const sheetList = document.querySelector('[data-leaderboard-sheet-list]');
  const sidebarList = document.querySelector('[data-leaderboard-list]');
  const backdrop = document.querySelector('[data-leaderboard-backdrop]');
  const drawerClose = document.querySelector('[data-leaderboard-drawer-close]');

  function isDesktop() { return window.matchMedia('(min-width: 768px)').matches; }

  function openLB() {
    if (isDesktop()) {
      sidebar.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
    } else {
      if (sheetList && sidebarList) sheetList.innerHTML = sidebarList.innerHTML;
      overlay.classList.remove('hidden');
    }
  }

  function closeLB() {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (overlay) overlay.classList.add('hidden');
  }

  if (toggle) toggle.addEventListener('click', openLB);
  if (closeBtn) closeBtn.addEventListener('click', closeLB);
  if (drawerClose) drawerClose.addEventListener('click', closeLB);
  if (backdrop) backdrop.addEventListener('click', closeLB);
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeLB();
    });
  }
})();

// Init
// Auto-join from ?room= link
(function(){const p=new URLSearchParams(location.search).get('room');if(p){setTimeout(()=>{const m=document.querySelector('[data-main-menu]');const j=document.querySelector('[data-join-room-modal]');const i=document.getElementById('join-room-id');if(m&&j&&i){m.classList.add('hidden');j.classList.remove('hidden');i.value=p.toUpperCase().trim().substring(0,5)}},150);}})();
if(godModeReenterBtn)godModeReenterBtn.addEventListener('click',()=>{enterGodMode();});
loadDicts().then(()=>{connectWS();showScreen('menu');});
