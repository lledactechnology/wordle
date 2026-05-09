// == Wordle Multiplayer Client ==
let targetWords = [], dictionary = [];

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

let ws=null,playerId=null,playerName='',roomId=null,isHost=false,gameState='menu',leaderboardData=[];
let isSoloMode=false,soloTargetWord='',currentRow=0,currentGuess=[],roundSolved=false;
let myGameComplete=false;
const WR=6,WL=5;

async function loadDicts(){targetWords=await fetch('targetWords.json').then(r=>r.json());dictionary=await fetch('dictionary.json').then(r=>r.json());}

function showAlert(msg,dur=2000){const a=document.createElement('div');a.className='alert';a.textContent=msg;ac.appendChild(a);setTimeout(()=>a.classList.add('hide'),dur-500);setTimeout(()=>a.remove(),dur);}

function showScreen(sc){const m={menu:mainMenu,createRoom:createRoomModal,joinRoom:joinRoomModal,lobby,game:gameScreen,godMode:godModeScreen,roundEnd:roundEndScreen,gameEnd:gameEndScreen};Object.values(m).forEach(s=>s&&s.classList.add('hidden'));if(m[sc])m[sc].classList.remove('hidden');if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();}

function connectWS(){const p=location.protocol==='https:'?'wss:':'ws:';ws=new WebSocket(p+'//'+location.host);ws.onopen=()=>{console.log('WS OPEN');const rid=sessionStorage.getItem('wordle_roomId');const pn=sessionStorage.getItem('wordle_playerName');const complete=sessionStorage.getItem('wordle_roundComplete');if(rid&&pn&&!roomId){send({type:'joinRoom',playerName:pn,roomId:rid});showAlert('Reconnecting...',3000);if(complete==='true'){myGameComplete=true;}}};ws.onmessage=e=>handleServer(JSON.parse(e.data));ws.onclose=()=>{if(gameState!=='menu'){console.log('WS closed, reconnecting in 3s');setTimeout(connectWS,3000);}};ws.onerror=e=>console.error('WS ERR',e);}

function send(data){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));else console.log('WS not open');}

function handleServer(d){switch(d.type){case'roomCreated':playerId=d.playerId;roomId=d.roomId;isHost=true;myGameComplete=false;sessionStorage.setItem('wordle_roomId',roomId);sessionStorage.setItem('wordle_playerName',playerName);sessionStorage.removeItem('wordle_roundComplete');updateLobby(d.roomState);showScreen('lobby');showAlert('Room created!',3000);break;case'roomJoined':playerId=d.playerId;roomId=d.roomId;isHost=false;sessionStorage.setItem('wordle_roomId',roomId);sessionStorage.setItem('wordle_playerName',playerName);updateLobby(d.roomState);showScreen('lobby');if(myGameComplete&&d.roomState&&d.roomState.state==='playing'){send({type:'requestSpectate'});}break;case'error':showAlert(d.message,3000);break;case'playerJoined':updateLobby(d.roomState);addChat('system',d.player.name+' joined');break;case'playerLeft':updateLobby(d.roomState);addChat('system',d.playerName+' left');if(gameState==='playing')updateLB(d.roomState.players);break;case'hostAssigned':isHost=true;showAlert('You are host now',2000);break;case'chatMessage':addChat(d.playerName,d.message);break;case'roundStart':startRound(d);break;case'timerUpdate':updateTimer(d.timeRemaining);break;case'guessResult':handleResult(d);break;case'guessInvalid':showAlert(d.message,1500);break;case'alreadySolved':showAlert('Already solved!',1500);break;case'playerProgress':updateProgress(d);break;case'roundEnd':showRoundEnd(d);break;case'gameEnd':showGameEnd(d);break;case'spectateInit':handleSpectateInit(d);break;case'spectateUpdate':handleSpectateUpdate(d);break;case'spectatePlayerLeft':handleSpectatePlayerLeft(d);break;}}

function updateLobby(rs){document.querySelector('[data-room-id-display]').textContent=rs.id;document.querySelector('[data-room-code]').textContent=rs.id;document.querySelector('[data-lobby-rounds]').textContent=rs.settings.rounds;document.querySelector('[data-lobby-time]').textContent=rs.settings.timePerRound;document.querySelector('[data-lobby-players]').textContent=rs.players.length+'/'+rs.settings.maxPlayers;playerList.innerHTML='';rs.players.forEach(p=>{const b=document.createElement('div');b.className='player-badge'+(p.isHost?' host':'');b.innerHTML=(p.isHost?'<span class="crown">👑</span>':'')+'<span>'+esc(p.name)+'</span>';playerList.appendChild(b);});document.querySelector('[data-start-game-btn]').classList.toggle('hidden',!isHost);}
function addChat(name,msg){const d=document.createElement('div');d.className='chat-msg';if(name==='system')d.innerHTML='<em style="color:gray">'+esc(msg)+'</em>';else d.innerHTML='<b style="color:#6c6">'+esc(name)+':</b> '+esc(msg);lobbyMessages.appendChild(d);lobbyMessages.scrollTop=lobbyMessages.scrollHeight;}
function startRound(d){gameState='playing';myGameComplete=false;roundSolved=false;sessionStorage.removeItem('wordle_roundComplete');showScreen('game');resetBoard();updateTimer(d.timePerRound);document.querySelector('[data-round-num]').textContent=d.round;document.querySelector('[data-total-rounds]').textContent=d.totalRounds;document.querySelector('[data-game-main]').style.display='';document.querySelector('[data-leaderboard]').style.display='';}
function updateTimer(t){if(!timerDisplay)return;timerDisplay.textContent=t;timerDisplay.classList.remove('warning','danger');if(t<=10)timerDisplay.classList.add('danger');else if(t<=30)timerDisplay.classList.add('warning');}
function resetBoard(){currentRow=0;currentGuess=[];roundSolved=false;guessGrid.querySelectorAll('.tile').forEach(t=>{t.textContent='';t.dataset.state='';t.classList.remove('shake','dance','flip');});keyboardEl.querySelectorAll('.key').forEach(k=>{k.classList.remove('wrong','wrong-location','correct');k.dataset.state='';});}
function updateLB(players){if(!leaderboardList)return;leaderboardData=[...players].sort((a,b)=>b.score-a.score);leaderboardList.innerHTML='';leaderboardData.forEach((p,i)=>{const e=document.createElement('div');e.className='leaderboard-entry'+(p.id===playerId?' me':'');e.innerHTML='<span class="rank">#'+(i+1)+'</span><span class="name">'+esc(p.name)+'</span><span class="score">'+p.score+'</span><span class="solved-dot '+(p.solved?'done':'pending')+'"></span>';leaderboardList.appendChild(e);});}
function updateProgress(d){if(d.playerId===playerId)return;const s=d.solved?('solved in '+d.attempts+' '+(d.attempts===1?'try':'tries')+' ('+d.timeTaken+'s)'):'done without solving';showAlert(d.playerName+' '+s,2500);const p=leaderboardData.find(x=>x.id===d.playerId);if(p){p.solved=true;updateLB(leaderboardData);}}

function handleResult(d){if(roundSolved)return;const row=currentRow;for(let i=0;i<WL;i++){const tile=guessGrid.children[row*WL+i];tile.textContent=d.guess[i].toUpperCase();tile.dataset.state=d.feedback[i];tile.classList.add('flip');tile.addEventListener('transitionend',()=>tile.classList.remove('flip'),{once:true});}for(let i=0;i<WL;i++){const key=keyboardEl.querySelector('[data-key="'+d.guess[i].toUpperCase()+'"]');if(!key)continue;const cs=key.dataset.state,ns=d.feedback[i];if(ns==='correct'||(ns==='wrong-location'&&cs!=='correct')||(ns==='wrong'&&!cs)){key.dataset.state=ns;key.classList.remove('wrong','wrong-location','correct');key.classList.add(ns);}}
if(d.solved){roundSolved=true;myGameComplete=true;sessionStorage.setItem('wordle_roundComplete','true');showAlert('Puzzle complete — God Mode unlocked!',4000);for(let i=0;i<WL;i++){const t=guessGrid.children[row*WL+i];setTimeout(()=>{t.classList.add('dance');t.addEventListener('animationend',()=>t.classList.remove('dance'),{once:true});},i*100);}setTimeout(()=>{enterGodMode();},2000);}else if(d.attemptNumber>=6){roundSolved=true;myGameComplete=true;sessionStorage.setItem('wordle_roundComplete','true');showAlert('Out of attempts — God Mode unlocked!',4000);setTimeout(()=>{enterGodMode();},2000);}currentRow++;currentGuess=[];}

function enterGodMode(){if(!myGameComplete)return;showScreen('godMode');if(ws&&ws.readyState===WebSocket.OPEN){send({type:'requestSpectate'});}document.querySelector('[data-game-main]').style.display='none';document.querySelector('[data-leaderboard]').style.display='none';}

function handleSpectateInit(d){if(!myGameComplete)return;renderSpectatePlayers(d.players);}

function handleSpectateUpdate(d){if(!myGameComplete)return;if(d.status==='playing'){updateSpectatePlayerBoard(d.playerId,d.guess,d.attemptNumber,d.status);}else{updateSpectatePlayerBoard(d.playerId,d.guess,d.attemptNumber,d.status);}}

function handleSpectatePlayerLeft(d){if(!myGameComplete)return;const card=document.querySelector('[data-spectate-player="'+d.playerId+'"]');if(card)card.remove();}

// Spectator board storage
let spectateData = {};

function renderSpectatePlayers(players){if(!godModeGrid)return;spectateData={};godModeGrid.innerHTML='';if(!players||players.length===0){godModeGrid.innerHTML='<div class="god-mode-empty"><h3>👀 Waiting for players...</h3><p>All other players have finished or left the room.</p></div>';return;}
players.forEach(p=>{spectateData[p.id]=p;const card=document.createElement('div');card.className='spectate-card';card.setAttribute('data-spectate-player',p.id);
let statusBadge='',statusLabel='';
switch(p.status){case'solved':statusBadge='solved';statusLabel='✅ Solved';break;case'failed':statusBadge='failed';statusLabel='❌ Out of attempts';break;default:statusBadge='playing';statusLabel='🎯 Still thinking…';}
card.innerHTML='<div class="spectate-header"><span class="spectate-name">'+esc(p.name)+'</span><span class="spectate-status spectate-status-'+statusBadge+'">'+statusLabel+'</span><span class="spectate-attempts">Attempts: '+p.attemptsUsed+'/6</span></div><div class="spectate-miniboard" data-miniboard="'+p.id+'">'+renderMiniBoard(p.guesses)+'</div><div class="spectate-status-msg">'+getStatusMessage(p.status,p.attemptsUsed)+'</div>';
godModeGrid.appendChild(card);});}

function renderMiniBoard(guesses){let html='';for(let r=0;r<WR;r++){html+='<div class="mini-row">';for(let c=0;c<WL;c++){let letter='',state='';if(r<guesses.length){letter=guesses[r].word[c].toUpperCase();state=guesses[r].feedback[c];}html+='<div class="mini-tile mini-'+state+'">'+letter+'</div>';}html+='</div>';}return html;}

function updateSpectatePlayerBoard(playerId,guess,attemptNum,status){if(!spectateData[playerId]){spectateData[playerId]={id:playerId,name:'Player',guesses:[],attemptsUsed:0,status:'playing'};}
const p=spectateData[playerId];p.guesses.push(guess);p.attemptsUsed=attemptNum;
if(status!=='playing')p.status=status;
const card=document.querySelector('[data-spectate-player="'+playerId+'"]');if(!card)return;
const miniBoard=card.querySelector('[data-miniboard="'+playerId+'"]');if(miniBoard)miniBoard.innerHTML=renderMiniBoard(p.guesses);
const statusEl=card.querySelector('.spectate-status');if(statusEl){let label='',cls='';switch(p.status){case'solved':label='✅ Solved';cls='solved';break;case'failed':label='❌ Out of attempts';cls='failed';break;default:label='🎯 Still thinking…';cls='playing';}statusEl.textContent=label;statusEl.className='spectate-status spectate-status-'+cls;}
const attemptsEl=card.querySelector('.spectate-attempts');if(attemptsEl)attemptsEl.textContent='Attempts: '+p.attemptsUsed+'/6';
const msgEl=card.querySelector('.spectate-status-msg');if(msgEl)msgEl.textContent=getStatusMessage(p.status,p.attemptsUsed);
if(status==='solved'){card.classList.add('spectate-card-solved');}else if(status==='failed'){card.classList.add('spectate-card-failed');}}

function getStatusMessage(status,attempts){const rem=6-attempts;switch(status){case'solved':return '🎉 Solved the puzzle!';case'failed':return '💔 Ran out of attempts';default:if(rem<=1)return '⚠️ One guess away!';if(rem<=2)return '🔍 Getting close…';if(rem<=3)return '🤔 Still thinking…';return '📝 Working on it…';}}

function submitGuess(gs){if(roundSolved||currentRow>=WR)return;const g=gs.toLowerCase();if(!dictionary.includes(g)&&!targetWords.includes(g)){showAlert('Not in word list',1500);for(let i=0;i<WL;i++){const t=guessGrid.children[currentRow*WL+i];t.classList.add('shake');t.addEventListener('animationend',()=>t.classList.remove('shake'),{once:true});}return;}if(isSoloMode)handleSolo(g);else send({type:'guess',guess:g});}

function handleKey(key){if(gameState!=='playing'||roundSolved)return;if(key==='Enter'){if(currentGuess.length===WL)submitGuess(currentGuess.join(''));else showAlert('Not enough letters',1000);}else if(key==='Backspace'||key==='Delete'){if(currentGuess.length>0){currentGuess.pop();const t=guessGrid.children[currentRow*WL+currentGuess.length];t.textContent='';t.dataset.state='';}}else if(/^[a-zA-Z]$/.test(key)&&currentGuess.length<WL){currentGuess.push(key.toLowerCase());const t=guessGrid.children[currentRow*WL+currentGuess.length-1];t.textContent=key.toUpperCase();t.dataset.state='active';}}

function showRoundEnd(d){gameState='roundEnd';roundSolved=true;myGameComplete=false;sessionStorage.removeItem('wordle_roundComplete');document.querySelector('[data-round-end-title]').textContent='Round '+d.round+' Complete!';document.querySelector('[data-round-word]').textContent=d.word.toUpperCase();const div=document.querySelector('[data-round-results]');div.innerHTML='';Object.values(d.results).sort((a,b)=>b.roundScore-a.roundScore).forEach(r=>{const e=document.createElement('div');e.className='round-result-entry';e.innerHTML='<span class="r-name">'+esc(r.playerName)+'</span><span class="r-stats">'+(r.solved?('Solved in '+r.attempts+' '+(r.attempts===1?'try':'tries')+' ('+r.timeTaken+'s)'):'Did not solve')+'</span><span class="r-score">+'+r.roundScore+'</span>';div.appendChild(e);});showScreen('roundEnd');const nb=document.querySelector('[data-next-round-btn]'),td=document.querySelector('.round-end-timer'),cs=document.querySelector('[data-round-end-countdown]');if(isHost&&d.round<d.totalRounds){nb.classList.remove('hidden');td.classList.add('hidden');}else if(d.round<d.totalRounds){nb.classList.add('hidden');td.classList.remove('hidden');let c=15;cs.textContent=c;const iv=setInterval(()=>{c--;if(c<=0)clearInterval(iv);else cs.textContent=c;},1000);}else{nb.classList.add('hidden');td.classList.add('hidden');}}
function showGameEnd(d){gameState='finished';myGameComplete=false;sessionStorage.removeItem('wordle_roundComplete');showScreen('gameEnd');const pod=document.querySelector('[data-podium]');pod.innerHTML='';const t3=d.players.slice(0,3);[t3[1],t3[0],t3[2]].filter(Boolean).forEach((p,i)=>{const s=document.createElement('div');s.className='podium-spot '+['second','first','third'][i];const em=p===t3[0]?'🥇':p===t3[1]?'🥈':'🥉';s.innerHTML='<div class="pos">'+em+'</div><div class="pname">'+esc(p.name)+'</div><div class="pscore">'+p.score+' pts</div>';pod.appendChild(s);});const fs=document.querySelector('[data-final-scores]');fs.innerHTML='';d.players.forEach(p=>{const e=document.createElement('div');e.className='final-score-entry';e.innerHTML='<span class="f-rank">#'+p.rank+'</span><span class="f-name">'+esc(p.name)+'</span><span class="f-rounds">('+p.roundScores.join(' + ')+')</span><span class="f-total">'+p.score+'</span>';fs.appendChild(e);});}
function startSolo(){if(!targetWords||!targetWords.length){showAlert('Word list not loaded. Refresh and try again.',3000);return;}isSoloMode=true;gameState='playing';currentRow=0;currentGuess=[];roundSolved=false;myGameComplete=false;soloTargetWord=targetWords[Math.floor(Math.random()*targetWords.length)];resetBoard();showScreen('game');document.querySelector('[data-round-num]').textContent='1';document.querySelector('[data-total-rounds]').textContent='1';if(timerDisplay){timerDisplay.textContent='∞';timerDisplay.classList.remove('warning','danger');}if(leaderboardList)leaderboardList.innerHTML='<div class="leaderboard-entry"><span>Solo Play</span></div>';}
function handleSolo(g){const fb=calcFb(g,soloTargetWord),solved=g===soloTargetWord;for(let i=0;i<WL;i++){const t=guessGrid.children[currentRow*WL+i];t.textContent=g[i].toUpperCase();t.dataset.state=fb[i];t.classList.add('flip');t.addEventListener('transitionend',()=>t.classList.remove('flip'),{once:true});}for(let i=0;i<WL;i++){const k=keyboardEl.querySelector('[data-key="'+g[i].toUpperCase()+'"]');if(!k)continue;const cs=k.dataset.state,ns=fb[i];if(ns==='correct'||(ns==='wrong-location'&&cs!=='correct')||(ns==='wrong'&&!cs)){k.dataset.state=ns;k.classList.remove('wrong','wrong-location','correct');k.classList.add(ns);}}if(solved){roundSolved=true;for(let i=0;i<WL;i++){const t=guessGrid.children[currentRow*WL+i];setTimeout(()=>{t.classList.add('dance');t.addEventListener('animationend',()=>t.classList.remove('dance'),{once:true});},i*100);}showAlert('Solved in '+(currentRow+1)+' '+(currentRow===0?'try':'tries')+'!',3000);setTimeout(resetToMenu,3000);}else if(currentRow>=WR-1){roundSolved=true;showAlert('The word was: '+soloTargetWord.toUpperCase(),4000);setTimeout(resetToMenu,4000);}currentRow++;currentGuess=[];}
function calcFb(guess,word){const r=Array(WL).fill('wrong'),wa=word.split(''),ga=guess.split(''),used=Array(WL).fill(false);for(let i=0;i<WL;i++){if(ga[i]===wa[i]){r[i]='correct';used[i]=true;}}for(let i=0;i<WL;i++){if(r[i]==='correct')continue;for(let j=0;j<WL;j++){if(!used[j]&&ga[i]===wa[j]){r[i]='wrong-location';used[j]=true;break;}}}return r;}
function resetToMenu(){if(ws&&roomId)send({type:'leaveRoom'});sessionStorage.removeItem('wordle_roomId');sessionStorage.removeItem('wordle_playerName');sessionStorage.removeItem('wordle_roundComplete');gameState='menu';isSoloMode=false;isHost=false;roomId=null;playerId=null;soloTargetWord='';roundSolved=false;myGameComplete=false;currentRow=0;currentGuess=[];leaderboardData=[];spectateData={};resetBoard();showScreen('menu');}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// Event bindings
document.querySelector('[data-create-room-btn]').addEventListener('click',()=>showScreen('createRoom'));
document.querySelector('[data-join-room-btn]').addEventListener('click',()=>showScreen('joinRoom'));
document.querySelector('[data-play-solo-btn]').addEventListener('click',startSolo);
document.querySelector('[data-create-cancel]').addEventListener('click',()=>showScreen('menu'));
document.querySelector('[data-create-confirm]').addEventListener('click',()=>{const n=document.getElementById('create-player-name').value.trim();if(!n){showAlert('Enter name',2000);return;}playerName=n;send({type:'createRoom',playerName,rounds:+document.getElementById('create-rounds').value,timePerRound:+document.getElementById('create-time').value,maxPlayers:+document.getElementById('create-max-players').value});});
document.querySelector('[data-join-cancel]').addEventListener('click',()=>showScreen('menu'));
document.querySelector('[data-join-confirm]').addEventListener('click',()=>{const n=document.getElementById('join-player-name').value.trim();const c=document.getElementById('join-room-id').value.trim().toUpperCase();if(!n){showAlert('Enter name',2000);return;}if(!c){showAlert('Enter room ID',2000);return;}playerName=n;send({type:'joinRoom',playerName,roomId:c});});
document.querySelector('[data-start-game-btn]').addEventListener('click',()=>send({type:'startGame'}));
document.querySelector('[data-leave-room-btn]').addEventListener('click',resetToMenu);
document.querySelector('[data-copy-room-btn]').addEventListener('click',()=>{if(roomId)navigator.clipboard.writeText(roomId).then(()=>showAlert('Copied!',1500)).catch(()=>{});});
document.querySelector('[data-chat-send]').addEventListener('click',()=>{const m=chatInput.value.trim();if(m){send({type:'chatMessage',message:m});chatInput.value='';}});
chatInput.addEventListener('keypress',(e)=>{if(e.key==='Enter'){const m=chatInput.value.trim();if(m){send({type:'chatMessage',message:m});chatInput.value='';}}});
document.querySelector('[data-next-round-btn]').addEventListener('click',()=>{send({type:'nextRound'});showScreen('game');resetBoard();});
document.querySelector('[data-leave-game-btn]').addEventListener('click',()=>{if(confirm('Leave game?'))resetToMenu();});
document.querySelector('[data-back-to-menu-btn]').addEventListener('click',resetToMenu);
// God Mode back button
const godModeBackBtn = document.querySelector('[data-god-mode-back-btn]');
if(godModeBackBtn)godModeBackBtn.addEventListener('click',()=>{showScreen('game');document.querySelector('[data-game-main]').style.display='';document.querySelector('[data-leaderboard]').style.display='';});
// Keyboard click
keyboardEl.addEventListener('click',(e)=>{if(gameState!=='playing')return;const k=e.target.closest('[data-key]');if(k)handleKey(k.dataset.key);else if(e.target.closest('[data-enter]'))handleKey('Enter');else if(e.target.closest('[data-delete]'))handleKey('Backspace');});
// Physical keyboard
document.addEventListener('keydown',(e)=>{if(gameState!=='playing')return;e.preventDefault();if(e.key==='Enter')handleKey('Enter');else if(e.key==='Backspace'||e.key==='Delete')handleKey('Backspace');else if(/^[a-zA-Z]$/.test(e.key))handleKey(e.key);});
// Room ID input
document.getElementById('join-room-id').addEventListener('input',(e)=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');});
// Init
loadDicts().then(()=>{connectWS();showScreen('menu');});
