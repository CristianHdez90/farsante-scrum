'use strict';
const crypto = require('node:crypto');
const ROOMS = new Map();
const MAX_PLAYERS = 12;
const MIN_PLAYERS = 3;
const ROLE_MS = 90000;
const CLUE_MS = 60000;
const DISCUSSION_MS = 45000;
const VOTE_MS = 75000;
const REVEAL_MS = 18000;
const GUESS_MS = 45000;
const DEFAULT_WORDS = [
  'Scrum', 'Sprint', 'Daily', 'HA', 'Backlog', 'Refinamiento', 'QA', 'Bug',
  'Regresión', 'Retrospectiva', 'Automatización', 'Definition of Done',
  'Planning', 'Sprint Goal', 'Historia de usuario', 'Criterios de aceptación',
  'Pruebas API', 'Deploy', 'CI/CD', 'Smoke Testing'
];
const random = n => crypto.randomInt(n);
const id = () => crypto.randomBytes(18).toString('hex');
const normalize = s => String(s || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
const cleanName = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 26);
const pick = list => list[random(list.length)];
const shuffle = original => {
  const result = [...original];
  for (let i=result.length - 1; i>0; i--) {const j = random(i+1); [result[i], result[j]] = [result[j], result[i]];}
  return result;
};
const validWords = input => {
  const raw = Array.isArray(input) ? input : String(input || '').split(/\r?\n|,/);
  const unique = [...new Map(raw.map(w => String(w).trim().replace(/\s+/g, ' ')).filter(w => w.length >= 2 && w.length <= 55).map(w => [normalize(w), w])).values()];
  return unique.slice(0, 100);
};
const newCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({length:5}, () => alphabet[random(alphabet.length)]).join(''); } while (ROOMS.has(code));
  return code;
};
function createRoom(name, words, {shared=false}={}) {
  const code = newCode();
  const room = {code, shared, hostId:null, players:[], words:words.length>=3?words:DEFAULT_WORDS,
    stage:'lobby', round:0, order:[], turnIndex:0, clues:[], votes:{}, eligibleVoterIds:[], readyPlayerIds:[],
    imposterId:null, secret:null, eliminated:[], outcome:null, votingResults:[],
    lastRemoved:null, winner:null, timer:null, deadline:null, streams:new Map(), lastActivity:Date.now()};
  if(!shared)ROOMS.set(code,room);
  const player = addPlayer(room,name);
  room.hostId = player.id;
  return {room,player};
}
function addPlayer(room,name) {
  const player = {id:id(), token:id(), name, eliminated:false};
  room.players.push(player);
  return player;
}
function getPlayer(room,token) {return room.players.find(p => p.token===token);}
const alive = room => room.players.filter(p => !p.eliminated);
const isOnline = (room, player) => room.shared ? Date.now()-(player.lastSeen||0)<30000 : Boolean(room.streams.get(player.id)?.size);
function publicState(room, viewer) {
  const impersonator = room.stage === 'finished' ? room.players.find(p=>p.id===room.imposterId)?.name : undefined;
  return {
    transport:room.shared?'poll':'sse',
    code:room.code, stage:room.stage, round:room.round, isHost:viewer.id===room.hostId,
    me: {id:viewer.id,name:viewer.name,eliminated:viewer.eliminated,
      role:room.stage==='lobby' ? null : (viewer.id===room.imposterId?'impostor':'normal'),
      word:room.stage==='lobby'||viewer.id===room.imposterId ? null : room.secret},
    players:room.players.map(p=>({id:p.id,name:p.name,eliminated:p.eliminated,online:isOnline(room,p),host:p.id===room.hostId})),
    wordCount:room.words.length,
    words:room.stage==='lobby' && viewer.id===room.hostId ? room.words : undefined,
    minPlayers:MIN_PLAYERS,maxPlayers:MAX_PLAYERS,
    turnPlayerId:room.order[room.turnIndex]||null,turnIndex:room.turnIndex,
    order:room.order,clues:room.clues,
    readyCount:room.readyPlayerIds.length,readySubmitted:room.readyPlayerIds.includes(viewer.id),
    voteSubmitted:Boolean(room.votes[viewer.id]),
    voteCount:Object.keys(room.votes).length,
    expectedVotes:room.eligibleVoterIds.length,
    deadline:room.deadline,
    outcome:room.outcome,votingResults:room.stage==='reveal'||room.stage==='guess'||room.stage==='finished' ? room.votingResults:[],
    lastRemoved:room.lastRemoved,
    winner:room.winner,
    reveal:room.stage==='finished' ? {word:room.secret,impostor:impersonator} : undefined
  };
}
function publish(room) {
  room.lastActivity = Date.now();
  if(room.shared)return;
  for (const p of room.players) {
    const streams = room.streams.get(p.id);
    if (!streams) continue;
    const data = `event: state\ndata: ${JSON.stringify(publicState(room,p))}\n\n`;
    for (const res of streams) {try {res.write(data);} catch {streams.delete(res);}}
  }
}
function stopTimer(room) {if(room.timer) clearTimeout(room.timer); room.timer=null;room.deadline=null;}
function setTimer(room,ms,fn) {
  stopTimer(room);
  room.deadline = (room.transitionTime??Date.now())+ms;
  if(room.shared)return;
  room.timer=setTimeout(()=>{room.timer=null;room.deadline=null;fn();publish(room);},ms);
  room.timer.unref?.();
}
function setWinner(room,winner) { stopTimer(room);room.winner=winner;room.stage='finished'; }
function beginRoles(room) {
  room.stage='roles';room.readyPlayerIds=[];
  setTimer(room, ROLE_MS, () => startClues(room));
}
function maybeStartClues(room) {
  if(room.stage==='roles' && room.players.every(p=>room.readyPlayerIds.includes(p.id))) startClues(room);
}
function advanceClue(room, clue) {
  const current=room.players.find(p=>p.id===room.order[room.turnIndex]);
  room.clues.push(clue || {playerId:current?.id,playerName:current?.name||'Jugador',clue:'Sin pista',skipped:true});
  room.turnIndex++;
  if(room.turnIndex>=room.order.length)openDiscussion(room);else scheduleClue(room);
}
function scheduleClue(room) {
  setTimer(room,CLUE_MS,()=>advanceClue(room,null));
}
function startClues(room) {
  stopTimer(room);
  const remaining=alive(room);
  if (remaining.length<=2) {setWinner(room,'impostor');return;}
  room.round++;
  room.stage='clues';
  room.order=shuffle(remaining.map(p=>p.id));
  room.turnIndex=0;
  room.clues=[];room.votes={};room.eligibleVoterIds=[];
  room.votingResults=[];room.outcome=null;room.lastRemoved=null;
  scheduleClue(room);
}
function openDiscussion(room) {
  room.stage='discussion';
  setTimer(room,DISCUSSION_MS,()=>startVote(room));
}
function startVote(room) {
  stopTimer(room);
  room.stage='vote';room.votes={};
  // El conjunto de votantes no cambia con la conexión: nadie puede excluir rivales desconectándolos.
  room.eligibleVoterIds=alive(room).map(p=>p.id);
  setTimer(room,VOTE_MS,()=>finishVote(room));
}
function maybeCompleteVotes(room) {
  if (room.stage!=='vote')return;
  if (room.eligibleVoterIds.length && room.eligibleVoterIds.every(pid=>room.votes[pid])) finishVote(room);
}
function finishVote(room) {
  if(room.stage!=='vote')return;
  stopTimer(room);
  // Requiere al menos 2/3 de votos para que una desconexión no cause una expulsión arbitraria.
  const required=Math.ceil(room.eligibleVoterIds.length*2/3);
  const count=new Map();
  for (const target of Object.values(room.votes)) count.set(target,(count.get(target)||0)+1);
  room.votingResults=alive(room).map(p=>({id:p.id,name:p.name,votes:count.get(p.id)||0})).sort((a,b)=>b.votes-a.votes);
  if(Object.keys(room.votes).length < required) {
    room.outcome='quorum';room.lastRemoved=null;room.stage='reveal';
    setTimer(room,REVEAL_MS,()=>startClues(room));
    return;
  }
  const highest=room.votingResults[0]?.votes || 0;
  const leaders=room.votingResults.filter(p=>p.votes===highest);
  if (leaders.length!==1) {
    room.outcome='tie';room.lastRemoved=null;room.stage='reveal';
    setTimer(room,REVEAL_MS,()=>startClues(room));return;
  }
  const target=room.players.find(p=>p.id===leaders[0].id);
  target.eliminated=true;
  room.lastRemoved={id:target.id,name:target.name,wasImpostor:target.id===room.imposterId};
  if(target.id===room.imposterId) {
    room.outcome='caught';room.stage='guess';
    setTimer(room,GUESS_MS,()=>setWinner(room,'equipo'));
  } else if(alive(room).length<=2) {
    room.outcome='innocent';setWinner(room,'impostor');
  } else {
    room.outcome='innocent';room.stage='reveal';
    setTimer(room,REVEAL_MS,()=>startClues(room));
  }
}
function resetRoom(room) {
  stopTimer(room);
  room.stage='lobby';room.round=0;room.order=[];room.turnIndex=0;room.clues=[];
  room.votes={};room.eligibleVoterIds=[];room.readyPlayerIds=[];room.imposterId=null;room.secret=null;
  room.eliminated=[];room.outcome=null;room.votingResults=[];room.lastRemoved=null;room.winner=null;
  room.players.forEach(p=>p.eliminated=false);
}
function fail(message,status=400) {const e=new Error(message);e.status=status;throw e;}
function action(room,p,data) {
  if (!data || typeof data.type!=='string') fail('Acción no válida');
  const host=room.hostId===p.id;
  switch(data.type) {
    case 'words': {
      if(!host || room.stage!=='lobby')fail('Solo el anfitrión puede cambiar las palabras');
      const words=validWords(data.words);
      if(words.length<3)fail('Agrega al menos 3 palabras diferentes');
      room.words=words;
      break;
    }
    case 'start': {
      if(!host || room.stage!=='lobby')fail('Solo el anfitrión puede iniciar la partida');
      if(room.players.length<MIN_PLAYERS)fail(`Se necesitan al menos ${MIN_PLAYERS} participantes`);
      if(room.players.some(player=>!isOnline(room,player)))fail('Todos los jugadores deben estar conectados');
      room.imposterId=pick(room.players).id;
      room.secret=pick(room.words);
      room.round=0;
      room.players.forEach(player=>player.eliminated=false);
      beginRoles(room);
      break;
    }
    case 'ready': {
      if(room.stage!=='roles')fail('La fase de roles terminó');
      if(!room.readyPlayerIds.includes(p.id))room.readyPlayerIds.push(p.id);
      maybeStartClues(room);
      break;
    }
    case 'clue': {
      if(room.stage!=='clues'||room.order[room.turnIndex]!==p.id)fail('Aún no es tu turno');
      const clue=String(data.clue||'').trim();
      if(!clue||clue.length>36||/\s/u.test(clue))fail('La pista debe tener una sola palabra (máximo 36 caracteres)');
      if(normalize(clue)===normalize(room.secret))fail('No puedes revelar la palabra secreta');
      if(room.clues.some(c=>normalize(c.clue)===normalize(clue)))fail('Esa pista ya se utilizó');
      advanceClue(room,{playerId:p.id,playerName:p.name,clue});
      break;
    }
    case 'skip': {
      if(!host||room.stage!=='clues')fail('Solo el anfitrión puede saltar una pista');
      advanceClue(room,null);
      break;
    }
    case 'voting': {
      if(!host||room.stage!=='discussion')fail('Solo el anfitrión puede abrir la votación');
      startVote(room);
      break;
    }
    case 'vote': {
      if(room.stage!=='vote'||p.eliminated)fail('No puedes votar en este momento');
      if(room.votes[p.id])fail('Ya has votado');
      const target=room.players.find(pl=>pl.id===data.targetId&&!pl.eliminated);
      if(!target||target.id===p.id)fail('Elige otro participante que siga en juego');
      if(!room.eligibleVoterIds.includes(p.id))fail('No tienes permiso para votar en esta ronda');
      room.votes[p.id]=target.id;
      maybeCompleteVotes(room);
      break;
    }
    case 'closeVote': {
      if(!host||room.stage!=='vote')fail('Solo el anfitrión puede cerrar la votación');
      if(Object.keys(room.votes).length<Math.ceil(room.eligibleVoterIds.length*2/3))fail('Se necesitan al menos dos tercios de los votos');
      finishVote(room);
      break;
    }
    case 'guess': {
      if(room.stage!=='guess'||p.id!==room.imposterId)fail('Esta oportunidad es solo para el impostor');
      const guess=String(data.guess||'').trim();
      if(!guess||guess.length>60)fail('Escribe una palabra válida');
      setWinner(room,normalize(guess)===normalize(room.secret)?'impostor':'equipo');
      break;
    }
    case 'next': {
      if(!host||room.stage!=='reveal')fail('No se puede iniciar la siguiente ronda');
      startClues(room);
      break;
    }
    case 'reset': {
      if(!host)fail('Solo el anfitrión puede reiniciar el juego');
      resetRoom(room);
      break;
    }
    case 'leave': {
      if(room.stage!=='lobby'&&room.stage!=='finished')fail('Puedes salir desde la sala de espera o al finalizar la partida');
      room.players=room.players.filter(pl=>pl.id!==p.id);
      if(host)room.hostId=room.players[0]?.id||null;
      if(!room.players.length){stopTimer(room);ROOMS.delete(room.code);}
      break;
    }
    default: fail('Acción desconocida');
  }
  publish(room);
}
function advanceExpired(room, now=Date.now()) {
  // Every transition starts at the previous deadline, even after a cold start.
  let steps=0;
  while(room.deadline && room.deadline<=now){
    if(++steps>2048)fail('La sala lleva demasiado tiempo inactiva',410);
    room.transitionTime=room.deadline;
    switch(room.stage){
      case 'roles':startClues(room);break;
      case 'clues':advanceClue(room,null);break;
      case 'discussion':startVote(room);break;
      case 'vote':finishVote(room);break;
      case 'reveal':startClues(room);break;
      case 'guess':setWinner(room,'equipo');break;
      default:stopTimer(room);
    }
    delete room.transitionTime;
  }
}
module.exports={ROOMS,DEFAULT_WORDS,normalize,createRoom,addPlayer,getPlayer,publicState,publish,action,advanceExpired,validWords,cleanName,fail,MAX_PLAYERS};
