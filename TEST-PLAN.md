# Plan de pruebas · Farsante Scrum 2.0

## Alcance

Funcionalidad de sala, seguridad de roles, ciclos de pistas, límites temporales, votaciones, resultados y reconexión. Se validan las reglas del servidor con pruebas de integración Node.js. Se incluye una prueba E2E de navegador para ejecutar fuera de entornos que bloqueen la navegación automatizada.

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| QA-001 | Crear y unir tres jugadores | Sala compartida, anfitrión identificado | PASA (API) |
| QA-002 | Enviar palabra al no-farsante y rol sin palabra al farsante | Exactamente un farsante, sin filtración | PASA (API) |
| QA-003 | Confirmaciones de lectura de cartas | La fase de pistas empieza cuando todos confirman | PASA (API) |
| QA-004 | Enviar pista fuera de turno | Servidor rechaza el intento | PASA (API) |
| QA-005 | Enviar pista idéntica a la palabra | Servidor rechaza el intento | PASA (API) |
| QA-006 | Votar dos veces o por uno mismo | Servidor rechaza el intento | PASA (API) |
| QA-007 | Pistas y votación completas | Resultados coherentes y privados antes del cierre | PASA (API) |
| QA-008 | Un empate | No hay eliminación; nueva ronda | PASA (API) |
| QA-009 | Eliminación de inocente | Se mantiene oculto el farsante | PASA (API) |
| QA-010 | Identificar farsante | Solo él puede adivinar palabra | PASA (API) |
| QA-011 | Cierre con menos de dos tercios de votos | Servidor rechaza cierre anticipado | PASA (API) |
| QA-012 | Desconexión durante votación | Total exigido no se reduce | PASA (API) |
| QA-013 | Doce participantes | Solo una persona es farsante | PASA (API) |
| QA-014 | Token inválido | No permite obtener el estado privado | PASA (API) |
| QA-015 | Recorrido visual con tres navegadores reales | UI completa, móvil y reinicio | PASA (Chrome, modo local y modo compartido con Redis simulado) |
| QA-016 | Desplegar a hosting externo | Multijugador entre dispositivos por HTTPS | PENDIENTE (requiere cuenta de alojamiento) |

## Validación de Vercel y Redis

`npm test` incluye dos servidores independientes contra un simulador REST local: entradas y votos simultáneos, privacidad de roles, presencia, eliminación de salas vacías y recuperación de fases vencidas. También comprueba los errores de conexión y configuración sin revelar credenciales.

La prueba de navegador puede ejecutarse con `TEST_SHARED=1`: verifica una partida con tres sesiones, lectura real del QR, resultado, reinicio y acceso desde móvil en el modo compartido.

Antes de aceptar producción: configurar Upstash real, desplegar Vercel, comprobar `/health`, unir tres dispositivos y verificar los resultados. Esta validación externa queda pendiente hasta disponer de las cuentas y variables.

## Límites conocidos

- Sin Redis las salas viven en memoria. Con Redis expiran tras seis horas sin peticiones válidas.
- Se requieren controles contra abuso y revisión de cuotas para uso público de gran escala.
- Con Redis, los cambios por tiempo se procesan al recibir peticiones; si todos cierran el navegador, se recuperan al regresar. La presencia tarda hasta 30 segundos en caducar.
- La experiencia real en una llamada corporativa de Teams deberá ser aceptada en su entorno, comprobando políticas de red y dispositivos.
