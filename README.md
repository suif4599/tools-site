# Suif4599's Tools Site

Personal tools hub on a single Cloudflare Worker: Static Assets + R2 + D1, session auth (Turnstile), no open registration. Tools mount as subpaths (`/t/<tool>/`). Tools marked `public = true` in tools.toml (pptx, apiledger) need no login to open; storage APIs still require a session (apiledger cloud history), and the account system also backs admin. The admin app mounts at `/admin/` with all of its APIs under `/admin/api/*`, so a single Cloudflare Access rule on `/admin/*` covers both the page and its API (pair it with a bypass rule on `/`).

## Layout

- `src/` — Worker: auth (`/api/auth/*`), admin API (`/admin/api/*`), R2 serving with brotli negotiation (`/t/pptx/lo/*`); `run_worker_first` routes `/t/*`, `/api/*` and `/admin/*` through the Worker, which gates non-public tools and admin, and passes public tools through.
- `public/` — deployed assets: `/ui/` design system, login, index, `t/<tool>/` and `admin/` app copies produced by `scripts/sync.mjs`.
- `tools.toml` — the tool registry; `scripts/build.mjs` derives `public/_headers`, `src/routes.gen.ts` and the index cards from it, and vendors the ak-ui design foundation (tokens, effects module, Oswald woff2) into `public/ui/`.
- `scripts/sync.mjs <id>` — pull a locally built tool into `public/` (copies the app dir, injects `/ui/` references, uploads `r2/` to the bound bucket, incremental via a per-tool manifest object). Every tool goes through this path; nothing is built during the hub build.
- `docs/design.md` — the normative design language (ak-ui, system intensity, dark-first) for every page under this domain, including tool sub-apps.
- `deploy/pptx2pdf.sh <tool-repo>` — deploy the pptx tool: verify the local nix build, copy `result/dist` into `public/t/pptx`, upload `result/r2` to the main bucket under `pptx/lo/`, then `wrangler deploy`.
- `~/software/APILedger` — APILedger source (separate repo). `nix build .#web` produces `result-web/` (WASM + web UI), synced as the `apiledger` tool. Cloud history is stored per user in D1 (`ledger_sources`, `ledger_records`).
- Admin frontend lives in its own repo (`~/software/tools-admin`), synced in as the `admin` tool; it must follow `docs/design.md` — the committed `public/admin/` snapshot is restyled here only as a reference.

## Local development

Dev toolchain comes from the flake (`direnv allow`, or enter manually with `nix develop`) — the host system needs only Nix and direnv:

```bash
nix develop -c npm install
cp .dev.vars.example .dev.vars          # set BOOTSTRAP_TOKEN; omit Turnstile keys to skip captcha locally
npx wrangler d1 execute tools-site --local --file schema.sql
npm run build
node scripts/sync.mjs admin
node scripts/sync.mjs pptx --local      # needs a fresh ~/Documents/temp#lo-wasm-dist build
node scripts/sync.mjs apiledger         # needs ~/software/APILedger/result-web
npm run dev
```

Create the first admin while the users table is empty:

```bash
curl -X POST http://127.0.0.1:8787/api/auth/bootstrap \
  -H 'Content-Type: application/json' -H 'X-Requested-With: curl' \
  -d '{"token":"<BOOTSTRAP_TOKEN>","username":"admin","password":"<password>"}'
```

pptx engine rebuild — the sync refuses a stale `result` layout:

```bash
LO_WASM_ARTIFACTS=~/lo-src/build-wasm/workdir/installation/LibreOffice/emscripten \
  nix build --impure ~/Documents/temp#lo-wasm-dist
```

apiledger web rebuild:

```bash
cd temp/apiledger
nix build .#web --out-link result-web
cd ../..
node scripts/sync.mjs apiledger
```

## Deploy (Cloudflare Workers Builds)

Every sub-tool is built locally, synced into `public/` with `scripts/sync.mjs`, and committed. Cloudflare Workers Builds only builds and deploys the hub itself (`npm ci && npm run build`, then `wrangler deploy`); no tool is compiled there. `scripts/build.mjs` fails if a registered tool has no synced `public/<route>/index.html`.

Applications deploy through their own script: `bash deploy/<application>.sh <source-repo>` (`pptx2pdf.sh`, `apiledger.sh`). Each script builds, validates, syncs, regenerates hub artifacts, and deploys.

1. Push this repo to GitHub (commit everything including `package-lock.json` and `public/`; `.dev.vars` is gitignored).
2. Apply the schema to the remote D1 database (first deploy and after schema changes): `npx wrangler d1 execute tools-site --remote --file schema.sql`. If `ledger_records` already exists from an earlier build, add the currency column once: `ALTER TABLE ledger_records ADD COLUMN currency TEXT NOT NULL DEFAULT '';`.
3. Dashboard: Workers & Pages → Create → Worker → connect the repo. Name it `tools-site` (must match `wrangler.jsonc`), root directory `/`, build command `npm ci && npm run build`, deploy command `npx wrangler deploy`. The D1/R2 bindings are read from `wrangler.jsonc` at deploy time.
4. Turnstile (required): dashboard → Turnstile → create a widget for the domain, then in the Worker's Settings → Variables and Secrets add `TURNSTILE_SITE_KEY` (Var) and `TURNSTILE_SECRET_KEY` (Secret) with the real values. Keep both out of `wrangler.jsonc` and `.dev.vars` entirely — a `vars` block or empty entry in config would overwrite the dashboard values on every deploy. While `TURNSTILE_SECRET_KEY` is absent the Worker skips verification with a warning log (this is how local dev runs).
5. Dashboard → the Worker → Settings → Variables and Secrets → add `BOOTSTRAP_TOKEN` (type: secret, random value).
6. After the first build deploys, create the first admin, then delete the `BOOTSTRAP_TOKEN` secret:

```bash
curl -X POST https://<domain>/api/auth/bootstrap \
  -H 'Content-Type: application/json' -H 'X-Requested-With: curl' \
  -d '{"token":"<BOOTSTRAP_TOKEN>","username":"<username>","password":"<password>"}'
```

7. pptx (local build): rebuild the nix dist in `~/Documents/temp` (`LO_WASM_ARTIFACTS=... nix build --impure .#lo-wasm-dist`), then `nix develop -c bash deploy/pptx2pdf.sh ~/Documents/temp`. The script checks the Wrangler login, refuses a stale `result/` (missing `/ui/` links or `V = 'dev'`), copies `result/dist` into `public/t/pptx` (excluding `_headers` and `worker/`), uploads `result/r2` to `tools-site/pptx/lo/` only when the engine changed, and runs `wrangler deploy`. Commit the copied `public/t/pptx/` afterwards so the repo matches production.
8. apiledger (local build + deploy): `bash deploy/apiledger.sh ~/software/APILedger`. The script builds `.#web`, validates the bundle, syncs it into `public/t/apiledger`, regenerates the hub artifacts, and runs `wrangler deploy`. Commit `public/t/apiledger/`, `public/index.html`, and `src/routes.gen.ts` afterwards.
9. If the only admin ever forgets their password, reset it offline (no server endpoint exists for this): `nix develop -c node scripts/set-password.mjs <username> <new-password> --exec` (prints SQL without `--exec`; `--local` targets the dev database).
10. Optional: Cloudflare Access with a bypass application on `/` and a protected application on `/admin` (allow only yourself).

## License

This project is licensed under the **GNU General Public License v3.0**. See the [LICENSE](LICENSE) file for the full license text.

