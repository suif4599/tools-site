import type { Env } from './env';
import { json, hasCsrfHeader, hashPassword, validUsername, validPassword, logout, SessionUser } from './auth';

interface UserRow {
  id: string;
  username: string;
  role: string;
  disabled: number;
  created_at: number;
}

async function getUser(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT id, username, role, disabled, created_at FROM users WHERE id = ?').bind(id).first<UserRow>();
}

async function activeAdminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").first<{ n: number }>();
  return row?.n ?? 0;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Every admin API lives under /admin/api/* so a single Access rule on /admin/* covers page and API.
export async function handleAdminApi(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
  url: URL,
): Promise<Response> {
  if (!hasCsrfHeader(request)) return json({ error: 'missing CSRF header' }, 403);

  if (rest === 'session' && request.method === 'GET') {
    return json({ username: user.username, role: user.role });
  }
  if (rest === 'logout' && request.method === 'POST') {
    return logout(request, env, url);
  }

  if (rest === 'users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, username, role, disabled, created_at FROM users ORDER BY created_at',
    ).all<UserRow>();
    return json(results ?? []);
  }

  if (rest === 'users' && request.method === 'POST') {
    const body = await readJson(request);
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    const role = body?.role === 'admin' ? 'admin' : 'user';
    if (!validUsername(username)) return json({ error: 'invalid username (3-32 chars, letters/digits/_/-/.)' }, 400);
    if (!validPassword(password)) return json({ error: 'password must be 8-200 characters' }, 400);
    const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE username = ?').bind(username).first();
    if (exists) return json({ error: 'username already taken' }, 409);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users (id, username, pw_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, username, await hashPassword(password), role, Math.floor(Date.now() / 1000)).run();
    console.log(JSON.stringify({ evt: 'admin_user_created', by: user.username, username, role }));
    return json({ id }, 201);
  }

  const m = rest.match(/^users\/([a-f0-9-]+)(?:\/(password))?$/);
  if (m && !m[2] && request.method === 'PATCH') {
    const body = await readJson(request);
    const target = await getUser(env, m[1]);
    if (!target) return json({ error: 'not found' }, 404);
    const disabled = body?.disabled === undefined ? target.disabled : body.disabled ? 1 : 0;
    const role = body?.role === undefined ? target.role : body.role === 'admin' ? 'admin' : 'user';
    if (target.id === user.id && (disabled || role !== 'admin')) {
      return json({ error: 'cannot disable or demote yourself' }, 409);
    }
    if (target.role === 'admin' && (disabled || role !== 'admin') && (await activeAdminCount(env)) <= 1) {
      return json({ error: 'cannot remove the last active admin' }, 409);
    }
    await env.DB.prepare('UPDATE users SET disabled = ?, role = ? WHERE id = ?').bind(disabled, role, target.id).run();
    console.log(JSON.stringify({ evt: 'admin_user_updated', by: user.username, username: target.username, disabled, role }));
    return json({ ok: true });
  }

  if (m && m[2] === 'password' && request.method === 'POST') {
    const body = await readJson(request);
    const password = String(body?.password ?? '');
    if (!validPassword(password)) return json({ error: 'password must be 8-200 characters' }, 400);
    const target = await getUser(env, m[1]);
    if (!target) return json({ error: 'not found' }, 404);
    await env.DB.prepare('UPDATE users SET pw_hash = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?')
      .bind(await hashPassword(password), target.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
    console.log(JSON.stringify({ evt: 'admin_password_set', by: user.username, username: target.username }));
    return json({ ok: true });
  }

  if (m && !m[2] && request.method === 'DELETE') {
    const target = await getUser(env, m[1]);
    if (!target) return json({ error: 'not found' }, 404);
    if (target.id === user.id) return json({ error: 'cannot delete yourself' }, 409);
    if (target.role === 'admin' && (await activeAdminCount(env)) <= 1) {
      return json({ error: 'cannot delete the last active admin' }, 409);
    }
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
    console.log(JSON.stringify({ evt: 'admin_user_deleted', by: user.username, username: target.username }));
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}
