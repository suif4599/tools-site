import type { Env } from './env';
import { TOOLS, ToolRoute } from './routes.gen';
import { handleAuth, getSessionUser, json } from './auth';
import { handleAdminApi } from './admin';

const R2_MIME: Record<string, string> = {
  wasm: 'application/wasm',
  js: 'application/javascript',
  json: 'application/json',
  metadata: 'application/json',
  data: 'application/octet-stream',
  ttf: 'font/ttf',
  ttc: 'font/ttf',
  otf: 'font/otf',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  png: 'image/png',
};

function matchTool(path: string): { tool: ToolRoute; rest: string } | null {
  for (const tool of TOOLS) {
    const base = tool.route.replace(/\/+$/, '');
    if (path === base) return { tool, rest: '' };
    if (path.startsWith(base + '/')) return { tool, rest: path.slice(base.length + 1) };
  }
  return null;
}

function redirectToLogin(url: URL): Response {
  const next = url.pathname + url.search;
  return new Response(null, { status: 302, headers: { Location: '/login?next=' + encodeURIComponent(next) } });
}

function csp(tool: ToolRoute | null): string {
  const parts = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'" + (tool?.isolation ? " 'wasm-unsafe-eval'" : ''),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'self'" + (tool?.isolation ? ' blob:' : ''),
  ];
  if (tool?.isolation) parts.push("worker-src 'self' blob:");
  return parts.join('; ') + ';';
}

async function serveAsset(request: Request, env: Env, tool: ToolRoute | null): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 200) return res;
  const headers = new Headers(res.headers);
  if (tool?.isolation) {
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  if ((res.headers.get('Content-Type') || '').includes('text/html')) {
    headers.set('Content-Security-Policy', csp(tool));
  }
  if (tool || (res.headers.get('Content-Type') || '').includes('text/html')) {
    headers.set('Cache-Control', 'no-cache');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function serveR2(request: Request, env: Env, key: string): Promise<Response> {
  const name = key.split('/').pop() || '';
  const ext = name.split('.').pop() || '';
  const headers: Record<string, string> = {
    'Content-Type': R2_MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Vary': 'Accept-Encoding',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if ((request.headers.get('Accept-Encoding') || '').includes('br')) {
    const br = await env.TOOLS_R2.get(key + '.br');
    if (br) {
      return new Response(br.body, {
        headers: { ...headers, 'Content-Encoding': 'br', 'Content-Length': String(br.size) },
      });
    }
  }
  const obj = await env.TOOLS_R2.get(key);
  if (!obj) return json({ error: 'not found' }, 404);
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      if (path.startsWith('/api/auth/')) return handleAuth(request, env, url);
      return json({ error: 'not found' }, 404);
    }

    const m = matchTool(path);
    if (m) {
      const { tool, rest } = m;
      const user = tool.public ? null : await getSessionUser(request, env);
      const machinePath = rest.startsWith('api/') || (!!tool.r2Prefix && rest.startsWith(tool.r2Prefix));
      if (!tool.public && !user) {
        return machinePath ? json({ error: 'unauthorized' }, 401) : redirectToLogin(url);
      }
      if (tool.requiresRole && user!.role !== tool.requiresRole) {
        return machinePath ? json({ error: 'forbidden' }, 403) : new Response('Forbidden', { status: 403 });
      }
      if (rest.startsWith('api/')) {
        if (tool.id !== 'admin') return json({ error: 'not found' }, 404);
        return handleAdminApi(request, env, user!, rest.slice('api/'.length), url);
      }
      if (tool.r2Prefix && rest.startsWith(tool.r2Prefix)) {
        return serveR2(request, env, `${tool.id}/${rest}`);
      }
      return serveAsset(request, env, tool);
    }

    return env.ASSETS.fetch(request);
  },
};
