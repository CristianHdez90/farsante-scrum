# Farsante Scrum v2.0 🕵️

Juego web **multijugador en tiempo real** para retrospectivas virtuales de Scrum.
Identidad y código originales; el modo local no requiere cuentas ni servicios externos. El despliegue en Vercel utiliza Upstash Redis. El QR se genera localmente con `qrcode-generator` (MIT).

## ¿Qué hace?

- Crea salas de 3–12 participantes con código privado de cinco letras y enlace para compartir por Teams.
- Muestra un código QR y un enlace de invitación en la sala de espera; al escanearlo se abre el formulario con el código de sala ya ingresado.
- El botón **Iniciar juego** indica cuántos participantes faltan o quién debe reconectarse, y se habilita con al menos tres jugadores conectados.
- Permite añadir palabras propias: Scrum, Sprint, Daily, HA, QA, Bug, etc.
- Selecciona **una palabra y exactamente un farsante** aleatoriamente. Cada participante ve solo su propia carta.
- Los jugadores confirman que vieron su rol (la fase de preparación termina al estar todos listos o tras 90 s).
- Sortea **orden de turnos en cada ronda**. Cada turno dura hasta 60 s; el anfitrión puede saltarlo.
- Abre automáticamente un debate de 45 s y una **votación secreta de 75 s**.
- Cuenta y presenta los votos. Si votan todos, el resultado sale enseguida. Para eliminar a alguien por tiempo o cierre anticipado se requiere participación de **al menos dos tercios**. Si hay empate o no hay cuórum, no se elimina a nadie.
- Si se elimina un inocente, comienza una nueva ronda (automáticamente después de 18 s, o de inmediato por el anfitrión).
- Si se identifica al impostor, puede intentar adivinar la palabra durante 45 s. Si quedan dos jugadores vivos y el farsante no ha sido descubierto, gana el farsante.
- El anfitrión puede reiniciar la partida con el mismo grupo. La sesión persiste en el navegador al recargar, mientras el servidor conserve la sala.
- Los datos de votos individuales **no** se comparten; solo el recuento final. No permite votarse a sí mismo.
- Responsive para móvil y escritorio, sin registro.

## Ejecutar en tu equipo

**Requisitos:** Node.js >=20, npm.

```bash
npm install
npm start
```

Visita **http://localhost:3000**. Para probar el multijugador localmente, abre varias ventanas privadas o diferentes navegadores y comparte el código de sala. Desde otros dispositivos solo podrán unirse si el servidor está desplegado o accesible en la red.

```bash
npm test
```

La carpeta `tests` incluye pruebas de integración con el ejecutor nativo de Node.js. Para las pruebas E2E visuales opcionales se necesita Python con Playwright, Chromium y las dependencias de desarrollo de npm instaladas (ver `tests/browser_e2e.py`). Estas pruebas también decodifican el QR con `jsqr` para verificar el enlace de invitación.

## Unirse por código QR e iniciar la partida

1. Crea una sala con tu nombre y el banco de palabras.
2. Comparte el QR de la sala de espera o copia el enlace para Teams.
3. Cada participante escanea el QR, escribe su nombre y pulsa **Unirme al juego**.
4. Con al menos tres participantes conectados, el anfitrión pulsa **Iniciar juego**. Cada persona recibe su carta privada; al confirmar todos empieza la primera ronda de pistas (también comienza al agotarse los 90 segundos de preparación).

**Desde celulares:** si abres la aplicación con `localhost`, el QR apuntará a ese mismo equipo y no servirá desde otro dispositivo. Abre primero la aplicación usando la IP local del servidor (por ejemplo, `http://192.168.1.20:3000`) para generar un QR accesible en la misma red, o usa la dirección HTTPS del despliegue. El servidor escucha por defecto en `0.0.0.0`; la red y el firewall deben permitir el acceso al puerto configurado.

El QR contiene únicamente la dirección de la sala, sin tokens de sesión ni roles. Se muestra mientras la sala admite participantes; después del inicio no se aceptan nuevas entradas.

## Publicar en Vercel

El proyecto incluye `vercel.json`, una función Node en `api/index.js` y generación del QR durante la compilación. **Se requiere Upstash Redis** para compartir las salas entre instancias. No se utiliza almacenamiento en memoria como respaldo en Vercel.

1. Sube el proyecto a un repositorio de GitHub, incluyendo `api/`, `lib/`, `scripts/`, `public/`, `package.json`, `package-lock.json` y `vercel.json`. No subas `.env`, `node_modules`, `.test-tools` ni `test-output`.
2. En Vercel, importa ese repositorio con **Framework Preset: Other** y selecciona como raíz la carpeta que contiene `package.json`.
3. Crea una base **Upstash Redis** (desde Upstash o Vercel Marketplace). Elige una región cercana a la función y copia la URL REST y el token REST con permisos de lectura y escritura. El token de solo lectura no sirve.
4. En **Settings → Environment Variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `UPSTASH_REDIS_REST_URL` | URL REST de la base Upstash, con `https://` |
   | `UPSTASH_REDIS_REST_TOKEN` | Token REST de lectura y escritura |
   | `REDIS_KEY_PREFIX` | Opcional, por ejemplo `farsante:production` |

   Configura los entornos que vayas a desplegar. Para Preview usa otra base o un prefijo distinto, por ejemplo `farsante:preview`. No agregues prefijos de variables públicas a las credenciales. No las compartas por chat ni las incluyas en archivos públicos.
5. La configuración incluida establece **Build Command: `npm run build`**, **Output Directory: `public`** y una función con duración máxima de 30 segundos. Usa una versión de Node compatible, por ejemplo **22.x**. La instalación puede usar `npm ci`. No hay un comando `npm start` que configurar en Vercel.
6. Despliega. Si cambias las variables después, realiza un nuevo despliegue para aplicarlas.
7. Abre `/health`: debe responder `{"status":"ok"}` después de comprobar Redis. Crea una sala, escanea el QR desde otro dispositivo, reúne tres participantes y prueba inicio, pistas, votación y resultado. Usa la dirección de producción y comprueba que los invitados puedan acceder sin una cuenta de Vercel; si hay protección de despliegue, configúrala según el acceso que necesites.

En Vercel los navegadores consultan el estado aproximadamente cada **1,5 segundos**, más la latencia de la petición. La presencia se considera activa durante **30 segundos** desde el último contacto. Esto consume peticiones a Vercel y comandos Redis: revisa las cuotas de ambas cuentas y cierra las salas cuando termines.

Las salas expiran tras **6 horas sin peticiones válidas**. Las escrituras utilizan comparación y actualización atómicas para no perder votos o entradas simultáneas. Los vencimientos se guardan en Redis y se procesan al recibir una consulta o acción: con jugadores conectados, la actualización aparece en la siguiente consulta; si todos cierran la página, se recupera al volver. No se ejecutan tareas en segundo plano cuando no hay peticiones.

Para probar este modo en tu equipo, define las variables de `.env.example` en el entorno o usa `node --env-file=.env server.js` después de crear tu `.env`. `npm start` toma las variables que ya estén definidas en el entorno; no carga `.env` automáticamente.

Referencias: [configuración de Vercel](https://vercel.com/docs/project-configuration/vercel-json), [API REST de Upstash](https://upstash.com/docs/redis/features/restapi).

## Publicar en Render para usarlo con Microsoft Teams

1. Sube **todos los archivos de esta carpeta** a un repositorio GitHub.
2. Abre <https://dashboard.render.com/>. Selecciona **New → Blueprint** y conecta ese repositorio. Render leerá `render.yaml` para crear un servicio web Node.
3. Confirma el despliegue. Abre la dirección pública HTTPS que Render te asigne (`https://...onrender.com`).
4. Crea una sala; comparte **el enlace de la sala** en el chat de Teams.
5. Cada compañero abre la página en su dispositivo y vota en tiempo real.

También puedes crear un **Web Service** manual en Render: *Build Command* `npm install`, *Start Command* `npm start` y *Health Check Path* `/health`.

**Nota:** Render ofrece instancias gratuitas con limitaciones y suspensión por inactividad. Sin variables de Redis, este proyecto usa **un solo proceso** y guarda las salas **en memoria**: se pierden si la instancia se reinicia. Si configuras las variables de Upstash indicadas arriba, también en Render se activa el modo compartido con consultas periódicas y vencimientos persistidos. Este MVP no está publicado por nosotros: tú controlas la cuenta de hosting.

**No es un sitio estático:** publicar solo el HTML en Netlify/GitHub Pages no habilita el multijugador; necesitas el servidor Node.

## Carpetas

```
server.js              Servidor local/Render, SSE y archivos públicos
lib/game.js            Reglas y transiciones compartidas
lib/redis-store.js     Almacenamiento Redis con actualizaciones atómicas
lib/shared-api.js      API compartida para Vercel o Node con Redis
api/index.js           Entrada de la función Vercel
vercel.json            Configuración del despliegue Vercel
scripts/build.js       Preparación del QR para archivos estáticos
public/index.html      Entrada HTML
public/app.js          Interfaz, roles, pistas, votos y actualización en tiempo real
public/styles.css      Diseño responsive
render.yaml            Configuración para Render Blueprint
Dockerfile             Contenedor opcional
.github/workflows/     Pruebas CI (GitHub Actions)
tests/game.test.js     Pruebas API locales
tests/shared.test.js   Dos instancias, concurrencia, vencimientos y Redis simulado
```

## Consideraciones de privacidad y seguridad

- No incluyas datos personales o secretos de proyectos reales en las palabras o pistas.
- Las salas usan códigos de cinco letras **para comodidad, no como autenticación robusta**.
- Los roles privados y los votos se verifican en el servidor; la interfaz no puede elegir el farsante.
- Cada jugador recibe un token aleatorio de sala que se guarda localmente en su navegador. No lo compartas.
- Si una persona mira la carta mientras comparte la pantalla en Teams, revelará su rol; ocultarla antes de compartir.
- El modo local usa SSE; el modo con Redis usa consultas periódicas. Las acciones usan POST HTTP en ambos casos; no requiere Socket.IO.
- Para un producto público con muchas salas agrega límites de peticiones, protección ante abuso y autenticación de anfitriones; revisa las cuotas y costos de Vercel y Redis.

## Pruebas de aceptación sugeridas

- De 3 a 12 jugadores pueden entrar a la misma sala y observar el mismo progreso.
- Solo uno recibe el papel de farsante y nunca puede leer la palabra secreta en su estado.
- El jugador fuera de turno no puede enviar pistas.
- El votante no puede votar dos veces ni por sí mismo.
- Si hay empate, se repite la ronda sin eliminación.
- Si se desconecta alguien durante la votación, el número de votos requerido no se reduce.
- Si el farsante es descubierto, solo él puede usar la oportunidad final de adivinar.
- Se puede iniciar otra partida manteniendo a los participantes en la sala.

Licencia MIT para el código original.

## Prueba visual E2E opcional

En un computador sin políticas corporativas que bloqueen Chromium:

```bash
python -m pip install playwright
python -m playwright install chromium
python tests/browser_e2e.py
```

También puedes usar Chrome instalado definiendo `PLAYWRIGHT_CHANNEL=chrome` (en PowerShell: `$env:PLAYWRIGHT_CHANNEL="chrome"`).

Para probar el modo compartido sin credenciales reales, define `TEST_SHARED=1` (en PowerShell: `$env:TEST_SHARED="1"`) antes de ejecutarla. Se inicia un simulador REST local de Redis. Las pruebas de integración usan el mismo simulador; no sustituyen la validación de un despliegue con Upstash real.

Esta prueba abre **tres navegadores aislados**, crea la sala, asigna roles, envía las pistas en orden, vota, comprueba la adivinanza, reinicia la partida y verifica que la página móvil no tenga desbordamiento horizontal. Guarda capturas en `test-output/`.

## Dinámica sugerida para la retrospectiva en Teams

1. El organizador crea la sala y comparte el enlace en el chat de Teams.
2. Cada participante se une desde su navegador individual (no compartir pantalla al revelar la carta).
3. Todos leen y confirman sus roles.
4. La plataforma decide el orden; cada jugador dice por el micrófono la pista que escribe.
5. Discuten, votan en la plataforma y visualizan el resultado.
6. Tras 1–2 partidas, el Scrum Master pregunta: **«¿Qué ocurre cuando alguien trabaja sin contexto completo? ¿Cómo lo evitaremos en nuestro próximo Sprint?»**

*La plataforma no graba audio ni accede a la reunión de Teams: funciona en paralelo a la videollamada.*
