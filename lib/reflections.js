'use strict';
const REFLECTIONS={
  planning:'En la Planning construimos un propósito compartido. ¿Qué podemos aclarar antes de comprometernos para que todos comprendamos el objetivo y el trabajo del Sprint?',
  review:'La Review nos permite aprender con los interesados a partir de lo que construimos. ¿Qué feedback necesitamos escuchar y cómo lo convertiremos en decisiones para el producto?',
  daily:'La Daily ayuda a coordinar el trabajo hacia el objetivo del Sprint. ¿Cómo podemos usarla para pedir ayuda y ajustar nuestro plan, además de contar lo que hicimos?',
  retro:'En la Retro convertimos lo vivido en oportunidades de mejora. ¿Qué cambio concreto probaremos en el próximo Sprint y cómo sabremos si funcionó?',
  'historia de usuario':'Una Historia de Usuario conecta el trabajo con una necesidad. ¿Podemos explicar para quién construimos, qué necesita y cómo comprobaremos que le aporta valor?',
  qa:'La calidad se construye entre todos. ¿Cómo podemos involucrar a QA desde el inicio y acordar criterios que nos permitan prevenir defectos?',
  dev:'El trabajo de DEV requiere contexto, colaboración y feedback. ¿Qué podemos hacer para compartir conocimiento y evitar que una persona trabaje aislada?',
  refinamiento:'El Refinamiento nos ayuda a descubrir dudas y dividir el trabajo. ¿Qué necesitamos conversar antes de llevar una historia a la Planning?',
  sprint:'El Sprint nos da un espacio para enfocarnos, construir y aprender. ¿Qué nos distrae del objetivo y qué ajuste nos ayudaría a proteger ese enfoque?',
  backlog:'El Backlog expresa las opciones y prioridades del producto. ¿Está claro qué aporta más valor y qué deberíamos ordenar, aclarar o descartar?'
};
function reflectionFor(word){
  const key=String(word||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  return REFLECTIONS[key]||'¿Qué ocurrió cuando alguien no tenía toda la información? ¿Qué acuerdo concreto nos ayudaría a compartir contexto y colaborar mejor en el próximo Sprint?';
}
module.exports={reflectionFor};
