(function(root){
  'use strict';
  const themes={
    scrum:{name:'🧩 Ceremonias Scrum y equipo',words:['Planning','Review','Daily','Retro','Historia de Usuario','QA','DEV','Refinamiento','Sprint','Backlog']},
    comida:{name:'🍕 Comida',words:['Pizza','Hamburguesa','Arepa','Empanada','Sushi','Tacos','Pasta','Ensalada','Chocolate','Helado']},
    musica:{name:'🎵 Música',words:['Salsa','Reguetón','Rock','Pop','Bachata','Vallenato','Concierto','Guitarra','Karaoke','Playlist']},
    tecnologia:{name:'🤖 Tecnología e IA',words:['Inteligencia Artificial','Chatbot','Prompt','Algoritmo','Automatización','Nube','Ciberseguridad','Robot','Datos','Realidad Virtual']}
  };
  if(typeof module==='object'&&module.exports)module.exports=themes;
  else root.FarsanteThemes=themes;
})(globalThis);
