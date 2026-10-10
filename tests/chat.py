"""Table chat: live between host, guests and spectators; unread badges; escaping; cleared on a new game; no persistence."""
import sys, json, time
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
def msgs(pg): return pg.locator('#chatList .chatmsg .chattext').all_text_contents()
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(); ctx.add_init_script(FAKE_CHANNEL_JS)
    host, he = setup(ctx); guest, ge = setup(ctx); spec, se = setup(ctx)
    host.goto(BASE + '/table.html?room=CHAT1&host=1&name=Host&seats=3&bots=1'); host.wait_for_timeout(2000)
    guest.goto(BASE + '/table.html?room=CHAT1&name=Guest'); guest.wait_for_timeout(2200)
    spec.goto(BASE + '/table.html?room=CHAT1&spectate=1&name=Watcher'); spec.wait_for_timeout(2200)
    # host opens chat, types, Enter sends
    host.click('.side-tabs .tab[data-tab=chat]'); host.wait_for_timeout(200)
    check('chat tab shows the input and an empty-state note', host.locator('#chatInput').count() == 1 and 'Nobody has said' in host.locator('#chatList').text_content())
    host.fill('#chatInput', 'gl hf everyone'); host.keyboard.press('Enter'); host.wait_for_timeout(600)
    check('Enter sends; my message shows on my side as mine', msgs(host) == ['gl hf everyone'] and host.locator('#chatList .chatmsg.mine').count() == 1 and host.locator('#chatInput').input_value() == '')
    check('guest receives it with the sender name', msgs(guest) == ['gl hf everyone'] and 'Host' in guest.locator('#chatList .chatwho').first.text_content())
    check('guest (on the log tab) sees an unread badge on the Chat tab and the panel button', guest.locator('.side-tabs .tab[data-tab=chat] .badge').text_content() == '1' and guest.locator('#sideBtn .badge').count() == 1)
    guest.click('.side-tabs .tab[data-tab=chat]'); guest.wait_for_timeout(200)
    check('opening the chat clears the badge', guest.locator('.side-tabs .tab[data-tab=chat] .badge').count() == 0 and guest.locator('#sideBtn .badge').count() == 0)
    guest.fill('#chatInput', '<b>hi</b> & good luck'); guest.click('#chatSend'); guest.wait_for_timeout(600)
    check('guest reply arrives at the host, HTML escaped (shown as text)', msgs(host)[-1] == '<b>hi</b> & good luck' and host.locator('#chatList b').count() == 0)
    check('the host, with the chat open, gets no unread badge for it', host.locator('.side-tabs .tab[data-tab=chat] .badge').count() == 0)
    # spectator can talk and is marked
    spec.click('.side-tabs .tab[data-tab=chat]'); spec.wait_for_timeout(200); spec.fill('#chatInput', 'nice board'); spec.keyboard.press('Enter'); spec.wait_for_timeout(600)
    check('spectator message reaches everyone, tagged (watching)', msgs(host)[-1] == 'nice board' and 'Watcher (watching)' in host.locator('#chatList .chatwho').last.text_content() and msgs(guest)[-1] == 'nice board')
    # typing in chat doesn't fire shortcuts
    ph = state(host)['turn']['phase']; host.fill('#chatInput', 't a x'); host.wait_for_timeout(200)
    check('typing letters in the chat box does not trigger table shortcuts', state(host)['turn']['phase'] == ph and len(state(host)['attacks']) == 0); host.fill('#chatInput', '')
    # limits
    host.fill('#chatInput', 'x' * 400); host.keyboard.press('Enter'); host.wait_for_timeout(500)
    check('messages are capped at 300 characters', len(msgs(host)[-1]) == 300)
    # new game clears for everyone
    host.click('#newBtn'); host.wait_for_timeout(200); host.click('#modal .btn:not(.ghost)'); host.wait_for_timeout(1200)
    check('New game clears the chat for host and guest', len(msgs(host)) == 1 and 'chat cleared' in msgs(host)[0] and len(msgs(guest)) == 1)
    # nothing persisted
    host.reload(); host.wait_for_timeout(2200); host.click('.side-tabs .tab[data-tab=chat]'); host.wait_for_timeout(200)
    check('a reload starts with an empty chat (nothing stored)', 'Nobody has said' in host.locator('#chatList').text_content())
    check('no JS errors', not he and not ge and not se, str(he + ge + se)[:300])
    ctx.close()
    # bots mode: local notes only
    ctx = browser.new_context(); pg, errs = setup(ctx); pg.goto(BASE + '/table.html?mode=bots'); pg.wait_for_timeout(1500)
    pg.click('.side-tabs .tab[data-tab=chat]'); pg.wait_for_timeout(200); pg.fill('#chatInput', 'note to self'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    check('bots mode: chat works locally', msgs(pg) == ['note to self'] and not errs)
    # mobile: chat is reachable from the Panel button
    ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); pm, em = setup(ctx2); pm.set_viewport_size({'width': 390, 'height': 844}); pm.goto(BASE + '/table.html?mode=bots'); pm.wait_for_timeout(1500)
    pm.click('#sideBtn'); pm.wait_for_timeout(300); pm.click('.side-tabs .tab[data-tab=chat]'); pm.wait_for_timeout(200)
    box = pm.locator('#chatInput').bounding_box(); check('phone: chat input is visible inside the viewport', box and box['y'] + box['height'] <= 844 and box['x'] >= 0, str(box))
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
