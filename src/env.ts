export interface Env {
  DB: D1Database;
  TOOLS_R2: R2Bucket;
  ASSETS: Fetcher;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  BOOTSTRAP_TOKEN?: string;
}
