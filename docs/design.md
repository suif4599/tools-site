# tools-site design language

This site follows the [ak-ui](https://ak-ui.yyj.moe) design language at **system** intensity: layered neutral surfaces, asymmetric emphasis, clipped geometry, dense but legible metadata, functional signal colors, and decisive interaction feedback. The look is inspired by the flat, industrial graphic design of the Arknights official website (Hypergryph); no game asset, logo, or artwork is used or imitated — only layout principles, hierarchy, geometry, and color discipline.

Dark canvas is the default theme. A light theme exists as a secondary mapping (`data-theme="light"` on `<html>`), toggled from the topbar and persisted in `localStorage`.

This document is normative for every page served under this domain, including tool sub-apps synced from external repositories. When a tool's own UI conflicts with this document, this document wins.

## Token contract

The ak-ui CSS core is vendored as `public/ui/ak-ui.css` at build time and loaded on every page before the site layers. Its decorated primitives — above all `.ak-command` (inset hairline frame, bottom signal bar, corner badge, watermark layer, hover brightness + lift) — are the visual vocabulary for cards and panels; site CSS only re-skins them with tokens.

All styling decisions flow through CSS custom properties. `public/ui/tokens.css` imports the vendored ak-ui foundation (`public/ui/ak-tokens.css`, copied from `@yunyoujun/ak-ui` at build time) and maps it to the site theme. Never hard-code a repeated color, spacing, timing, or cut size in page CSS.

| Role | Token | Site usage |
| --- | --- | --- |
| Page canvas | `--ak-surface-canvas` | Body background, input background (inset look) |
| Panel | `--ak-surface-panel` | Cards, topbar, form panels |
| Quiet panel | `--ak-surface-muted` | Default button fill, hover fills |
| Raised panel | `--ak-surface-raised` | Button hover fill |
| Inverse surface | `--ak-surface-inverse` | Unused so far; reserved for emphasis blocks |
| Primary / secondary text | `--ak-text-primary` / `--ak-text-secondary` | Body copy / metadata, labels |
| Information (cyan) | `--ak-signal-info` | Links, navigation, focus of inputs, hover emphasis |
| Action (yellow) | `--ak-signal-action` | Primary CTA buttons, global focus ring |
| Concentrated accent | `--ak-signal-accent` | Reserved; do not use without adding a real semantic role |
| Success / danger | `--ak-signal-success` / `--ak-signal-danger` | Success text / destructive actions and errors |
| Fonts | `--ak-font-sans` / `--ak-font-mono` / `--ak-font-command` | Body / identifiers & data / display & brand wordmark |
| Spacing | `--ak-space-1` … `--ak-space-6` | All padding/margin/gap rhythm |
| Geometry | `--ak-cut-sm/md/lg`, `--ak-radius-subtle`, `--ak-line-hairline`, `--ak-line-strong` | Clipped corners, subtle radii, hairline rules |
| Motion | `--ak-motion-fast/base/slow`, `--ak-ease-standard` | Control feedback timing |
| Focus | `--ak-focus-color/width/offset` | Visible keyboard focus (never clipped by `clip-path`) |

Typography roles: Oswald (self-hosted, latin subset, weights 500/600) is the display/command face for brand wordmarks and page titles, always uppercase with wide letter-spacing. Body text uses `--ak-font-sans`; identifiers, counts, and timestamps use `--ak-font-mono`. The site is English-only — no i18n layer and no bilingual label pattern.

Color is a signal, not decoration: cyan = information/navigation, yellow = the single primary action per view, red = danger, green = success. Never use color as the only state indicator — pair it with a label, border, or geometry change.

## Page layout

Every page is: `tool-shell` topbar → `main.page` (max-width 1100px, centered, `--ak-space-6` vertical / `--ak-space-5` horizontal padding) → optional `footer.site-foot`.

- Topbar (`tool-shell`, sticky, 52px): brand wordmark with cyan square marker, a cyan signal line fading along the bottom edge, page title in uppercase mono-style secondary, right-aligned session controls (user, sign in/out, theme toggle).
- Hero: `.kicker` (mono, cyan, wide tracking, preceded by an 8px cyan square) + `.display` title (Oswald, clamp-sized, uppercase) + `.hint` or `.hero-meta` line (real metadata only). The hero carries a 45° hatch band on the left masked to fade out, and a cyan-to-transparent hairline rule along its bottom edge.
- Footer: hairline top rule, mono uppercase microcopy — `Tools` (link to the site repository) · `Client-Only` · a page-level link (`About` on the hub, `Index` elsewhere). The About page (`/about`, `public/about.html`) is the canonical place for site information: what the site is, accounts (no sign-up; sign-in only enables cloud persistence for tools that need it), design credits, source and license. It renders the same card grid as the tool listing, with `.info-card` blocks (mono index, uppercase title, secondary prose, mono cyan fact line pinned to the card foot). Information pages must use card or list patterns from this system — never plain prose headings and paragraphs.
- Breakpoints: cards reflow via `auto-fill minmax(250px, 1fr)`; below 600px the topbar hides the page title and tightens padding. No horizontal scrolling at 390px.
- Touch targets are at least 44×44 CSS px everywhere, including dense table action buttons.

## Components

Shared component styles live in `public/ui/base.css` (loaded by every page, including tool sub-apps); hub-only styles in `public/ui/site.css`.

- **Command card** (`a.card.ak-command` for tools, generated by `scripts/build.mjs`; `.info-card.ak-command` on the About page): the ak-ui command panel re-skinned with the site palette — inset hairline frame, cyan signal bar that sweeps in from the left on hover/focus, mono index badge in the top-right corner, an oversized faint id/category watermark behind the content, and a top-edge sheen. Hover adds brightness, a 0.18cqw lift, and the signal bar; focus uses an inset cyan ring (kept inside the clipped corner). Card text: uppercase Oswald label, mono uppercase meta line. Every card carries one real fact (index, id, category, or status), never decorative telemetry.
- **Buttons**: rectangular (`--ak-radius-subtle`), 44px min height. Variants: default (graphite fill), `.primary` (action yellow, dark text — one per view), `.secondary` (transparent, hairline border), `.danger` (red outline). Hover lifts by 1px and shifts fill; disabled drops opacity and freezes motion. Focus ring uses `--ak-focus-*` and is never clipped — buttons carry no `clip-path`.
- **Inputs/selects**: canvas background (inset against panels), hairline border, 44px height. Focus: cyan border + softened cyan ring.
- **Labels**: small, letter-spaced, secondary color.
- **Tables**: uppercase letter-spaced header row over a 2px rule, hairline row rules, row hover tint.
- **Badges** (`.badge`): mono microtext with a 5px clipped corner; `.admin` tinted cyan, `.off` tinted red — always with distinct text, never color alone.
- **Message/error** (`.msg`): red 4px left rule + tinted panel.
- **Panels** (`.panel`): panel surface, hairline border, one clipped corner (`--ak-cut-lg`) — used for focused single-form views (login).

## Motion

Control feedback runs on `--ak-motion-fast` (120ms) CSS transitions. The only staged entrance is the home tool-grid stagger (ak-ui `createEntrance`, 200ms each, 70ms apart, 16px displacement, in `public/ui/home.js`). All motion respects `prefers-reduced-motion` (the entrance controller skips playback; content is fully visible without JavaScript). No particles, parallax, or ambient loops at system intensity.

## Mandatory constraints for tool sub-pages

Every tool app mounted under this hub (synced by `scripts/sync.mjs`) **must** follow these rules. Sync injects the shared head links and `tool-shell` automatically; the tool's own markup and page CSS are its responsibility.

1. Include, in order, `//ui/tokens.css`, `/ui/base.css`, `/ui/shell.css` (injected by sync) plus the tool's own stylesheet **after** them. The tool's own `<head>` stylesheet may keep its build-hashed URL; sync inserts the shared links before it.
2. Render `<tool-shell title="…">` as the first element of `<body>` (injected by sync). Do not build another global topbar, and do not hide or restyle it beyond what `shell.css` provides.
3. Tool content lives inside `<main class="page">` and uses the shared page primitives from `base.css` — `.hero` + `.kicker` + `.display` + `.hero-meta` for the header, `.panel` for state blocks (font gate, progress, result), `.section-title` for sections. Do not re-create these with page-local CSS.
4. Style every control through the shared classes in `base.css` (`button` + variants, `input`/`select`, `label`, `.msg`, `table`, `.badge`) or through `--ak-*` tokens. No hard-coded colors, spacings, radii, font sizes, or timing values in tool CSS; no new hex literals.
5. CSP is `style-src 'self'`: external stylesheets only. No inline `style=` attributes, no JS-injected `<style>` tags, no external font/CDN requests (`font-src 'self'`).
6. Loading states must reflect real progress (bytes, tasks, or the engine's own lifecycle); never animate a decorative counter to fake readiness. Errors use `.msg` semantics with text, not color alone.
7. Keep the signal-color semantics (cyan info / yellow primary action / red danger / green success) and use yellow for at most one primary action per view.
8. Respect `prefers-reduced-motion`; the page must be fully usable with JavaScript disabled or failed except for the tool's core function itself.
9. One strong geometric gesture per component: prefer at most a single clipped corner on major surfaces; buttons stay rectangular; do not clip, skew, or number every element.
10. Do not copy or imitate game assets, logos, screenshots, or artwork. UI copy is English-only; do not introduce other languages.

The pptx tool (synced from `~/Documents/temp/result`) and the admin app (source in `~/software/tools-admin`; a snapshot is committed under `public/admin/`) are both governed by this document. Restyling the committed admin snapshot here does not update the tools-admin source; adopt the same markup/classes there before its next sync.

## Fonts

Oswald latin subset (500, 600) is vendored at build time from `@fontsource/oswald` into `public/ui/fonts/` and declared in `base.css`. Chinese text always falls back to the system sans stack; do not load Chinese webfonts.

## Verification

Per change: `npm run build` (regenerates `_headers`, `routes.gen.ts`, index cards, vendored tokens/effects/fonts), `npm run check`, then a real browser pass at desktop and 390px — keyboard focus visible and unclipped, hover/active/disabled states, theme toggle dark↔light, no CSP console violations, no horizontal overflow.
