(() => {
  'use strict';
  const root=document.querySelector('#root');
  const toastEl=document.querySelector('#toast');
  const WORD_THEMES=globalThis.FarsanteThemes;
  const HOME_WORDS=WORD_THEMES.scrum.words;
  let lobbyDraft=null;
  let auth=loadAuth();
  let state=null;
  let stream=null;
  let showRole=false;
  let selectedTarget='';
  let wordsDraft=localStorage.getItem('farsanteWords')||HOME_WORDS.join('\n');
  let toastTimer;
  let connectionCheck=null;
  let starting=false;
  let resetting=false;
  let invitationCache=null;
  const invitationLink=()=>`${location.origin}/?sala=${encodeURIComponent(state.code)}`;
  const invitationCode=()=>(new URLSearchParams(location.search).get('sala')||'').replace(/[^a-z]/gi,'').toUpperCase().slice(0,5);
  const initialCode=invitationCode();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>String(n).padStart(2,'0');
  const $=sel=>root.querySelector(sel);
  const active=()=>state.players.filter(p=>!p.eliminated);
  const member=id=>state.players.find(p=>p.id===id);
  const you=()=>state.me;
  const host=()=>state.isHost;
  const isMyTurn=()=>state.stage==='clues'&&state.turnPlayerId===you().id;
  function loadAuth() {try{return JSON.parse(localStorage.getItem('farsanteAuth')||'null');}catch{return null;}}
  function saveAuth(next){auth=next;if(next)localStorage.setItem('farsanteAuth',JSON.stringify(next));else localStorage.removeItem('farsanteAuth');}
  function notify(message,error=false){toastEl.textContent=message;toastEl.className=(error?'error ':'')+'show';clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.className='',3500);}
  async function request(url,body) {
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const json=await res.json();
    if(!res.ok)throw new Error(json.error||'Ocurrió un error');
    return json;
  }
  async function send(type,rest={}) {
    if(!auth)return;
    try {const result=await request('/api/action',{...auth,type,...rest});if(result.state)acceptState(result.state);return true;}catch(e){notify(e.message,true);return false;}
  }
  function acceptState(next){
    const status=document.getElementById('netstatus');if(status)status.textContent='EN LÍNEA';
    if(JSON.stringify(state)===JSON.stringify(next))return;
    const switched=state&&(state.stage!==next.stage||state.round!==next.round);
    if(switched){showRole=false;selectedTarget='';}
    state=next;render();
  }
  function startPolling(){
    const session=auth;
    let closed=false,timer;
    const controller=new AbortController();
    stream={close(){closed=true;clearTimeout(timer);controller.abort();}};
    const poll=async()=>{
      if(closed||auth!==session)return;
      try{
        const response=await fetch(`/api/state?room=${encodeURIComponent(session.room)}&token=${encodeURIComponent(session.token)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),cache:'no-store'});
        if(closed||auth!==session)return;
        if([403,404,410].includes(response.status)){
          stream.close();stream=null;saveAuth(null);state=null;
          history.replaceState({},'','/');render();notify('La sala expiró. Crea o únete a una nueva sala.',true);return;
        }
        if(!response.ok)throw new Error('No connection');
        acceptState(await response.json());
      }catch{
        if(!closed){const status=document.getElementById('netstatus');if(status)status.textContent='Reconectando…';}
      }finally{if(!closed&&auth===session)timer=setTimeout(poll,1500);}
    };
    timer=setTimeout(poll,1500);
  }
  async function connect() {
    if(!auth)return;
    if(stream){stream.close();stream=null;}
    if(connectionCheck){clearTimeout(connectionCheck);connectionCheck=null;}
    try {
      const res=await fetch(`/api/state?room=${encodeURIComponent(auth.room)}&token=${encodeURIComponent(auth.token)}`);
      if(!res.ok) {if([403,404,410].includes(res.status)){saveAuth(null);state=null;render();return;}throw new Error('No connection');}
      state=await res.json();
      render();
      if(state.transport==='poll'){startPolling();return;}
      stream=new EventSource(`/api/events?room=${encodeURIComponent(auth.room)}&token=${encodeURIComponent(auth.token)}`);
      stream.addEventListener('state',event=>{
        try {
          const next=JSON.parse(event.data);
          acceptState(next);
        }catch(e){console.error(e);}
      });
      stream.onerror=()=>{
        const status=document.getElementById('netstatus');if(status)status.textContent='Reconectando…';
        if(connectionCheck)return;
        connectionCheck=setTimeout(async()=>{
          connectionCheck=null;
          if(!auth)return;
          try{
            const response=await fetch(`/api/state?room=${encodeURIComponent(auth.room)}&token=${encodeURIComponent(auth.token)}`);
            if(response.status===403||response.status===404){
              stream?.close();stream=null;saveAuth(null);state=null;
              history.replaceState({},'','/');render();
              notify('La sala expiró o el servidor se reinició. Crea o únete a una nueva sala.',true);
            }
          }catch{/* La conexión podría ser temporal: EventSource seguirá reintentando. */}
        },3000);
      };
    }catch(e){notify('Sin conexión con el servidor',true);render();}
  }
  function header(){
    return `<header class="topbar"><div class="brand"><span class="brand-mark">🕵️</span><span>Farsante <strong>Scrum</strong></span></div><span class="tag">● SPRINT EDITION</span></header>`;
  }
  function shell(content){root.innerHTML=`<div class="shell">${header()}${content}<div class="footer">Diseñado para retrospectivas ágiles · Juega por Teams o en persona · Sin registro</div></div>`;updateCountdown();renderInvitation();}
  function themeForWords(text){
    const words=String(text).split('\n').map(w=>w.trim().toLocaleLowerCase('es')).filter(Boolean);
    return Object.keys(WORD_THEMES).find(key=>{
      const expected=WORD_THEMES[key].words;
      return expected.length===words.length&&expected.every((w,i)=>w.toLocaleLowerCase('es')===words[i]);
    })||'custom';
  }
  function themePicker(id,words){
    const selected=themeForWords(words);
    return `<label class="field" for="${id}">Elige un grupo de palabras</label><select id="${id}" class="theme-select"><option value="custom" ${selected==='custom'?'selected':''}>✍️ Palabras personalizadas</option>${Object.entries(WORD_THEMES).map(([key,theme])=>`<option value="${key}" ${selected===key?'selected':''}>${esc(theme.name)} · ${theme.words.length} palabras</option>`).join('')}</select><p class="hint">Al elegir un grupo, sus palabras se cargan en el editor. Puedes personalizarlas.</p>`;
  }
  function lobbyWords(){
    const saved=state.words.join('\n');
    if(lobbyDraft?.room!==state.code||lobbyDraft.saved!==saved)lobbyDraft={room:state.code,saved,value:saved};
    return lobbyDraft.value;
  }
  function loadTheme(select){
    const theme=WORD_THEMES[select.value];
    if(!theme)return;
    const isHome=select.id==='create-theme';
    const textarea=$(isHome?'#create-words':'#lobby-words');
    if(!textarea)return;
    textarea.value=theme.words.join('\n');
    if(isHome)wordsDraft=textarea.value;else lobbyDraft.value=textarea.value;
    notify(isHome?`Tema ${theme.name} seleccionado`:`Tema ${theme.name} cargado. Pulsa Guardar palabras para aplicarlo.`);
  }
  function renderHome() {
    shell(`<section class="hero"><span class="tag">🎭 EL JUEGO DEL IMPOSTOR PARA EQUIPOS ÁGILES</span><h1>¿Quién está<br><span class="gradient">fingiendo?</span></h1><p>Todos conocen la palabra secreta… excepto uno. Descubre al farsante entre tus compañeros de Scrum. Salas privadas, pistas por turnos y votaciones automáticas.</p><div class="three-feature"><span class="feature">⚡ En tiempo real</span><span class="feature">🗳️ Votaciones integradas</span><span class="feature">🎲 Orden aleatorio</span><span class="feature">🧩 Palabras Scrum y QA</span></div></section>
    <section class="two-col"><div class="panel accent"><div class="card-emoji">🚀</div><h2>Crear una sala</h2><p class="description">Organiza tu retrospectiva e invita al equipo con un código de 5 letras.</p><form id="create-form"><label for="create-name" class="field">Tu nombre</label><input id="create-name" name="name" placeholder="Ej.: Alex - Scrum Master" minlength="2" maxlength="26" required autocomplete="nickname"/><label class="field" for="create-words">Palabras secretas (una por línea)</label>${themePicker('create-theme',wordsDraft)}<button class="ghost small" type="button" data-action="scrum-theme">Restaurar tema Scrum</button><textarea id="create-words" name="words" spellcheck="false">${esc(wordsDraft)}</textarea><p class="hint">Se elegirá una palabra aleatoria. Usa al menos 3 diferentes. Elige Scrum, Comida, Música o Tecnología e IA para variar las partidas.</p><div class="form-actions"><button class="primary full" type="submit">Crear mi sala →</button></div></form></div>
    <div class="panel"><div class="card-emoji">🔑</div><h2>Unirme a una sala</h2><p class="description">Ingresa el código compartido en Teams y prepárate para dar tu mejor pista.</p><form id="join-form">${invitationCode()?`<p class="invitation-notice">Te invitaron a la sala <strong>${esc(invitationCode())}</strong>. Escribe tu nombre para entrar.</p>`:''}<label class="field" for="join-name">Tu nombre</label><input id="join-name" name="name" placeholder="Ej.: Dani - QA" minlength="2" maxlength="26" required autocomplete="nickname"/><label class="field" for="join-code">Código de sala</label><input id="join-code" name="room" placeholder="ABCDE" maxlength="5" minlength="5" value="${esc(invitationCode())}" autocapitalize="characters" required style="letter-spacing:3px;font-weight:800"/><div class="form-actions"><button class="secondary full" type="submit">Unirme al juego →</button></div></form><div class="divider"></div><h3 style="font-size:15px">¿Cómo funciona?</h3><p class="description" style="margin-bottom:0">1. Mira tu rol secreto.<br>2. Da una pista cuando sea tu turno.<br>3. Debate y vota por el farsante.<br>4. Si lo atrapan, puede adivinar la palabra.</p></div></section>`);
    if(invitationCode())$('#join-form').scrollIntoView({block:'center'});
  }
  function playersGrid() {
    return `<div class="player-grid">${state.players.map((p,i)=>`<div class="player-pill ${p.online?'':'offline'}"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><div style="min-width:0;flex:1"><div class="player-name" title="${esc(p.name)}">${esc(p.name)} ${p.id===you().id?'(tú)':''}</div><div class="player-hint">${p.eliminated?'Eliminado':p.host?'Anfitrión':'En sala'}</div></div><span class="status-dot ${p.online?'':'offline'}" title="${p.online?'Conectado':'Sin conexión'}"></span></div>`).join('')}</div>`;
  }
  function roomButton(){return `<div class="room-code"><div><div class="eyebrow" style="margin:0">CÓDIGO DE SALA</div><div class="code-big">${esc(state.code)}</div></div><button class="secondary small" data-action="copy">🔗 Compartir</button></div>`;}
  function roomControls(){
    const canReset=host()&&state.stage!=='lobby'&&state.stage!=='finished';
    return `<div class="room-actions">${roomButton()}${canReset?`<button class="danger small" data-action="reset" ${resetting?'disabled':''} title="Volver a la sala de espera conservando los participantes y las palabras">${resetting?'Reiniciando…':'🔄 Reiniciar partida'}</button>`:''}</div>`;
  }
  async function resetGame(){
    if(resetting||!auth)return;
    resetting=true;render();
    try{
      const result=await request('/api/action',{...auth,type:'reset'});
      showRole=false;selectedTarget='';lobbyDraft=null;
      if(result.state)acceptState(result.state);
      notify('Partida reiniciada. Ya pueden salir de la sala o iniciar otra partida.');
    }catch(e){notify(e.message,true);}
    finally{resetting=false;render();}
  }
  function roomHeading(){return `<div class="page-header"><div><div class="eyebrow">SALA PRIVADA · <span id="netstatus">EN LÍNEA</span></div><h1 class="page-title">${state.stage==='lobby'?'Prepara tu partida':'La verdad está entre nosotros.'}</h1><p class="page-subtitle">${state.stage==='lobby'?'Invita a todos desde Teams. Nadie necesita registrarse.':`Ronda ${state.round} · ${active().length} jugadores en juego`}</p></div>${roomControls()}</div>`;}
  function renderInvitation() {
    const target=$('#room-qr');
    if(!target)return;
    try {
      const link=invitationLink();
      if(invitationCache?.link!==link){
        const qr=qrcode(0,'M');
        qr.addData(link,'Byte');qr.make();
        invitationCache={link,svg:qr.createSvgTag({cellSize:5,margin:20,scalable:true})};
      }
      target.innerHTML=invitationCache.svg;
    }catch{
      target.textContent='No se pudo generar el QR. Comparte el enlace o el código de sala.';
    }
  }
  function invitationPanel(){
    const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
    return `<div class="panel invitation"><div class="eyebrow">INVITA A TU EQUIPO</div><h3>Escanea y únete al juego</h3><p class="description">Abre la cámara de tu celular y escanea el QR. Solo tendrás que escribir tu nombre.</p><div id="room-qr" class="room-qr" role="img" aria-label="Código QR para unirse a la sala ${esc(state.code)}"></div><label class="field" for="room-link">Enlace de invitación</label><input id="room-link" readonly value="${esc(invitationLink())}"/><button class="secondary full" data-action="copy">🔗 Copiar enlace</button>${local?'<p class="hint">Estás usando localhost: este QR solo funciona en este equipo. Para usar celulares, abre la aplicación con la IP del servidor en la misma red o con una dirección pública.</p>':'<p class="hint">Los participantes deben poder acceder a esta dirección. Si usas una IP local, deben estar en la misma red.</p>'}</div>`;
  }
  function startStatus(){
    const missing=Math.max(0,state.minPlayers-state.players.length);
    if(missing)return `Falta${missing===1?'':'n'} ${missing} participante${missing===1?'':'s'} para comenzar.`;
    const offline=state.players.filter(p=>!p.online);
    if(offline.length)return `Esperando conexión de: ${offline.map(p=>p.name).join(', ')}.`;
    return '¡Todo listo! El anfitrión puede iniciar el juego.';
  }
  async function startGame(){
    if(starting)return;
    starting=true;render();
    try {
      const result=await request('/api/action',{...auth,type:'start'});
      if(result.state)acceptState(result.state);
    }catch(e){notify(e.message,true);}
    finally{starting=false;render();}
  }
  function renderLobby() {
    shell(`${roomHeading()}<div class="game-layout"><div class="aside"><div class="panel"><div class="section-head"><h3 class="section-title">👥 Equipo conectado</h3><span class="tag">${state.players.length}/${state.maxPlayers}</span></div>${playersGrid()}<p class="hint" id="start-status">${esc(startStatus())}</p>${host()?`<button class="primary full" data-action="start" aria-describedby="start-status" ${starting||state.players.length<state.minPlayers||state.players.some(p=>!p.online)?'disabled':''}>${starting?'Iniciando partida…':'🎲 Iniciar juego'}</button>`:`<div class="log-placeholder">⏳ Esperando a que el anfitrión inicie...</div>`}<button class="ghost small" data-action="leave" style="margin-top:12px">Salir de la sala</button></div>${invitationPanel()}</div><div class="main"><div class="panel"><div class="eyebrow">CÓMO JUGAR</div><h2>¿Listos para descubrir al farsante?</h2><p class="faded">Al iniciar, cada persona recibe una palabra secreta. Una sola verá <b>IMPOSTOR</b>. Nadie, ni siquiera quien creó la sala, conoce la identidad del farsante.</p><div class="timeline"><span>01 · Rol secreto</span><span>02 · Pistas</span><span>03 · Debate</span><span>04 · Votación</span><span>05 · Resultado</span></div><div class="divider"></div><div class="section-head"><h3 class="section-title">🧩 Banco de palabras</h3><span class="tag">${state.wordCount} palabras</span></div>${host()?`<p class="description">Elige un grupo de 10 palabras o crea tu propia lista. Guarda los cambios antes de iniciar.</p><form id="words-form">${themePicker('lobby-theme',lobbyWords())}<textarea name="words" aria-label="Lista de palabras personalizadas" id="lobby-words">${esc(lobbyWords())}</textarea><div class="controls"><button class="secondary" type="submit">💾 Guardar palabras</button><button class="ghost" type="button" data-action="defaults">Restaurar tema Scrum</button></div></form>`:`<div class="log-placeholder">Grupo: ${esc(state.wordTheme)}. El anfitrión configuró ${state.wordCount} palabras posibles. La palabra elegida será sorpresa. 🤫</div>`}</div></div></div>`);
  }
  function roleCard(){
    const isImp=you().role==='impostor';
    const word =isImp?'IMPOSTOR':you().word;
    return `<div class="panel"><h3>🃏 Tu carta secreta</h3><p class="description">No compartas tu pantalla mientras la miras.</p><div class="role-card ${isImp?'impostor':''}"><div class="role-icon">${showRole?(isImp?'🕵️':'🔐'):'🙈'}</div><div class="role-label">${showRole?(isImp?'TU MISIÓN':'PALABRA SECRETA'):'SOLO PARA TUS OJOS'}</div><div class="role-text">${showRole?esc(word):'••••••••'}</div><div class="role-desc">${showRole?(isImp?'Deduce la palabra y pasa desapercibido.':'Da pistas sin revelar la palabra al impostor.'):'Toca para descubrir tu rol sin que nadie mire.'}</div><button class="secondary small" data-action="role">${showRole?'🙊 Ocultar carta':'👁️ Ver mi carta'}</button></div>${you().eliminated?`<div class="accent-quote">Ya fuiste eliminado. Puedes seguir observando la partida.</div>`:''}</div>`;
  }
  function miniPlayers(){return `<div class="panel"><h3>👥 Participantes</h3>${playersGrid()}${host() && state.stage==='clues'?`<p class="hint">Si alguien se desconecta en su turno, puedes saltarlo.</p><button data-action="skip" class="ghost small">Saltar turno actual →</button>`:''}</div>`;}
  function topGame(){return `${roomHeading()}<div class="game-layout"><div class="aside">${roleCard()}${miniPlayers()}</div><main class="main">`}
  function bottomGame(){return `</main></div>`}
  function clueLog(){return `<div class="section-head"><h3 class="section-title">💬 Pistas de la ronda</h3><span class="tag">${state.clues.length}/${state.order.length}</span></div>${state.clues.length?state.clues.map((c,i)=>`<div class="log-row"><span class="log-name">${i+1}. ${esc(c.playerName)}</span><span class="log-clue"${c.skipped?' style="color:var(--muted)"':''}>${esc(c.clue)}</span></div>`).join(''):`<div class="log-placeholder">Las pistas aparecerán aquí. Una palabra o frase por participante.</div>`}`;}
  function renderRoles(){
    shell(`${roomHeading()}<div class="game-layout"><div class="aside">${roleCard()}${miniPlayers()}</div><main class="main"><div class="panel"><div class="eyebrow">ANTES DE COMENZAR</div><h2>🃏 Mira tu rol en privado</h2><p class="description">Abre tu carta secreta en el panel de la izquierda. Cuando la hayas leído, pulsa <b>Estoy listo</b>. La ronda comenzará automáticamente al confirmar todos, o cuando se acabe el tiempo de preparación.</p><div class="turn-header center"><div class="eyebrow">JUGADORES PREPARADOS</div><div class="big-number">${state.readyCount}<span style="font-size:19px;color:var(--muted)"> / ${state.players.length}</span></div><p class="hint">Inicio automático en <span id="countdown">— s</span></p></div>${state.readySubmitted?`<div class="log-placeholder">✅ Ya estás listo. Esperando al resto del equipo…</div>`:`<button class="primary full" data-action="ready" ${showRole?'':'disabled'}>✅ Ya vi mi rol, estoy listo</button><p class="hint">Primero debes abrir tu carta para confirmar.</p>`}</div></main></div>`);
  }
  function renderClues() {
    const current=member(state.turnPlayerId);
    const roundNames=state.order.map((pid,i)=>`<span class="${i===state.turnIndex?'active':''}">${i+1}. ${esc(member(pid)?.name||'Jugador')}</span>`).join('');
    shell(`${topGame()}<div class="panel"><div class="eyebrow">RONDA ${state.round} · FASE 1</div><h2>🎤 Turno de pistas</h2><p class="description">La plataforma sorteó el orden. Cada jugador escribe una palabra o frase de hasta 160 caracteres cuando le corresponda, sin incluir la palabra secreta. El turno avanza automáticamente al acabar el tiempo.</p><div class="timeline">${roundNames}</div><div class="turn-header"><div class="eyebrow">LE TOCA A...</div><h2>${esc(current?.name||'—')} ${isMyTurn()?'✨':''}</h2><p class="hint">Tiempo restante: <strong id="countdown">— s</strong></p></div>${isMyTurn()?`<form id="clue-form"><label class="field" for="clue">Tu pista (palabra o frase)</label><input id="clue" name="clue" maxlength="160" placeholder="Ej.: Nos ayuda a coordinar el trabajo del equipo" required autocomplete="off" autofocus/><div class="form-actions"><button class="primary full" type="submit">Enviar pista →</button></div></form>`:`<div class="log-placeholder">${you().eliminated?'Ya no participas en las pistas.':'Escucha a los demás y piensa quién puede estar fingiendo.'}</div>`}</div><div class="panel">${clueLog()}</div>${bottomGame()}`);
  }
  function updateCountdown(){
    const el=$('#countdown');if(!el||!state?.deadline)return;
    el.textContent=fmt(Math.max(0,Math.ceil((state.deadline-Date.now())/1000)))+' s';
  }
  function renderDiscussion() {
    shell(`${topGame()}<div class="panel"><div class="eyebrow">RONDA ${state.round} · FASE 2</div><h2>🗣️ Momento de sospechar</h2><p class="description">Debatan por Teams: ¿quién dio una pista demasiado vaga? Cuando termine el tiempo, se abrirá automáticamente la votación.</p><div class="turn-header center"><div class="eyebrow">DEBATE RESTANTE</div><div class="deadline" id="countdown">-- s</div></div>${host()?`<button class="secondary full" data-action="voting">🗳️ Abrir votación ahora</button>`:''}</div><div class="panel">${clueLog()}</div>${bottomGame()}`);
  }
  function renderVote() {
    const eligible=active().filter(p=>p.id!==you().id);
    shell(`${topGame()}<div class="panel"><div class="eyebrow">RONDA ${state.round} · FASE 3</div><h2>🗳️ ¿Quién es el farsante?</h2><p class="description">Vota por la persona que crees que no conoce la palabra. El voto es secreto, único y no puedes votar por ti mismo.</p><div class="turn-header"><div class="eyebrow">VOTOS REGISTRADOS</div><div class="big-number">${state.voteCount}<span style="font-size:19px;color:var(--muted)"> / ${state.expectedVotes}</span></div><div class="progress-bar"><div style="width:${state.expectedVotes?state.voteCount/state.expectedVotes*100:0}%"></div></div><div class="hint">Cierra al votar todo el equipo o al finalizar el tiempo. Restan <span id="countdown">— s</span>.</div></div>${you().eliminated?`<div class="log-placeholder">Estás eliminado: observa quién logra pasar desapercibido.</div>`:state.voteSubmitted?`<div class="log-placeholder">✅ Voto registrado. Esperando a los demás participantes...</div>`:`<div class="vote-grid">${eligible.map(p=>`<button class="vote-option ${selectedTarget===p.id?'selected':''}" data-vote-target="${p.id}"><span class="avatar">${esc(p.name[0]?.toUpperCase()||'?')}</span>${esc(p.name)}</button>`).join('')}</div><button class="primary full" data-action="vote" ${selectedTarget?'':'disabled'}>Confirmar mi voto →</button>`}${host()?`<button class="ghost small" data-action="closeVote" ${state.voteCount<Math.ceil(state.expectedVotes*2/3)?'disabled':''} style="margin-top:12px">Cerrar votación ahora</button>`:''}</div><div class="panel">${clueLog()}</div>${bottomGame()}`);
  }
  function voteResult(){
    const max=Math.max(1,...state.votingResults.map(v=>v.votes));
    const chosen=state.lastRemoved;
    let verdict='';
    if(chosen){
      const votes=state.votingResults.find(v=>v.id===chosen.id)?.votes||0;
      verdict=`<div class="turn-header center" data-vote-verdict><div class="eyebrow">EL EQUIPO SEÑALÓ A</div><h3>${esc(chosen.name)}</h3><p>${votes} voto${votes===1?'':'s'} de ${state.voteCount} emitidos</p><strong>${chosen.wasImpostor?'🕵️ Sí, era el impostor. ¡Lo descubrieron!':'😬 No era el impostor. El equipo señaló a un inocente.'}</strong></div>`;
    }else if(state.outcome==='tie'){
      verdict='<div class="log-placeholder" data-vote-verdict>Empate: la votación no señaló a un único participante. Nadie es eliminado y el impostor sigue oculto.</div>';
    }else if(state.outcome==='quorum'){
      verdict='<div class="log-placeholder" data-vote-verdict>Votos insuficientes: no se puede señalar a un participante. Nadie es eliminado y el impostor sigue oculto.</div>';
    }
    return `<h3>📊 Resultado de la votación</h3>${verdict}${state.votingResults.map(v=>`<div class="results-row"><span title="${esc(v.name)}">${esc(v.name)}</span><div class="bar"><div class="fill" style="width:${v.votes/max*100}%"></div></div><b>${v.votes}</b></div>`).join('')}`;
  }
  function renderReveal(){
    const tie=state.outcome==='tie';
    const quorum=state.outcome==='quorum';
    shell(`${topGame()}<div class="panel center"><div class="eyebrow">RONDA ${state.round} · RESULTADO</div><div style="font-size:70px">${quorum?'📵':tie?'🤝':'😬'}</div><h2>${quorum?'Faltaron votos suficientes':tie?'¡Empate en la votación!':`${esc(state.lastRemoved?.name||'Jugador')} no era el impostor`}</h2><p class="faded">${quorum?'No alcanzamos dos tercios de participantes. Nadie sale y se hará otra ronda.':tie?'Nadie sale esta vez. Se sorteará un nuevo orden para otra ronda de pistas.':'El verdadero farsante continúa oculto. El equipo tendrá otra oportunidad.'}</p><p class="hint">La siguiente ronda comenzará en <span id="countdown">— s</span>.</p>${host()?`<button class="primary full" data-action="next">🎲 Nueva ronda ahora →</button>`:''}</div><div class="panel">${voteResult()}</div>${bottomGame()}`);
  }
  function renderGuess(){
    const imp=you().role==='impostor';
    shell(`${topGame()}<div class="panel center"><div class="eyebrow">¡EL EQUIPO ATRAPÓ AL FARSANTE!</div><div style="font-size:65px">🕵️‍♂️</div><h2>${esc(state.lastRemoved?.name||'El impostor')} es el impostor</h2><p class="faded">Todavía tiene una última oportunidad: adivinar la palabra secreta y robar la victoria.</p><div class="turn-header center"><div class="eyebrow">TIEMPO PARA ADIVINAR</div><div id="countdown" class="deadline">-- s</div></div>${imp?`<form id="guess-form"><label class="field" for="guess">¿Cuál era la palabra secreta?</label><input id="guess" name="guess" maxlength="60" required autocomplete="off" placeholder="Escribe tu respuesta"/><button class="primary full" type="submit" style="margin-top:12px">🎯 Intentar adivinar</button></form>`:`<div class="log-placeholder">🤫 No digas la palabra en voz alta. El impostor está pensando...</div>`}</div><div class="panel">${voteResult()}</div>${bottomGame()}`);
  }
  function renderFinished(){
    const impWin=state.winner==='impostor';
    const innocentVerdict=state.outcome==='innocent'?`<div class="turn-header center" data-innocent-result><h2>${esc(state.lastRemoved?.name)} no era el impostor</h2><p>El verdadero impostor era <strong>${esc(state.reveal?.impostor)}</strong>.</p></div>`:'';
    shell(`${roomHeading()}<div class="panel center" style="max-width:760px;margin:0 auto"><span class="tag">PARTIDA FINALIZADA</span><div style="font-size:78px;margin:16px 0">${impWin?'🎭':'🏆'}</div><h1 class="page-title">${impWin?'¡El impostor ganó!':'¡Ganó el equipo!'}</h1><p class="page-subtitle">${impWin?'El farsante logró engañar al equipo o acertó la palabra secreta.':'La colaboración permitió identificar al farsante.'}</p>${innocentVerdict}<div class="divider"></div><div class="two-col" style="margin:12px auto 25px;max-width:570px"><div class="role-card" style="margin:0"><div class="role-label">EL IMPOSTOR ERA</div><div class="role-text">${esc(state.reveal?.impostor)}</div></div><div class="role-card" style="margin:0"><div class="role-label">PALABRA SECRETA</div><div class="role-text">${esc(state.reveal?.word)}</div></div></div>${host()?`<button class="primary" data-action="reset">🔄 Jugar otra partida</button>`:`<p class="faded">Esperando una nueva partida del anfitrión...</p>`}<div style="margin-top:14px"><button class="ghost small" data-action="leave">Salir de la sala</button></div><div class="accent-quote" style="text-align:left"><b>💡 Reflexión Scrum · ${esc(state.reveal?.word)}</b><p data-scrum-reflection>${esc(state.reveal?.reflection)}</p></div></div>${state.votingResults?.length?`<div class="panel" style="max-width:760px;margin:18px auto">${voteResult()}</div>`:''}`);
  }
  function render(){
    if(!state)return renderHome();
    switch(state.stage){
      case 'lobby':return renderLobby();
      case 'roles':return renderRoles();
      case 'clues':return renderClues();
      case 'discussion':return renderDiscussion();
      case 'vote':return renderVote();
      case 'reveal':return renderReveal();
      case 'guess':return renderGuess();
      case 'finished':return renderFinished();
      default:return renderHome();
    }
  }
  root.addEventListener('change',event=>{
    if(['create-theme','lobby-theme'].includes(event.target.id))loadTheme(event.target);
  });
  root.addEventListener('input',event=>{
    const textarea=event.target;
    if(textarea.id==='create-words'){
      wordsDraft=textarea.value;$('#create-theme').value=themeForWords(textarea.value);
    }else if(textarea.id==='lobby-words'){
      lobbyDraft.value=textarea.value;$('#lobby-theme').value=themeForWords(textarea.value);
    }
  });
  root.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.target;
    const button=form.querySelector('button[type=submit]');
    if(button){button.disabled=true;button.textContent='Procesando…';}
    try {
      const fields=Object.fromEntries(new FormData(form));
      if(form.id==='create-form'){
        const w=String(fields.words||'').split('\n').map(s=>s.trim()).filter(Boolean);
        if(new Set(w.map(x=>x.toLowerCase())).size<3)throw new Error('Agrega al menos 3 palabras diferentes');
        wordsDraft=fields.words;localStorage.setItem('farsanteWords',wordsDraft);
        saveAuth(await request('/api/create',{name:fields.name,words:w}));
        history.replaceState({},'',`/?sala=${auth.room}`);
        await connect();
      }else if(form.id==='join-form'){
        saveAuth(await request('/api/join',{name:fields.name,room:fields.room}));
        history.replaceState({},'',`/?sala=${auth.room}`);
        await connect();
      }else if(form.id==='words-form'){
        const w=String(fields.words||'').split('\n').map(s=>s.trim()).filter(Boolean);
        if(!await send('words',{words:w}))return;
        wordsDraft=fields.words;localStorage.setItem('farsanteWords',wordsDraft);
        notify('Palabras guardadas');
      }else if(form.id==='clue-form'){
        await send('clue',{clue:fields.clue});
      }else if(form.id==='guess-form'){
        await send('guess',{guess:fields.guess});
      }
    }catch(e){notify(e.message,true);}
    finally{if(button&&button.isConnected){button.disabled=false;if(form.id==='create-form')button.textContent='Crear mi sala →';if(form.id==='join-form')button.textContent='Unirme al juego →';if(form.id==='words-form')button.textContent='💾 Guardar palabras';if(form.id==='clue-form')button.textContent='Enviar pista →';if(form.id==='guess-form')button.textContent='🎯 Intentar adivinar';}}
  });
  root.addEventListener('click',event=>{
    const voteButton=event.target.closest('[data-vote-target]');
    if(voteButton){selectedTarget=voteButton.dataset.voteTarget;render();return;}
    const btn=event.target.closest('[data-action]');
    if(!btn)return;
    switch(btn.dataset.action){
      case 'copy':{
        const link=invitationLink();
        if(navigator.clipboard?.writeText){navigator.clipboard.writeText(link).then(()=>notify('Enlace copiado para Teams')).catch(()=>notify(`Comparte el código: ${state.code}`));}
        else notify(`Comparte el código: ${state.code}`);
        break;
      }
      case 'start':startGame();break;
      case 'reset':resetGame();break;
      case 'role':showRole=!showRole;render();break;
      case 'ready':showRole=false;send('ready');break;
      case 'leave':{
        (async()=>{try{await request('/api/action',{...auth,type:'leave'});if(stream){stream.close();stream=null;}saveAuth(null);state=null;history.replaceState({},'','/');render();notify('Saliste de la sala');}catch(e){notify(e.message,true);}})();break;
      }
      case 'scrum-theme':{
        const textarea=$('#create-words');
        if(textarea){textarea.value=HOME_WORDS.join('\n');wordsDraft=textarea.value;$('#create-theme').value='scrum';}
        notify('Tema Ceremonias Scrum aplicado. Puedes crear la sala.');break;
      }
      case 'defaults':{
        const textarea=$('#lobby-words');if(textarea){textarea.value=HOME_WORDS.join('\n');lobbyDraft.value=textarea.value;$('#lobby-theme').value='scrum';}
        notify('Lista restaurada en el editor; pulsa Guardar para aplicar');break;
      }
      case 'vote':if(selectedTarget)send('vote',{targetId:selectedTarget});break;
      default:send(btn.dataset.action);break;
    }
  });
  setInterval(updateCountdown,500);
  window.addEventListener('beforeunload',()=>{stream?.close();if(connectionCheck)clearTimeout(connectionCheck);});
  render();
  if(auth && initialCode && initialCode!==auth.room){
    const old=auth;saveAuth(null);
    request('/api/action',{...old,type:'leave'}).catch(()=>{});
    render();
  } else if(auth)connect();
})();
