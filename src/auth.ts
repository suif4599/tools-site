import type { Env } from './env';

const SESSION_COOKIE = 'tools_session';
const SESSION_TTL = 7 * 24 * 3600;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;
const PBKDF2_ITERATIONS = 100_000;

export interface SessionUser {
  id: string;
  username: string;
  role: string;
  token: string;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function hasCsrfHeader(request: Request): boolean {
  return request.method === 'GET' || request.headers.get('X-Requested-With') !== null;
}

export function validUsername(name: string): boolean {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(name);
}

export function validPassword(pw: string): boolean {
  return pw.length >= 8 && pw.length <= 200;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = unb64(parts[2]);
  const want = unb64(parts[3]);
  const got = await derive(password, salt, iterations);
  if (got.length !== want.length) return false;
  const subtle = crypto.subtle as unknown as { timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(got as unknown as BufferSource, want as unknown as BufferSource);
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function cookieFor(url: URL, token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isLocal(url) ? '' : '; Secure'}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function newToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return b64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createSession(env: Env, userId: string, request: Request): Promise<string> {
  const token = newToken();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(token, userId, now, now + SESSION_TTL, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '')
    .run();
  // cap concurrent sessions like cloud-mail's token whitelist, evicting the oldest
  await env.DB.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND token NOT IN (SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20)',
  ).bind(userId, userId).run();
  return token;
}

export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT s.token AS token, s.expires_at AS expires_at, u.id AS id, u.username AS username, u.role AS role, u.disabled AS disabled ' +
      'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
  ).bind(token).first<{
    token: string; expires_at: number; id: string; username: string; role: string; disabled: number;
  }>();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expires_at < now || row.disabled) return null;
  if (row.expires_at - now < SESSION_TTL / 2) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').bind(now + SESSION_TTL, token).run();
  }
  return { id: row.id, username: row.username, role: row.role, token };
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.warn(JSON.stringify({ evt: 'turnstile_skipped', reason: 'TURNSTILE_SECRET_KEY not set' }));
    return true;
  }
  if (typeof token !== 'string' || !token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'POST' && !hasCsrfHeader(request)) return json({ error: 'missing CSRF header' }, 403);
  const path = url.pathname;
  if (path === '/api/auth/config' && request.method === 'GET') {
    return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
  }
  if (path === '/api/auth/login' && request.method === 'POST') return login(request, env, url);
  if (path === '/api/auth/logout' && request.method === 'POST') return logout(request, env, url);
  if (path === '/api/auth/session' && request.method === 'GET') {
    const user = await getSessionUser(request, env);
    return json(user ? { authenticated: true, username: user.username, role: user.role } : { authenticated: false });
  }
  if (path === '/api/auth/bootstrap' && request.method === 'POST') return bootstrap(request, env);
  return json({ error: 'not found' }, 404);
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  const body = await readJson(request);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!username || !password) return json({ error: 'invalid credentials' }, 401);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  if (!(await verifyTurnstile(env, body?.turnstileToken, ip))) {
    console.log(JSON.stringify({ evt: 'login_denied', stage: 'turnstile', username }));
    return json({ error: 'captcha check failed' }, 401);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<{
    id: string; username: string; pw_hash: string; role: string; failed_attempts: number; locked_until: number;
  }>();
  const now = Math.floor(Date.now() / 1000);
  if (user && user.locked_until > now) {
    return json({ error: 'too many attempts; try again in a few minutes' }, 429);
  }

  const ok = !!user && (await verifyPassword(password, user.pw_hash));
  if (!ok) {
    if (user) {
      const failures = user.failed_attempts + 1;
      const locked = failures >= MAX_FAILURES;
      await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
        .bind(locked ? 0 : failures, locked ? now + LOCK_SECONDS : 0, user.id).run();
    }
    console.log(JSON.stringify({ evt: 'login_failed', username }));
    return json({ error: 'invalid credentials' }, 401);
  }

  await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?').bind(user.id).run();
  // expired rows never disappear on their own; sweep occasionally instead of every login
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  }
  const token = await createSession(env, user.id, request);
  console.log(JSON.stringify({ evt: 'login_ok', username }));
  return json({ username: user.username, role: user.role }, 200, { 'Set-Cookie': cookieFor(url, token, SESSION_TTL) });
}

export async function logout(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (user) await deleteSession(env, user.token);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieFor(url, '', 0) });
}

async function bootstrap(request: Request, env: Env): Promise<Response> {
  if (!env.BOOTSTRAP_TOKEN) return json({ error: 'not found' }, 404);
  const body = await readJson(request);
  if (!body || body.token !== env.BOOTSTRAP_TOKEN) return json({ error: 'not found' }, 404);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return json({ error: 'not found' }, 404);
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!validUsername(username) || !validPassword(password)) {
    return json({ error: 'invalid username or password' }, 400);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, username, pw_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, username, await hashPassword(password), 'admin', Math.floor(Date.now() / 1000)).run();
  console.log(JSON.stringify({ evt: 'bootstrap_ok', username }));
  return json({ ok: true }, 201);
}
