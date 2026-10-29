import { chromium } from 'playwright';
const BASE = process.argv[2];
const OUT = process.env.TEMP + '/svpw/';
const b = await chromium.launch();
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`); };
const errors = [];
const id = Date.now().toString(36);

async function user(name) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(`${name}: ${m.text()}`));
  await p.goto(BASE + '/register');
  await p.fill('#username', name + id);
  await p.fill('#email', name + id + '@t.com');
  await p.fill('#password', 'parola123');
  await p.click('button:has-text("Kayıt ol")');
  await p.waitForURL('**/onboarding');
  await p.click('button:has-text("Kaydet ve başla")');
  await p.waitForURL('**/app');
  return p;
}
const toast = (p) => p.locator('[role="status"].fixed div.card');

try {
  const A = await user('ui_a');
  const B = await user('ui_b');
  await A.goto(BASE + '/rooms/new');
  await A.fill('#rn', 'UI Bildirim Odası');
  await A.click('button:has-text("Odayı oluştur")');
  await A.waitForURL('**/rooms/c*');
  const roomUrl = A.url();
  await A.waitForTimeout(1000);

  // 1. B joins -> A toast
  await B.goto(roomUrl);
  await B.click('button:has-text("Odaya katıl")');
  await B.waitForSelector('text=Çalışma Sayacı');
  await A.waitForTimeout(1500);
  ok((await toast(A).filter({ hasText: 'odaya katıldı' }).count()) === 1, 'A sees exactly one "joined" toast');
  ok((await toast(B).count()) === 0, 'B sees no toast for own join');

  // 2. B starts studying with subject; A gets toast
  await B.fill('#subject', 'Tarih');
  await B.click('button:has-text("Çalışmaya başla")');
  await A.waitForTimeout(1500);
  ok((await toast(A).filter({ hasText: 'çalışmaya başladı (Tarih)' }).count()) === 1, 'A sees "started studying (Tarih)" toast');
  ok(await A.locator('text=· Tarih').count() > 0, 'room scene shows B subject');

  // 6/7. subject edit inline: cancel keeps old, save updates, timer keeps running, persists on reload
  await B.waitForTimeout(2000);
  const clock = async () => (await B.locator('[aria-label="Odak süresi"]').innerText()).trim();
  const toSec = (t) => t.split(':').map(Number).reduce((a, x) => a * 60 + x, 0);
  await B.click('[aria-label="Çalışma konusunu düzenle"]');
  await B.fill('#edit-subject', 'Vazgeçilen');
  await B.click('button:has-text("İptal")');
  ok(await B.locator('text=Tarih').first().isVisible(), 'cancel keeps previous subject');
  const before = toSec(await clock());
  await B.click('[aria-label="Çalışma konusunu düzenle"]');
  await B.fill('#edit-subject', 'Coğrafya');
  await B.click('button:has-text("Kaydet")');
  await B.waitForTimeout(1500);
  ok(await B.locator('text=Coğrafya').first().isVisible(), 'saved subject shown');
  const after = toSec(await clock());
  ok(after >= before + 1, `timer kept running (${before}s -> ${after}s)`);
  await A.waitForTimeout(500);
  ok(await A.locator('text=· Coğrafya').count() > 0, 'A room view updated subject live');
  await B.reload();
  await B.waitForSelector('[aria-label="Odak süresi"]');
  await B.waitForTimeout(1000);
  ok(await B.locator('text=Coğrafya').first().isVisible(), 'subject persists after reload');
  ok(toSec(await clock()) >= after, 'timer not reset after reload');

  // 3. mention -> B toast (emphasised) + bell count; click navigates to message
  await A.fill('[aria-label="Mesaj"]', `@ui_b${id} soru çözelim mi?`);
  await A.click('button:has-text("Gönder")');
  await B.waitForTimeout(1500);
  const mt = toast(B).filter({ hasText: 'seni sohbette etiketledi' });
  ok((await mt.count()) === 1, 'B gets one mention toast');
  ok((await toast(A).filter({ hasText: 'etiketledi' }).count()) === 0, 'A gets no mention toast');
  const bell = B.locator('button[aria-label^="Bildirimler"]');
  ok((await bell.getAttribute('aria-label')).includes('1 okunmamış'), 'bell shows 1 unread');
  await B.goto(BASE + '/app');
  await B.waitForTimeout(800);
  await bell.click();
  await B.click('li button:has-text("etiketledi")');
  await B.waitForURL('**?msg=*');
  await B.waitForTimeout(1500);
  const target = new URL(B.url()).searchParams.get('msg');
  ok(await B.locator(`#msg-${target}.ring-2`).isVisible(), 'notification link opens room and highlights message');
  await B.waitForTimeout(500);
  ok(!(await bell.getAttribute('aria-label')).includes('okunmamış'), 'opened notification marked read');

  // 5. sound prefs persist across reload
  await B.goto(BASE + '/settings');
  await B.getByLabel('Mola', { exact: true }).uncheck();
  await B.waitForTimeout(800);
  await B.reload();
  await B.waitForTimeout(1200);
  ok(!(await B.getByLabel('Mola', { exact: true }).isChecked()) && (await B.getByLabel('Sohbette etiketlenme').isChecked()), 'per-category sound pref persisted after reload');
  await B.getByLabel('Tüm bildirim sesleri (genel anahtar)').uncheck();
  await B.waitForTimeout(800);
  ok(await B.getByLabel('Sohbette etiketlenme').isDisabled(), 'master switch disables categories');
  await B.screenshot({ path: OUT + 'settings.png', fullPage: true });

  // finish from room -> A toast
  await B.goto(roomUrl);
  await B.waitForSelector('button:has-text("Bitir")');
  await B.click('button:has-text("Bitir")');
  await A.waitForTimeout(1500);
  ok((await toast(A).filter({ hasText: 'oturumunu tamamladı' }).count()) === 1, 'A sees "completed session" toast');
  await A.screenshot({ path: OUT + 'room-toasts.png' });
} catch (e) {
  fail++;
  console.log('FAILED:', e.message.split('\n')[0]);
}
console.log(errors.length ? 'Console errors:\n' + errors.join('\n') : 'no console errors');
console.log(`${pass} passed, ${fail} failed`);
await b.close();
