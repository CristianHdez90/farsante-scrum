'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DEFAULT_WORDS,createRoom,publicState}=require('../lib/game');
const {reflectionFor}=require('../lib/reflections');

test('Cada palabra Scrum tiene una reflexión propia al finalizar, sin filtrarla durante la partida',()=>{
  const {room,player}=createRoom('Host',DEFAULT_WORDS,{shared:true});
  room.imposterId=player.id;
  const reflections=new Set();
  for(const word of DEFAULT_WORDS){
    room.secret=word;
    for(const stage of ['lobby','roles','clues','discussion','vote','reveal','guess']){
      room.stage=stage;
      const state=publicState(room,player);
      assert.equal(state.reveal,undefined,`${word}: ${stage}`);
      assert.equal(state.me.word,null);
    }
    room.stage='finished';
    const result=publicState(room,player).reveal;
    assert.equal(result.word,word);
    assert.ok(result.reflection.includes('¿'));
    assert.notEqual(result.reflection,reflectionFor('Palabra personalizada'));
    reflections.add(result.reflection);
  }
  assert.equal(reflections.size,10);
});

test('Palabras personalizadas reciben una reflexión general y los nombres ignoran mayúsculas y espacios',()=>{
  assert.equal(reflectionFor('  PLANNING  '),reflectionFor('Planning'));
  assert.match(reflectionFor('Tema del equipo'),/compartir contexto/);
});
