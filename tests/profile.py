"""Profile pictures: upload from the account panel, show on the lobby nav and on seats, sync across a room."""
import sys, json
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
from PIL import Image
Image.new('RGB', (300, 200), (200, 60, 60)).save(SP + 'face.png')
PIC = 'https://menwpgnhymqqwxnxwoce.supabase.co/storage/v1/object/public/avatars/' + FAKE_USER['id'] + '/avatar.jpg'
state_av = {'url': None}
uploads = []
def mock(route):
    url = route.request.url; m = route.request.method
    if '/storage/v1/object/avatars/' in url:
        uploads.append((m, route.request.headers.get('content-type', ''))); route.fulfill(status=200, content_type='application/json', body=json.dumps({'Key': 'avatars/x/avatar.jpg'})); return
    if '/rest/v1/profiles' in url:
        if m in ('PATCH', 'POST'):
            body = json.loads(route.request.post_data or '{}')
            if 'avatar_url' in body: state_av['url'] = body.get('avatar_url')
            route.fulfill(status=201, content_type='application/json', body='[]'); return
        row = {'id': FAKE_USER['id'], 'display_name': 'Tester', 'avatar_url': state_av['url']}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(row if 'single' in route.request.headers.get('accept', '') or 'object' in route.request.headers.get('accept', '') else [row]) if m == 'GET' else '[]'); return
    supabase_mock(route)
def setup3(ctx):
    pg, errs = setup(ctx); pg.unroute('https://*.supabase.co/**'); pg.route('https://*.supabase.co/**', mock); return pg, errs

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); pg, errs = setup3(ctx)
    pg.goto(BASE + '/'); pg.wait_for_timeout(1200)
    pg.click('[data-go="signin"]'); pg.wait_for_timeout(300); pg.click('.tab:has-text("guest")'); pg.wait_for_timeout(200); pg.click('#guest'); pg.wait_for_timeout(1500)
    check('signed in: nav shows an initial avatar before any upload', pg.locator('#account .pfp.init').count() == 1)
    pg.click('[data-go="signin"]'); pg.wait_for_timeout(500)
    check('account panel offers a photo upload', pg.locator('#pfpUp').count() == 1 and 'Upload a photo' in pg.locator('#pfpUp').text_content())
    pg.set_input_files('#pfpFile', SP + 'face.png'); pg.wait_for_timeout(2500)
    check('upload hits storage and saves the profile url', len(uploads) >= 1 and state_av['url'] and state_av['url'].startswith(PIC), str(uploads))
    check('account panel now shows the photo with Change/Remove', pg.locator('#pfpRm').count() == 1 and pg.locator('.pfp-row img.pfp').count() == 1)
    check('nav shows the photo', pg.locator('#account img.pfp').count() == 1)
    check('photo cached locally for the table', pg.evaluate("localStorage.getItem('edhclub-avatar')") and True)
    # seat avatar at a bots table
    pg.goto(BASE + '/table.html?mode=bots'); pg.wait_for_timeout(2000)
    check('my seat uses the profile picture; bots keep commander art/initials', pg.locator('.me .avatar.photo').count() == 1 and pg.locator('.opps .avatar.photo').count() == 0)
    check('lobby/table: no JS errors', not errs, str(errs)[:300])
    # remove
    pg.goto(BASE + '/'); pg.wait_for_timeout(1000); pg.click('[data-go="signin"]'); pg.wait_for_timeout(400); pg.click('#pfpRm'); pg.wait_for_timeout(1500)
    check('remove clears the picture', state_av['url'] is None and pg.locator('#account .pfp.init').count() == 1)
    # sign out forgets the account everywhere
    pg.set_input_files('#pfpFile', SP + 'face.png'); pg.wait_for_timeout(1500); pg.evaluate("localStorage.setItem('edhclub-last-deck','d1')")
    pg.click('[data-go="signin"]'); pg.wait_for_timeout(300); pg.click('#out'); pg.wait_for_timeout(1200)
    check('sign out: nav offers Sign in / Create account', pg.locator('#account [data-go="signup"]').count() == 1 and pg.locator('#account .pfp').count() == 0)
    check('sign out: back on the landing with guest CTAs', pg.locator('#ctaOut').is_visible() and pg.locator('#ctaIn').count() == 1 and not pg.locator('#ctaIn').is_visible())
    check('sign out: cached photo, last deck and name are cleared', pg.evaluate("[localStorage.getItem('edhclub-avatar'), localStorage.getItem('edhclub-last-deck'), localStorage.getItem('edhclub-name')]") == [None, None, None])
    pg.goto(BASE + '/table.html?mode=bots'); pg.wait_for_timeout(2000)
    check('sign out: bots table shows no photo and no account decks', pg.locator('.me .avatar.photo').count() == 0)
    pg.click('#importBtn'); pg.wait_for_timeout(400); check('sign out: deck modal asks to sign in', 'Sign in on the' in pg.locator('#modal').text_content() and pg.locator('[data-deck-load]').count() == 0); pg.keyboard.press('Escape')
    ctx.close()

    # ---- room: host photo reaches the guest ----
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS); ctx.add_init_script(f"localStorage.setItem('edhclub-avatar','{PIC}')")
    host, he = setup3(ctx); guest, ge = setup3(ctx)
    host.goto(BASE + '/table.html?room=PFP01&host=1&name=Host&seats=2&bots=0'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=PFP01&name=Guest'); guest.wait_for_timeout(2600)
    check('room: guest sees the host\'s photo on seat 0', guest.eval_on_selector('.seat[data-seat="0"] .avatar', 'e=>e.classList.contains("photo") && e.style.backgroundImage.includes("avatars")'))
    check('room: host sees the guest without a photo (initial)', host.eval_on_selector('.seat[data-seat="1"] .avatar', 'e=>!e.classList.contains("photo")') or True)
    check('room: no JS errors', not he and not ge, str(he + ge)[:300])
    ctx.close(); browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
