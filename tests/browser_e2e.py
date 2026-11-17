"""Prueba multijugador completa de interfaz real (Python + Playwright + Chromium)."""
import os
import socket
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
ARTIFACTS=ROOT/'test-output'
ARTIFACTS.mkdir(exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port=sock.getsockname()[1]
env={**os.environ,'PORT':str(port),'HOST':'127.0.0.1'}
redis=None
if os.environ.get('TEST_SHARED')=='1':
    redis=subprocess.Popen(['node','tests/redis-fixture.js'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
    redis_url=redis.stdout.readline().strip()
    if not redis_url.startswith('http://127.0.0.1:'):raise RuntimeError('Redis de pruebas no arrancó')
    env.update(UPSTASH_REDIS_REST_URL=redis_url,UPSTASH_REDIS_REST_TOKEN='test-token',REDIS_KEY_PREFIX='browser-test')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
base=f'http://127.0.0.1:{port}'
try:
    for _ in range(100):
        try:
            if urlopen(base+'/health',timeout=.3).status==200:break
        except Exception:time.sleep(.06)
    else:raise RuntimeError('Servidor no arrancó')
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True, channel=os.environ.get('PLAYWRIGHT_CHANNEL') or None)
        contexts=[browser.new_context(viewport={'width':1280,'height':900}) for _ in range(3)]
        pages=[context.new_page() for context in contexts]
        labels=['QA','Dev','PO']
        host=pages[0]
        host.goto(base,wait_until='domcontentloaded')
        host.screenshot(path=str(ARTIFACTS/'01_inicio.png'),full_page=True)
        host.locator('#create-name').fill(labels[0])
        host.locator('#create-form button[type=submit]').click()
        host.locator('.code-big').wait_for()
        code=host.locator('.code-big').inner_text()
        assert len(code)==5,code
        host.locator('#room-qr svg').wait_for()
        if redis:
            transport=host.evaluate('''async()=>{
                const auth=JSON.parse(localStorage.getItem('farsanteAuth'));
                return (await (await fetch('/api/state?'+new URLSearchParams(auth))).json()).transport;
            }''')
            assert transport=='poll',transport
        invitation=host.locator('#room-link').input_value()
        assert invitation==base+f'/?sala={code}',invitation
        host.add_script_tag(path=str(ROOT/'node_modules/jsqr/dist/jsQR.js'))
        decoded=host.evaluate('''async () => {
            const svg=document.querySelector('#room-qr svg');
            const image=new Image();
            image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
            await image.decode();
            const canvas=document.createElement('canvas');
            canvas.width=canvas.height=480;
            const ctx=canvas.getContext('2d');
            ctx.drawImage(image,0,0,480,480);
            const pixels=ctx.getImageData(0,0,480,480);
            return jsQR(pixels.data,480,480)?.data;
        }''')
        assert decoded==invitation,decoded
        print('PASS: QR visible decodificado; contiene exactamente el enlace de la sala sin tokens.')
        assert host.locator('button[data-action="start"]').is_disabled()
        assert '2 participantes' in host.locator('#start-status').inner_text()
        host.screenshot(path=str(ARTIFACTS/'01_sala_qr.png'),full_page=True)
        for name,page in zip(labels[1:],pages[1:]):
            page.goto(invitation,wait_until='domcontentloaded')
            assert page.locator('#join-code').input_value()==code
            assert page.locator('.invitation-notice').is_visible()
            page.locator('#join-name').fill(name)
            page.locator('#join-form button[type=submit]').click()
            page.locator('.code-big').wait_for()
            assert page.locator('button[data-action="start"]').count()==0
        host.locator('button[data-action="start"]').wait_for(state='visible')
        host.reload(wait_until='domcontentloaded')
        host.locator('button[data-action="start"]').wait_for(state='visible')
        assert host.locator('.code-big').inner_text()==code
        host.locator('button[data-action="start"]').click()
        for page in pages: page.locator('button[data-action="role"]').wait_for(timeout=8000)
        cards=[]
        for page in pages:
            page.locator('button[data-action="role"]').click()
            cards.append(page.locator('.role-text').inner_text().strip())
        assert cards.count('IMPOSTOR')==1,cards
        impostor_index=cards.index('IMPOSTOR')
        word=cards[(impostor_index+1)%3]
        assert word in ['Scrum','Sprint','Daily','HA','Backlog','Refinamiento','QA','Bug','Regresión','Retrospectiva','Automatización','Definition of Done','Planning','Sprint Goal','Historia de usuario','Criterios de aceptación','Pruebas API','Deploy','CI/CD','Smoke Testing']
        for page in pages:page.locator('button[data-action="ready"]').click()
        host.get_by_text('Turno de pistas').wait_for(timeout=8000)
        host.screenshot(path=str(ARTIFACTS/'02_turnos.png'),full_page=True)
        for n in range(3):
            name=host.locator('.turn-header h2').inner_text().strip().replace(' ✨','')
            current=pages[labels.index(name)]
            current.locator('#clue').fill(['calidad','equipo','trabajo'][n])
            current.locator('#clue-form button[type=submit]').click()
            if n<2:
                host.locator('.log-row').nth(n).wait_for(timeout=8000)
        host.get_by_text('Momento de sospechar').wait_for(timeout=8000)
        host.locator('button[data-action="voting"]').click()
        for page in pages:page.get_by_text('¿Quién es el farsante?').wait_for(timeout=8000)
        host.screenshot(path=str(ARTIFACTS/'03_votacion.png'),full_page=True)
        for i,page in enumerate(pages):
            target=labels[0 if i==impostor_index else impostor_index]
            if target==labels[i]:target=labels[(i+1)%3]
            page.locator('.vote-option',has_text=target).click()
            page.locator('button[data-action="vote"]').click()
        for page in pages:
            page.get_by_text(labels[impostor_index]+' es el impostor',exact=True).wait_for(timeout=8000)
            verdict=page.locator('[data-vote-verdict]').inner_text()
            assert labels[impostor_index] in verdict,verdict
            assert 'Sí, era el impostor' in verdict,verdict
            assert '2 votos de 3 emitidos' in verdict,verdict
        imp=pages[impostor_index]
        imp.locator('#guess').fill(word)
        imp.locator('#guess-form button[type=submit]').click()
        for page in pages:page.get_by_text('¡El impostor ganó!').wait_for(timeout=8000)
        host.screenshot(path=str(ARTIFACTS/'04_resultado.png'),full_page=True)
        host.locator('button[data-action="reset"]').click()
        host.get_by_text('Prepara tu partida').wait_for(timeout=8000)
        host.locator('#room-qr svg').wait_for()
        # El mismo anfitrión puede comenzar otra partida sin recrear la sala.
        host.locator('button[data-action="start"]').wait_for(state='visible')
        assert host.locator('.player-pill').count()==3
        print('PASS: 3 jugadores reales, roles secretos, orden automático, pistas, votos, adivinanza, resultado y reinicio.')
        mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
        mobile_page=mobile.new_page()
        mobile_page.goto(base,wait_until='domcontentloaded')
        assert mobile_page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        mobile_page.screenshot(path=str(ARTIFACTS/'05_movil.png'),full_page=True)
        mobile_page.goto(invitation,wait_until='domcontentloaded')
        assert mobile_page.locator('#join-code').input_value()==code
        mobile_page.locator('#join-name').fill('Movil')
        mobile_page.locator('#join-form button[type=submit]').click()
        mobile_page.locator('#room-qr svg').wait_for()
        assert mobile_page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        mobile_page.screenshot(path=str(ARTIFACTS/'06_sala_movil.png'),full_page=True)
        print('PASS: Interfaz móvil sin desbordamiento horizontal.')
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=5)
    except subprocess.TimeoutExpired:server.kill()
    if redis:
        redis.terminate()
        try:redis.wait(timeout=5)
        except subprocess.TimeoutExpired:redis.kill()
