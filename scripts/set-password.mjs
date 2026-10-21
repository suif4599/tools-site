#!/usr/bin/env node
// Emergency password reset when the only admin is locked out of the UI:
// builds a PBKDF2 hash in the exact src/auth.ts format and runs a D1 UPDATE.
// No server endpoint exists for this on purpose — recovery needs local wrangler credentials.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [username, password] = process.argv.slice(2);
const exec = process.argv.includes('--exec');
const local = process.argv.includes('--local');
if (!username || !password || password.length < 8 || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
  console.error('usage: node scripts/set-password.mjs <username> <password> [--exec] [--local]');
  console.error('       --exec runs the UPDATE via wrangler (add --local for the dev database);');
  console.error('       without --exec it only prints the SQL statement');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const pwHash = `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
const sql = `UPDATE users SET pw_hash = '${pwHash}', failed_attempts = 0, locked_until = 0 WHERE username = '${username}';`;

if (!exec) {
  console.log(sql);
  process.exit(0);
}
const argv = ['d1', 'execute', 'tools-site', '--command', sql];
argv.push(local ? '--local' : '--remote');
const r = spawnSync('node_modules/.bin/wrangler', argv, { stdio: 'inherit' });
process.exit(r.status ?? 1);
