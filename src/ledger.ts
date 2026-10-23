import type { Env } from './env';
import { hasCsrfHeader, json, type SessionUser } from './auth';

const TOOL_ID = 'apiledger';
const MAX_BODY = 10 * 1024 * 1024;
const MAX_SOURCES = 100;
const MAX_ROWS = 5000;
const MAX_ROWS_PER_SOURCE = 5000;
const ROWS_PER_STATEMENT = 100;
const MAX_TEXT = 512;

interface LedgerRow {
  date: string;
  platform: string;
  project: string;
  model: string;
  type: string;
  tokens: number;
  cost: number;
  unit_price: number;
  currency: string;
}

interface LedgerSource {
  source_file: string;
  updated_at: number;
  deleted: boolean;
  rows: LedgerRow[];
}

interface SourceState {
  source_file: string;
  updated_at: number;
  deleted: number;
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function isText(value: unknown, limit = MAX_TEXT): boolean {
  return typeof value === 'string' && value.length <= limit;
}

function isNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseSource(value: unknown): LedgerSource | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!isText(source.source_file, MAX_TEXT) || !source.source_file) return null;
  if (!isNumber(source.updated_at) || !Number.isInteger(source.updated_at)) return null;
  const deleted = source.deleted === true || source.deleted === 1;
  const rows: LedgerRow[] = [];
  if (!deleted) {
    if (!Array.isArray(source.rows) || source.rows.length > MAX_ROWS_PER_SOURCE) return null;
    for (const raw of source.rows) {
      if (!raw || typeof raw !== 'object') return null;
      const row = raw as Record<string, unknown>;
      if (!['date', 'platform', 'project', 'model', 'type'].every((key) => isText(row[key]))) {
        return null;
      }
      if (!['tokens', 'cost', 'unit_price'].every((key) => isNumber(row[key]))) return null;
      if (row.currency !== undefined && !isText(row.currency)) return null;
      rows.push({
        date: row.date as string,
        platform: row.platform as string,
        project: row.project as string,
        model: row.model as string,
        type: row.type as string,
        tokens: row.tokens as number,
        cost: row.cost as number,
        unit_price: row.unit_price as number,
        currency: (row.currency as string) || '',
      });
    }
  }
  return {
    source_file: source.source_file as string,
    updated_at: source.updated_at as number,
    deleted,
    rows,
  };
}

export async function handleLedgerApi(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
): Promise<Response> {
  if (rest !== 'sync') return json({ error: 'not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!hasCsrfHeader(request)) return json({ error: 'forbidden' }, 403);

  const body = await request.text();
  if (body.length > MAX_BODY) return json({ ok: false, error: 'payload too large' }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return badRequest('invalid json');
  }
  if (!payload || typeof payload !== 'object') return badRequest('invalid body');
  const rawSources = (payload as { sources?: unknown }).sources;
  if (!Array.isArray(rawSources) || rawSources.length > MAX_SOURCES) {
    return badRequest('invalid sources');
  }

  const sources: LedgerSource[] = [];
  let totalRows = 0;
  for (const raw of rawSources) {
    const source = parseSource(raw);
    if (!source) return badRequest('invalid source');
    totalRows += source.rows.length;
    sources.push(source);
  }
  if (totalRows > MAX_ROWS) return badRequest('too many rows');

  const existing = await env.DB.prepare(
    'SELECT source_file, updated_at, deleted FROM ledger_sources WHERE user_id = ? AND tool_id = ?',
  ).bind(user.id, TOOL_ID).all<SourceState>();
  const serverState = new Map<string, SourceState>();
  for (const row of existing.results) serverState.set(row.source_file, row);

  const accepted = sources.filter((source) => {
    const current = serverState.get(source.source_file);
    return !current || source.updated_at > current.updated_at;
  });

  const statements: D1PreparedStatement[] = [];
  for (const source of accepted) {
    statements.push(
      env.DB.prepare(
        'DELETE FROM ledger_records WHERE user_id = ? AND tool_id = ? AND source_file = ?',
      ).bind(user.id, TOOL_ID, source.source_file),
    );
    if (!source.deleted && source.rows.length) {
      for (let start = 0; start < source.rows.length; start += ROWS_PER_STATEMENT) {
        const rows = source.rows.slice(start, start + ROWS_PER_STATEMENT);
        statements.push(
          env.DB.prepare(
            `INSERT OR REPLACE INTO ledger_records
               (user_id, tool_id, source_file, date, platform, project, model, type,
                tokens, cost, unit_price, currency)
             SELECT ?1, ?2, ?3,
               json_extract(value, '$.date'), json_extract(value, '$.platform'),
               json_extract(value, '$.project'), json_extract(value, '$.model'),
               json_extract(value, '$.type'), json_extract(value, '$.tokens'),
               json_extract(value, '$.cost'), json_extract(value, '$.unit_price'),
               json_extract(value, '$.currency')
             FROM json_each(?4)`,
          ).bind(user.id, TOOL_ID, source.source_file, JSON.stringify(rows)),
        );
      }
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO ledger_sources (user_id, tool_id, source_file, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, tool_id, source_file) DO UPDATE SET
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
      ).bind(user.id, TOOL_ID, source.source_file, source.updated_at, source.deleted ? 1 : 0),
    );
  }

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }

  const states = await env.DB.prepare(
    'SELECT source_file, updated_at, deleted FROM ledger_sources WHERE user_id = ? AND tool_id = ? ORDER BY source_file',
  ).bind(user.id, TOOL_ID).all<SourceState>();

  const records = await env.DB.prepare(
    `SELECT source_file, date, platform, project, model, type, tokens, cost, unit_price, currency
     FROM ledger_records WHERE user_id = ? AND tool_id = ?
     ORDER BY source_file, date, platform, project, model, type`,
  ).bind(user.id, TOOL_ID).all<LedgerRow & { source_file: string }>();

  const bySource = new Map<string, LedgerRow[]>();
  for (const record of records.results) {
    const rows = bySource.get(record.source_file) ?? [];
    rows.push({
      date: record.date,
      platform: record.platform,
      project: record.project,
      model: record.model,
      type: record.type,
      tokens: record.tokens,
      cost: record.cost,
      unit_price: record.unit_price,
      currency: record.currency,
    });
    bySource.set(record.source_file, rows);
  }

  return json({
    ok: true,
    sources: states.results.map((state) => ({
      source_file: state.source_file,
      updated_at: state.updated_at,
      deleted: !!state.deleted,
      rows: state.deleted ? [] : bySource.get(state.source_file) ?? [],
    })),
  });
}
