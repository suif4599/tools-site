# Suif4599's Tools Site

Personal tools hub on a single Cloudflare Worker: Static Assets + R2 + D1, session auth (Turnstile), no open registration. Tools mount as subpaths (`/t/<tool>/`). Tools without server-side storage (`public = true` in tools.toml, e.g. pptx) are open to everyone; the account system exists for storage-backed tools and admin. The admin app mounts at `/admin/` with all of its APIs under `/admin/api/*`, so a single Cloudflare Access rule on `/admin/*` covers both the page and its API (pair it with a bypass rule on `/`).

## Layout

- `src/` — Worker: auth (`/api/auth/*`), admin API (`/admin/api/*`), R2 serving with brotli negotiation (`/t/pptx/lo/*`); `run_worker_first` routes `/t/*`, `/api/*` and `/admin/*` through the Worker, which gates non-public tools and admin, and passes public tools through.
- `public/` — deployed assets: `/ui/` design system, login, index, `t/<tool>/` and `admin/` app copies produced by `scripts/sync.mjs`.
- `tools.toml` — the tool registry; `scripts/build.mjs` derives `public/_headers`, `src/routes.gen.ts` and the index cards from it, and vendors the ak-ui design foundation (tokens, effects module, Oswald woff2) into `public/ui/`.
- `scripts/sync.mjs <id>` — pull a locally built tool into `public/` (copies the app dir, injects `/ui/` references, uploads `r2/` to the bound bucket, incremental via a per-tool manifest object).
- `docs/design.md` — the normative design language (ak-ui, system intensity, dark-first) for every page under this domain, including tool sub-apps.
- `deploy/pptx2pdf.sh <tool-repo>` — deploy the pptx tool: verify the local nix build, copy `result/dist` into `public/t/pptx`, upload `result/r2` to the main bucket under `pptx/lo/`, then `wrangler deploy`.
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

## Deploy (Cloudflare Workers Builds)

All routine deploys build and deploy in the cloud from GitHub; the only local steps are the heavy ones — the pptx engine (nix build + R2 upload) and `git push`. Nothing on Cloudflare ever builds the engine.

1. Push this repo to GitHub (commit everything including `package-lock.json` and `public/`; `.dev.vars` is gitignored).
2. Dashboard: Workers & Pages → Create → Worker → connect the repo. Name it `tools-site` (must match `wrangler.jsonc`), root directory `/`, build command `npm ci && npm run build`, deploy command `npx wrangler deploy`. The D1/R2 bindings are read from `wrangler.jsonc` at deploy time.
3. Turnstile (required): dashboard → Turnstile → create a widget for the domain, then in the Worker's Settings → Variables and Secrets add `TURNSTILE_SITE_KEY` (Var) and `TURNSTILE_SECRET_KEY` (Secret) with the real values. Keep both out of `wrangler.jsonc` and `.dev.vars` entirely — a `vars` block or empty entry in config would overwrite the dashboard values on every deploy. While `TURNSTILE_SECRET_KEY` is absent the Worker skips verification with a warning log (this is how local dev runs).
4. Dashboard → the Worker → Settings → Variables and Secrets → add `BOOTSTRAP_TOKEN` (type: secret, random value).
5. After the first build deploys, create the first admin, then delete the `BOOTSTRAP_TOKEN` secret:

```bash
curl -X POST https://<domain>/api/auth/bootstrap \
  -H 'Content-Type: application/json' -H 'X-Requested-With: curl' \
  -d '{"token":"<BOOTSTRAP_TOKEN>","username":"<username>","password":"<password>"}'
```

6. pptx, local only: rebuild the nix dist in `~/Documents/temp` (`LO_WASM_ARTIFACTS=... nix build --impure .#lo-wasm-dist`), then `nix develop -c bash deploy/pptx2pdf.sh ~/Documents/temp`. The script checks the Wrangler login, refuses a stale `result/` (missing `/ui/` links or `V = 'dev'`), copies `result/dist` into `public/t/pptx` (excluding `_headers` and `worker/`), uploads `result/r2` to `tools-site/pptx/lo/` only when the engine changed, and runs `wrangler deploy`. Commit the copied `public/t/pptx/` afterwards so the repo matches production.
7. If the only admin ever forgets their password, reset it offline (no server endpoint exists for this): `nix develop -c node scripts/set-password.mjs <username> <new-password> --exec` (prints SQL without `--exec`; `--local` targets the dev database).
8. Optional: Cloudflare Access with a bypass application on `/` and a protected application on `/admin` (allow only yourself).

## License

This project is licensed under the **GNU General Public License v3.0**. See the [LICENSE](LICENSE) file for the full license text.

