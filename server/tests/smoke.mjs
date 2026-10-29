// End-to-end API + realtime smoke test against a running server (npm run dev).
// Usage: node server/tests/smoke.mjs [baseUrl]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:5173';
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

function client() {
  let cookies = {};
  const req = async (path, method = 'GET', body, headers = {}) => {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studyverse', Origin: new URL(BASE).origin, Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (v) cookies[k] = v; else delete cookies[k];
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { req, cookie: () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), cookies: () => cookies };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = Date.now().toString(36);
const A = client(), B = client(), C = client();

// A. auth
let r = await A.req('/auth/register', 'POST', { username: `a_${id}`, email: `a_${id}@t.com`, password: 'parola123' });
ok(r.status === 201 && !JSON.stringify(r.data).includes('passwordHash'), 'register A (no hash leaked)');
r = await A.req('/auth/register', 'POST', { username: `a_${id}`, email: `x_${id}@t.com`, password: 'parola123' });
ok(r.status === 409, 'duplicate username rejected');
r = await A.req('/auth/register', 'POST', { username: `w_${id}`, email: `w_${id}@t.com`, password: 'short' });
ok(r.status === 400, 'weak password rejected');
await B.req('/auth/register', 'POST', { username: `b_${id}`, email: `b_${id}@t.com`, password: 'parola123' });
await C.req('/auth/register', 'POST', { username: `c_${id}`, email: `c_${id}@t.com`, password: 'parola123' });
r = await client().req('/auth/login', 'POST', { identifier: `a_${id}`, password: 'yanlis123' });
ok(r.status === 401, 'wrong password rejected');
r = await client().req('/sessions/current');
ok(r.status === 401, 'protected route without auth -> 401');
r = await A.req('/sessions/start', 'POST', {}, { 'X-Requested-With': '' });
ok(r.status === 403, 'CSRF header missing -> 403');

// C. avatar
r = await A.req('/me/avatar', 'PUT', { base: 'cat', skinTone: 'honey', hairStyle: 'long', hairColor: 'ginger', outfitStyle: 'tee', outfitColor: 'rose', accessory: 'bow', deskItem: 'mug' });
ok(r.status === 200 && r.data.user.avatar.base === 'cat', 'avatar saved');
r = await A.req('/me/avatar', 'PUT', { base: 'cat', skinTone: 'honey', hairStyle: 'long', hairColor: 'galaxy', outfitStyle: 'tee', outfitColor: 'rose', accessory: 'bow', deskItem: 'mug' });
ok(r.status === 403, 'locked cosmetic rejected (level 10 hair)');
await B.req('/me/avatar', 'PUT', { base: 'human', skinTone: 'cocoa', hairStyle: 'bun', hairColor: 'black', outfitStyle: 'hoodie', outfitColor: 'sky', accessory: 'glasses', deskItem: 'books' });

// D/E/F. rooms
r = await A.req('/rooms', 'POST', { name: 'Test Odası', maxParticipants: 2 });
const pub = r.data.room;
ok(r.status === 201 && pub.passwordHash === undefined, 'public room created, no hash exposed');
r = await B.req(`/rooms/${pub.id}/join`, 'POST', {});
ok(r.status === 200, 'B joins public room');
r = await B.req(`/rooms/${pub.id}/join`, 'POST', {});
ok(r.status === 200, 'duplicate join idempotent');
r = await C.req(`/rooms/${pub.id}/join`, 'POST', {});
ok(r.status === 409 && r.data.error.code === 'ROOM_FULL', 'capacity enforced');
r = await B.req(`/rooms/${pub.id}/kick`, 'POST', { userId: (await A.req('/auth/me')).data.user.id });
ok(r.status === 403, 'non-owner cannot kick');

r = await A.req('/rooms', 'POST', { name: 'Gizli Oda', visibility: 'PRIVATE', password: 'gizli42' });
const priv = r.data.room;
r = await C.req(`/rooms/${priv.id}`);
ok(r.status === 404, 'private room hidden from non-member');
r = await C.req(`/rooms/${priv.id}/join`, 'POST', { password: 'gizli42' });
ok(r.status === 404, 'private room needs invite even with password');
r = await A.req(`/rooms/${priv.id}/invites`, 'POST', {});
const code = r.data.code;
ok(r.status === 201 && code.length >= 20, 'invite code created (non-guessable)');
r = await C.req('/rooms/join-by-code', 'POST', { inviteCode: code, password: 'yanlis' });
ok(r.status === 401 && r.data.error.code === 'WRONG_PASSWORD', 'wrong room password rejected');
r = await C.req('/rooms/join-by-code', 'POST', { inviteCode: code, password: 'gizli42' });
ok(r.status === 200, 'invite + password joins private room');
r = await C.req(`/rooms/${pub.id}/messages`);
ok(r.status === 403, 'non-member cannot read chat');

// G/H. realtime: two users in the same room
const sock = (c) => io(BASE, { extraHeaders: { Cookie: c.cookie() }, transports: ['websocket'] });
const sa = sock(A), sb = sock(B);
await sleep(800);
ok(sa.connected && sb.connected, 'both sockets connected');
const presenceSeen = [];
sa.on('room:presence', (p) => presenceSeen.push(p));
const msgs = [];
sa.on('chat:message', (m) => msgs.push(m));
const emit = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
ok((await emit(sa, 'room:join', { roomId: pub.id })).ok, 'A joins live channel');
ok((await emit(sb, 'room:join', { roomId: pub.id })).ok, 'B joins live channel');
const bad = await emit(sb, 'room:join', { roomId: priv.id });
ok(!bad.ok, 'B cannot join live channel of private room');
await sleep(300);
r = await A.req(`/rooms/${pub.id}/members`);
ok(r.data.items.filter((m) => m.inRoom).length === 2, 'members endpoint shows 2 present');

// I. study session (B, in room)
r = await B.req('/sessions/start', 'POST', { subject: 'Fizik', roomId: pub.id, requestId: 'req1' });
ok(r.status === 201 && r.data.session.status === 'ACTIVE', 'B starts session');
r = await B.req('/sessions/start', 'POST', { subject: 'Fizik', roomId: pub.id, requestId: 'req1' });
ok(r.status === 201, 'same requestId is idempotent');
const [s1, s2] = await Promise.all([B.req('/sessions/start', 'POST', {}), B.req('/sessions/start', 'POST', {})]);
ok(s1.status === 409 && s2.status === 409, 'concurrent duplicate starts rejected (one open session)');
await sleep(600);
ok(presenceSeen.some((p) => p.status === 'studying'), 'A received B "studying" presence');
r = await A.req(`/rooms/${pub.id}/members`);
ok(r.data.items.find((m) => m.username === `b_${id}`).status === 'studying', 'room shows B studying');
await sleep(1500);
r = await B.req('/sessions/current/pause', 'POST');
ok(r.data.session.status === 'PAUSED', 'pause');
const pausedFocus = r.data.session.focusSeconds;
await sleep(2200);
r = await B.req('/sessions/current');
ok(r.data.session.focusSeconds === pausedFocus, 'paused time not counted');
await B.req('/sessions/current/resume', 'POST');
await sleep(1100);
r = await B.req('/sessions/current/break', 'POST');
ok(r.data.session.status === 'ON_BREAK', 'break started');
await sleep(1100);
r = await B.req('/sessions/current/finish', 'POST', {});
ok(r.status === 200 && r.data.session.status === 'COMPLETED' && r.data.session.breakSeconds >= 1, 'finish; break tracked separately');
ok(r.data.xpAwarded === 0, 'short (<5 min) session earns no XP');
r = await B.req('/sessions/current/finish', 'POST', {});
ok(r.status === 404, 'double finish rejected');

// N. chat
ok((await emit(sa, 'chat:send', { roomId: pub.id, body: '<script>alert(1)</script> merhaba' })).ok, 'chat send');
ok(!(await emit(sa, 'chat:send', { roomId: pub.id, body: 'x'.repeat(501) })).ok, 'chat >500 chars rejected');
ok(!(await emit(sa, 'chat:send', { roomId: pub.id, body: '   ' })).ok, 'empty chat rejected');
await sleep(300);
ok(msgs.some((m) => m.body.includes('<script>')), 'message stored as plain text (escaped by React on render)');

// H. disconnect -> B shown out of room
sb.disconnect();
await sleep(600);
r = await A.req(`/rooms/${pub.id}/members`);
ok(!r.data.items.find((m) => m.username === `b_${id}`).inRoom, 'B left room on disconnect');

// stats
r = await B.req('/stats');
ok(r.status === 200 && r.data.sessionCount === 1 && r.data.todaySeconds >= 2, 'stats reflect session');

// ───────── room notifications & sounds prefs & subject edit ─────────
{
  const listen = (s) => {
    const ev = [], notes = [];
    s.on('room:event', (e) => ev.push(e));
    s.on('notification:new', (n) => notes.push(n));
    return { ev, notes };
  };
  await sleep(9000); // let the earlier disconnect's leave-grace expire
  const a2 = sock(A);
  await sleep(600);
  const la = listen(a2);
  ok((await emit(a2, 'room:join', { roomId: pub.id })).ok, '[N] A in room');
  const b2 = sock(B);
  await sleep(600);
  const lb = listen(b2);
  await emit(b2, 'room:join', { roomId: pub.id });
  await sleep(500);
  ok(la.ev.filter((e) => e.type === 'join' && e.actorName === `b_${id}`).length === 1, '[1] A got exactly one "joined" event for B');
  ok(lb.ev.length === 0, '[1] B got no event for own join');

  await B.req('/sessions/start', 'POST', { subject: 'Kimya', requestId: 'n1' });
  await sleep(300);
  await B.req('/sessions/current/break', 'POST');
  await B.req('/sessions/current/break', 'POST'); // no-op: already on break
  await sleep(300);
  await B.req('/sessions/current/endBreak', 'POST');
  await sleep(300);
  const types = () => la.ev.filter((e) => e.actorId !== undefined && e.actorName === `b_${id}`).map((e) => e.type);
  ok(JSON.stringify(types()) === JSON.stringify(['join', 'study_start', 'break', 'resume']), `[2] start/break/resume events in order, no dup (${types()})`);
  ok(la.ev.find((e) => e.type === 'study_start')?.subject === 'Kimya', '[2] start event carries subject');
  ok(new Set(la.ev.map((e) => e.id)).size === la.ev.length, '[2] every event id unique');

  // 6/7/8. subject edit during an active session
  await sleep(2100);
  let cur = (await B.req('/sessions/current')).data.session;
  const focusBefore = cur.focusSeconds, sid = cur.id, started = cur.startedAt;
  const xpBefore = (await B.req('/auth/me')).data.user.xp;
  r = await B.req('/sessions/current/subject', 'POST', { subject: '  Matematik   Türev ' });
  ok(r.status === 200 && r.data.session.subject === 'Matematik Türev', '[6] subject updated (trimmed/normalized)');
  ok(r.data.session.id === sid && r.data.session.startedAt === started && r.data.session.status === 'ACTIVE', '[6] same session, still running');
  ok(r.data.session.focusSeconds >= focusBefore, `[6] focus time not reset (${focusBefore}s -> ${r.data.session.focusSeconds}s)`);
  await sleep(300);
  ok(la.ev.some((e) => e.type === 'subject_change' && e.subject === 'Matematik Türev'), '[6] room got subject_change event');
  r = await B.req('/sessions/current/subject', 'POST', { subject: '   ' });
  ok(r.status === 400, '[6] empty subject rejected');
  r = await B.req('/sessions/current/subject', 'POST', { subject: 'x'.repeat(41) });
  ok(r.status === 400, '[6] >40 char subject rejected');
  r = await A.req('/sessions/current/subject', 'POST', { subject: 'Hack' });
  ok(r.status === 404, '[8] A cannot change a subject without own session (no access to B)');
  cur = (await B.req('/sessions/current')).data.session;
  ok(cur.subject === 'Matematik Türev', '[7] subject persists on reload (GET current)');
  const [c1, c2] = await Promise.all([
    B.req('/sessions/current/subject', 'POST', { subject: 'Geometri' }),
    B.req('/sessions/current/subject', 'POST', { subject: 'Biyoloji' }),
  ]);
  ok(c1.status === 200 && c2.status === 200, '[8] concurrent subject changes both handled');
  await sleep(1100);
  const fin = await B.req('/sessions/current/finish', 'POST', {});
  const total = fin.data.session.focusSeconds;
  const stats = (await B.req('/stats')).data;
  const sumSubjects = stats.subjects.filter((x) => ['Kimya', 'Matematik Türev', 'Geometri', 'Biyoloji'].includes(x.name)).reduce((a, x) => a + x.seconds, 0);
  ok(Math.abs(sumSubjects - total) <= 1, `[8] per-subject time sums to session total, no double count (${sumSubjects}s vs ${total}s)`);
  ok(stats.subjects.some((x) => x.name === 'Kimya' && x.seconds >= 2), '[6] time before change stays on old subject (Kimya)');
  ok(fin.data.xpAwarded === 0 && (await B.req('/auth/me')).data.user.xp === xpBefore, '[6] subject change awarded no XP');
  await sleep(300);
  ok(la.ev.filter((e) => e.type === 'finish').length === 1, '[2] exactly one finish event');

  // 3. mentions: only the tagged member
  const am = await emit(a2, 'chat:send', { roomId: pub.id, body: `selam @b_${id} ve @c_${id} nasılsın` });
  await sleep(500);
  ok(am.ok && lb.notes.length === 1 && lb.notes[0].messageId === am.message.id && lb.notes[0].roomId === pub.id, '[3] B got one mention notification with message link');
  ok(la.notes.length === 0, '[3] sender got no notification');
  r = await C.req('/notifications');
  ok(r.data.items.length === 0, '[3] non-member C mentioned but not notified (not in room)');

  // 4. offline user keeps persistent mention
  b2.disconnect();
  await sleep(300);
  const off = await emit(a2, 'chat:send', { roomId: pub.id, body: `@b_${id} geri gelince bunu gör` });
  r = await B.req('/notifications');
  ok(r.data.unread === 2 && r.data.items.some((n) => n.messageId === off.message.id && !n.readAt), '[4] offline B sees unread mention after return');
  const theirs = r.data.items[0].id;
  r = await A.req(`/notifications/${theirs}/read`, 'POST');
  ok(r.data.updated === 0, '[8] A cannot mark B notification read');
  await B.req(`/notifications/${theirs}/read`, 'POST');
  ok((await B.req('/notifications')).data.unread === 1, '[4] mark one read');
  await B.req('/notifications/read-all', 'POST');
  ok((await B.req('/notifications')).data.unread === 0, '[4] mark all read');

  // 5. per-category sound prefs persist
  r = await B.req('/me/settings', 'PATCH', { soundMention: false, soundJoinLeave: false, soundSubject: true });
  const st = (await B.req('/auth/me')).data.user.settings;
  ok(st.soundMention === false && st.soundJoinLeave === false && st.soundSubject === true && st.soundBreak === true, '[5] sound prefs saved independently and persist');
  r = await B.req('/me/settings', 'PATCH', { soundMention: 'yes' });
  ok(r.status === 400, '[5] invalid pref value rejected');

  // leave after grace; quick reconnect produces no leave/join
  await sleep(9000); // b2 went offline above; its grace window must pass first
  const before = la.ev.length;
  const b3 = sock(B);
  await sleep(500);
  await emit(b3, 'room:join', { roomId: pub.id });
  b3.disconnect();
  await sleep(500);
  const b4 = sock(B);
  await sleep(500);
  await emit(b4, 'room:join', { roomId: pub.id });
  await sleep(500);
  const joinsAfter = la.ev.slice(before).map((e) => e.type);
  ok(JSON.stringify(joinsAfter) === '["join"]', `[1] refresh within grace: single join, no leave/join pair (${joinsAfter})`);
  await emit(b4, 'room:leave', {});
  await sleep(9000);
  ok(la.ev.slice(before).filter((e) => e.type === 'leave').length === 1, '[1] one "left" event after grace period');
  b4.disconnect();
  a2.disconnect();
}

// B. logout revokes immediately
const before = B.cookies().sv_at;
await B.req('/auth/logout', 'POST');
r = await fetch(BASE + '/api/sessions/current', { headers: { Cookie: `sv_at=${before}` } });
ok(r.status === 401, 'old access token rejected after logout');
// refresh rotation
r = await A.req('/auth/refresh', 'POST');
ok(r.status === 200, 'refresh rotates');

sa.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
