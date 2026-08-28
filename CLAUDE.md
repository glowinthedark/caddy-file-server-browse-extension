# CLAUDE.md — caddy-file-server-browse-extension

Single-artifact project: a **drop-in replacement for Caddy's `file_server browse` template**.
`browse.html` (1018 lines, 58 KB) is the entire product. Everything else is docs/screenshots.

```
browse.html                  THE product: Go html/template + inline CSS + inline JS + SVG sprite
css/atelier-estuary-light.css  LEGACY, unused since the rewrite (no CDN assets remain)
sidecar/heic.js  heic.worker.js  OPTIONAL, never loaded unless installed under the site root (see HEIC sidecar)
img/*.png                    README screenshots only
README.md  LICENSE(Apache-2.0)  .claude/CLAUDE.md(engineering rules)
```

No build step, no package manager, no CI. Edit → reload browser. Test recipe: see **Verification**.

## How Caddy consumes this file

`Caddyfile: file_server { browse /path/browse.html }`

Upstream source of truth (read-only reference, do NOT edit):
`/Users/bio/projects/go/src/github.com/caddyserver/caddy/modules/caddyhttp/fileserver/`
- `browse.html` — upstream default template (1311 lines) to diff against
- `browsetplcontext.go` — template data contract (`browseTemplateContext`, `fileInfo`)
- `browse.go:315 makeBrowseTemplate` — **`ParseFiles` on every directory request; zero caching.**
  → template byte size is a per-request CPU/alloc cost. Self-containment (58 KB) buys zero-RTT
  rendering and a strict CSP at the cost of ~58 KB parsed per directory hit. Accepted tradeoff.
- `browse.go:150` — `Accept: application/json` / `text/plain` bypass the template entirely.
- `browse.go:131-138` — **a stale listing survives template edits.** `Last-Modified` is the
  *directory's* mtime and the `If-Modified-Since` 304 is returned **before** the template runs, so
  editing `browse.html` cannot invalidate a cached page and no `.RespHeader.Set` can influence it.
  Verified: edit the template, re-request with the old validator → `304`. **Always hard-reload
  (⌘⇧R / disable cache) after editing, per directory** — otherwise you are debugging the old file.
- `browse.go:222 defaultDirEntryLimit = 10000` — a listing can legitimately be 10k rows. All
  per-row JS/CSS must be O(n) with small constants; never O(n) DOM reads per keystroke.

Verified against Caddy master @ `64b64c61` (2026-08-08), go 1.25.1. **No version drift:** no upstream
field/method was removed or renamed, and all 7 upstream deltas are now adopted (see History).

## Template data contract (verified in browsetplcontext.go)

Root (`.`): `Name Path CanGoUp Items Offset Limit NumDirs NumFiles TotalFileSize
TotalFileSizeFollowingSymlinks Sort Order Layout` + methods `Breadcrumbs`
`HumanTotalFileSize` `HumanTotalFileSizeFollowingSymlinks`.
Also `.RespHeader.Set` (set response headers from the template) and `.Req`.

Item (`fileInfo`): `Name Size URL ModTime Mode IsDir IsSymlink SymlinkPath Tpl`
+ methods `HasExt ".a" ".b"` (case-insensitive suffix match) `HumanSize` `HumanModTime "layout"`.
`.Tpl` back-pointer lets nested templates branch on layout (`eq .Tpl.Layout "grid"`).

- `fileInfo.URL` is **already** `url.URL{Path:"./"+name}.String()` → pre-escaped.
  Use `{{html .URL}}` for hrefs/srcs. Never `pathEscape` it again (double-escapes `%`).
- `Breadcrumbs()[0].Text` is **already `"/"`** (root), so the template emits `<span class="sep">/</span>`
  only for `gt $i 1` — separating on `ne $i 0` renders a double leading slash (`//Users/bio`).
- `fileInfo.ModTime` is stored `.UTC()` — so `{{.HumanModTime "2006-01-02T15:04:05Z"}}` with a
  literal `Z` is correct. (An earlier audit wrongly called this a timezone bug; it is not.)

Useful funcs: `pathEscape` (= `url.PathEscape`), `html`, plus sprig (`uuidv4`, `quote`, `print`,
`printf`, `add`, `sub`, `max`).

Query params Caddy honors: `sort` (`name|namedirfirst|size|time`), `order` (`asc|desc`),
`layout` (`grid|list`), `limit`, `offset`. **`filter` is client-side only — Caddy ignores it.**

**`namedirfirst` only groups under `order=asc`**: Caddy sorts then reverses the *whole* slice for
`desc`, so `namedirfirst&order=desc` puts folders **last**. The "Folders first" chip must therefore
hard-code `order=asc` on its enable link and may only read as on when
`$grp := and (eq .Sort "namedirfirst") (eq .Order "asc")` — carrying `.Order` through made clicking
it send folders to the bottom.

## Architecture (rewritten 2026-08-09/10)

**Self-contained, zero CDN, CSP-enforced.** No network dependency of any kind.

- **CSP**: `{{- $nonce := uuidv4}}` / `{{- $n := print "nonce=" (quote $nonce)}}`, emitted via
  `.RespHeader.Set` when `$enableCsp` is true (top of file). `default-src 'none'` + nonce'd
  `style-src`/`script-src`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
  → Consequence: **no `style="…"` attributes and no inline handlers anywhere.** Per-element values
  (e.g. the size bar `--w`) must be set through CSSOM (`el.style.setProperty`), which CSP allows.
- **SVG sprite**: one hidden `<div class="sprite">` of `<g id="…">` at `<body>` start; rows emit
  `<use href="#{{template "icon" .}}">` (plain `href`, not `xlink:href`). The `icon` template returns
  an **id string**, not markup. Largest size/parse win over upstream — keep it.
  - **Paint must be declared on the referencing `<svg class="ic">`, in CSS.** The sprite root's
    `fill="none" stroke="currentColor"` presentation attributes are *not* ancestors of the cloned
    `<use>` shadow content, so anything relying on them inherits the default `fill:black` — that is
    what once made every icon a solid black square. `.ic{fill:none;stroke:currentColor;stroke-width:2;…}`
    inherits into the shadow tree, and a path's own presentation attribute (the folder's
    `fill="#ffb900"`) still beats the inherited value. New `<g>`s therefore need **no** paint
    attributes, and must not carry a full-canvas `M0 0h24v24H0z` path (all 35 were removed).
- **Quantized φ design system** (recalibrated 2026-08-24): every token defined once via CSS
  `light-dark()`. **Layout quantum q = 2px (.125rem): every space/radius/control/icon token is an
  integer multiple of it**, so 1px hairlines and 2px icon strokes land on whole device pixels at
  1x/2x/3x. Do not "restore" the old fractional φ-powers — they rendered at 6.4/10.4/16.8/27.2/71.2px
  and bottomed the type scale out at an illegible **9.888px**.
  - **Space + radii — Fibonacci×2** (`--s1..7` = 4 6 10 16 26 42 68; `--r1..3` = 6 10 16). Fibonacci
    is the integer sequence whose successive ratio *is* φ, and consecutive terms sum to the next —
    which is what makes the concentric-radius law hold **identically**, not by luck:
    `r2 = r1 + s1` (10 = 6+4), `r3 = r2 + s2` (16 = 10+6). The grid card relies on this: `.entry a`
    has `--r2` + `--s1` padding around a `--r1` thumbnail, so `.entry .name`/`.entry .m` must carry
    **no** padding of their own (adding it doubles the inset to 8px and the text stops aligning
    with the thumbnail edge).
  - **Type — φ at display sizes, damped (~1.14) at UI sizes** (`--f-2..3` = 12 14 16 20 26 42).
    The top (16→26→42) is φ; the bottom is damped because retinal acuity is a hard floor.
    **Nothing renders below 12px.** `--lh 1.618` is prose-only; `--lh-ui 1.5` (16×1.5 = 24, integer)
    is for rows/labels/chips; `--lh-tight 1.272`.
  - **Control heights — a separate ergonomic ladder** (`--c1..3` = 28 36 44 ≈ 44÷φⁿ). Mixing control
    height into the spacing scale is what made the chips 32.9px, under every touch-target guideline.
    44 is the Apple HIG / WCAG 2.5.5 target and is the list row height; `@media (pointer:coarse)`
    promotes chips and `#filter` from `--c2` to `--c3`.
  - **Icon sizes are locked to the 24-unit SVG viewBox** (`--i1..4` = 16 20 24 48 — the only permitted
    values). A `stroke-width:2` then rasterizes at 1.33/1.67/2/4px, i.e. whole device pixels at 2x;
    the old `22px` glyph put every stroke at 1.833px, permanently soft.
  - **Measure** `--read:68ch` (was ~82ch, over the 45-75ch optimum); `--wrap 79.5rem`; `--tile 13rem`.
  - **`.chips` rail**: the sort/layout chips live in their own `<div class="chips">` inside `.tools`
    so that under `@media (max-width:40rem)` they become a single `flex-wrap:nowrap;overflow-x:auto`
    rail (scrollbar hidden, `.v-track` idiom) while `.tools` stacks column-wise with a full-width
    `#filter`. The wrapper is structural — chips cannot be a nested scroller without it; no JS
    selects `.tools` or depends on its child structure.
  - Grid tiles keep `aspect-ratio: var(--phi)`. Theme override flips `color-scheme` through
    `data-theme` on `<html>`, set pre-paint by a tiny nonce'd script from `localStorage["cfs-theme"]`
    (no flash). Do not add a second dark-mode mechanism.
- **Layout**: breadcrumb header → sticky `.bar` toolbar (stats, `#filter`, sort chips, folders-first,
  list/grid, theme, help) → `main.panel` (empty state | grid | 3-column table) → `.pager` →
  `.dock` audio player → `#viewer` dialog → `#keys` dialog → one IIFE.
- **Sort/order/layout are real `<a href="?sort=…">` links** (work with JS off); `$ord`/`$lay`
  template vars compute the toggle target. Grid gets the same controls as list.
- **Viewer = native `<dialog>` + CSS scroll-snap carousel.** Swipe/momentum/pinch-zoom come free
  from the browser (`scroll-snap-type:x mandatory`, `overscroll-behavior:contain`,
  `scroll-snap-stop:always`); arrow buttons are hidden under
  `@media (pointer:coarse)`. Index changes settle on `scrollend` (debounced `scroll` fallback).
  Only a 3-slide window is in the DOM (idx±1) with ±2 `new Image()` prefetch.
  - `freeze()`/`thaw()`/`thawSoon()` guard repositioning: snap is disabled while `scrollLeft` is
    set, then re-enabled on double-rAF **plus an 80 ms timer** — rAF alone is throttled in
    background tabs/headless and would leave `lock` stuck true (swipe stops updating the index).
  - `teardown()` runs synchronously from `closeViewer()` **and** from `cancel`/`close` listeners;
    the `close` listener no-ops when `dlg.open` is true again (a queued close event must not wipe a
    reopened viewer). Media teardown is `pause(); removeAttribute('src'); load()` + blob revocation.
  - **Vertical keys belong to the doc, not the carousel.** `scroller()` returns the active slide's
    `.v-doc` (or the slide itself, e.g. a zoomed image) when it overflows by >8 px; Up/Down/PageUp/
    PageDown/Home/End/Space then scroll it and only fall through to `go()`/slide jumps when nothing
    overflows. Nothing inside the dialog is focused, so the browser will not scroll it for us.
  - **No Fullscreen API anywhere — do not reintroduce it.** A modal `<dialog>` is already a
    100vw/100dvh top-layer box, so `dlg.requestFullscreen()` is a visual no-op; and
    `documentElement.requestFullscreen()` appends the *root* to the top layer **after** the dialog,
    which paints in insertion order → the toolbar and file listing end up above the media (the
    reported z-order inversion). The button (`.v-fs`, key `f`) instead toggles chrome off:
    - one idle timer drives everything: `showUI()` clears `.hide-ui` and re-arms
      (`UI_IDLE` 2500 ms, 1200 ms while expanded); `hideUI()` sets it. Activity = `pointermove`,
      `pointerdown`, or any keydown other than Escape inside the dialog.
    - `setImm(on)` toggles `#viewer.imm` (padding/radius/shadow/frame removed → edge-to-edge) and
      hides the UI at once; expanded is *not* a separate visibility state, so there is no
      unreachable configuration — a pointer move always brings the bar back.
    - hovering `.v-bar` pins it (`barHot`); `pointerleave` restarts the countdown.
    - `#viewer.hide-ui .v-bar` needs `pointer-events:none` **on the children too**, because
      `.v-bar>*{pointer-events:auto}` would otherwise keep an invisible close/download button
      clickable.
    - Esc is two-step via the cancelable `cancel` event: while `imm`, `e.preventDefault()` +
      `setImm(false)` restores the interface without losing your place; a second Esc closes.
    - `openAt()` ends with `if(imm)hideUI();else showUI();`; `closeViewer()` clears the timer and
      removes `.hide-ui`.
  - **`touch-action` is a budget spent from the top down — restrictions are ADDITIVE and a
    descendant can never re-enable an axis an ancestor removed.** `touch-action:pan-x pinch-zoom`
    used to sit on `.v-track`, which made every doc/code/iframe preview unscrollable by finger
    (keyboard-only ⇒ desktop-only). `.v-track` now declares **nothing** (it overflows horizontally
    only, so the browser's default is already correct) and each slide owns its axes:
    - `.v-slide{touch-action:pan-x pinch-zoom}` — media. The browser has no vertical axis to claim,
      so it never `pointercancel`s us mid-gesture: horizontal stays 100 % native (finger-following,
      momentum, rubber-band, one-slide-per-flick), vertical is ours for drag-to-dismiss.
    - `.v-slide.scrolls{touch-action:auto}` — native vertical scrolling. Added in `slide()` for
      `.v-doc` and iframe slides, and toggled on images together with `.zoom` (a zoomed image
      overflows, so it hands both axes back). One predictable rule: **content that scrolls, scrolls;
      content that does not, dismisses.**
  - **`overscroll-behavior:contain` swallows a pan the scroller cannot consume — it does NOT chain
    it to the ancestor. This is the second, independent reason a finger could not page**, and it
    survived the `touch-action` fix (the browser started the pan — `pointercancel` fired, 14
    touchmoves arrived — then dropped it: **0 scroll events on `.v-track`, `scrollLeft` stuck at 0**,
    measured over CDP). `.v-slide` was `overflow:auto`, i.e. a scroll container with no horizontal
    overflow to spend the gesture on, and `.v-doc` had the same two-axis `contain`. Rules now:
    - `.v-slide{overflow:clip}` — **`clip`, not `hidden`**: it creates no scroll container at all, so
      the pan chains straight to the track. Media never needs to scroll (`max-width/height:100%`).
    - `.v-slide.scrolls{overflow:auto;overscroll-behavior-y:contain}` and
      `.v-doc{overscroll-behavior-y:contain}` — **y-only**. Vertical stays contained; horizontal is
      left free, so swiping to the next file works from a markdown/code preview exactly as from an
      image. Two-axis `contain` on either one silently kills paging on doc slides.
    - `.v-track` keeps two-axis `contain`: that is the boundary where chaining *should* stop, so a
      swipe past the first/last slide never reaches the document (no pull-to-refresh, no back-swipe).
    Whenever a gesture "does nothing", check the whole ancestor chain for both `touch-action` **and**
    `overscroll-behavior` — the two failure modes look identical from the outside.
  - **No synthetic left/right swipe detection — deliberately.** A `swiped-events`-style touchend
    threshold handler (see `tmp/swiped-events.js`) could only *replace* the snap track's native
    paging with a binary guess, and its `startEl !== e.target` bail breaks on our re-mounted slides.
    Only the vertical axis is scripted.
  - **Drag-to-dismiss** (pointerdown/move/up/cancel on `track`, all `{passive:true}` except `up`):
    `DRAG_MIN=10` px, then the **first movement past the threshold locks the axis for the whole
    gesture** (horizontal-dominant ⇒ `drag=null`, hand back to the pager), so a diagonal flick can
    never both page and dismiss. The transform/opacity go on the `img`/`video`, **never the slide**
    (it is the snap area); `.v-drag` supplies only the spring-back easing (values via CSSOM, CSP).
    Dismiss on distance **or** velocity (`>max(80,18vh)` or `>.5 px/ms && >40 px`), then a
    **`setTimeout(closeViewer,200)` — never `transitionend`**, which may never tick. Bails: a second
    finger (pinch), `.scrolls` slides, `visualViewport.scale>1.01`.
    `eatClick` swallows the click that tails a drag and **is reset in `openAt()`** along with
    `drag`/`tActive` — a dismissal arms it and then closes, and it otherwise ate the first tap of the
    next session.
  - **Chrome policy: `"touch"` is the only special `pointerType`** (`lastPT!=="touch"` /
    `e.pointerType!=="touch"`). Mouse and pen keep hover semantics — and so does any **synthetic**
    PointerEvent, whose `pointerType` is `""`; that polarity makes the safe default (controls stay
    reachable) the fallback. On touch:
    - a touch `pointerdown`/`pointermove` is the *start of a swipe*, so it never reveals the bar —
      revealing on it flashed the interface over the media on every single page.
    - the **tap toggles** `hide-ui` (touch has no hover, so the tap is the only "show me the
      controls" gesture; it must toggle or a dismissing tap would re-arm it). Taps on
      `a,button,video,audio,iframe,input,select,textarea,summary` pass through untouched.
    - **backdrop-tap-to-close is not wired on touch** — it collides with that toggle. Close via the
      button or a vertical flick. Mouse backdrop-click still closes.
    - finger paging (`scroll` while `tActive`) and a confirmed drag both call `hideUI()` immediately,
      instead of leaving the bar over the media for the rest of the idle timer.
    - `bar` `pointerdown` calls `showUI()`, so reaching for a second button never races the timer.
  - **`loadDoc()` is called only after the slide fragment is attached to the track** (`pend` array
    drained in `render()` after `appendChild`). Loading from the detached fragment let a
    cache-fast response hit the `!host.isConnected` guard, leaving "Loading…" forever.
- **Previews sanitize by construction**: code goes in via `textContent`; markdown is rendered by a
  DOM-building renderer (never `innerHTML`); URLs pass `safeUrl()` (scheme allowlist `https?:`,
  `mailto:`); `.html` files render in `<iframe sandbox="">`; SRT is converted to a VTT blob track.
- **Inline tokenizer** replaces highlight.js: `HL` regex fragments composed via `.source`,
  classes `c/s/n/k`, bailing over `HL_MAX=300000` chars.
- **Optional HEIC sidecar** (`sidecar/heic.js`, not loaded unless installed). Gate at the top of the
  template: `$heicJS` = the URL the browser fetches, `$heicFile` = that file's path **under the site
  root** (they differ only where the site rewrites URLs — `fileExists` resolves against
  `browse.go:194 Root: http.Dir(root)`, never against the template's own directory), and
  `$heic := and (ne $heicJS "") (fileExists $heicFile)`. When the file is absent the whole feature
  costs **one stat per listing**: `var HEIC_JS = ""` short-circuits every call site, no markup, no
  request, and the CSP header is byte-identical (` blob:` on `img-src` and ` 'wasm-unsafe-eval'` on
  `script-src` are appended through `$imgx`/`$scrx` only when the gate is true).
  - **Activation is error-driven, so Safari pays nothing**: the slide always emits a normal
    `<img src=HEIC>`; only its `onerror` sets `data-heic="1"` and calls `heicSwap()`. `chrome()`
    re-runs `heicSwap` for the current index so a neighbour that failed while off-screen decodes when
    it becomes active. States: `1` failed-native → `2` decoded → `3` no preview.
  - The adapter contract is exactly `window.CFSHeic.decode(url) -> Promise<Blob>`; `heic.js` pulls
    `libheif-bundle.js` (libheif-js, LGPL, **not** vendored here) from its own directory. The
    injected `<script>` carries `el.nonce = NONCE`, read once from `document.currentScript.nonce`
    — the **property**, not `getAttribute("nonce")`, which returns `""` under nonce hiding. A nonce
    authorizes an external `src` with no host allowlist; dynamic `import()` would not honor it.
  - **Decoding runs in a Worker (`sidecar/heic.worker.js`) — that is the whole performance story.**
    Measured on a 12 MP iPhone frame (4032×3024, headless, no GPU): fetch 2 ms, libheif container
    parse 5 ms, **`display()` (wasm decode + YUV→RGBA) 606 ms**, `putImageData` 14 ms, JPEG encode
    91 ms at full size / 35 ms scaled. The bundle already *is* the wasm build (md5-identical to
    `libheif-js/wasm-bundle`, wasm embedded as base64, `WebAssembly.Instance`) — there is no asm.js
    fallback to blame and no faster libheif build in that package, so the only lever is *where* the
    600 ms runs. On the main thread it froze scrolling, swiping and the close button; in the worker
    the page keeps a **9 ms max frame gap** through the whole decode.
    - `worker-src 'self'` (`$wrkx`) is the one extra CSP token this costs. **`script-src` needs no
      `'self'`**: a worker created from a *same-origin URL* does not inherit the document policy
      (only `blob:`/`data:` workers do), so `importScripts("libheif-bundle.js")` is unrestricted
      inside it. Verified live — adding `'self'` to `script-src` would let any uploaded `.js` under
      the site root be script-loaded, which on a file server is a real weakening. Don't.
    - `decode()` **resolves the URL against `location.href` before posting it** — the worker's base
      is its own directory, so a relative item href fetched there 404s (this was the failure).
    - Output is capped at `min(4096, max(2048, longestDevicePx × 2))` and encoded at q .85: 990 KB
      instead of 4.2 MB for detail no pixel receives, with 2× headroom left for zoom.
    - `Worker`/`OffscreenCanvas` missing, or the worker erroring, falls back to the identical inline
      pipeline (nonce'd `<script>` + `<canvas>`); verified by deleting `window.Worker`.
  - Output is a **blob URL assigned to the same `<img>`**, so zoom, drag-dismiss, `.zoom`/`.scrolls`
    and every `img` selector keep working untouched; the blob is revoked in `teardown()` via
    `img._blob`. Decodes are serialized on one promise chain with a 4-entry cache keyed by href — a
    12 MP frame is ~48 MB of RGBA and parallel decodes OOM the wasm heap.
  - **Popup only.** Grid thumbnails deliberately do not decode.
- **Video arrows are seek-with-bounds**: in the viewer, Left/Right seek ±5 s on a `<video>`, but
  Right at the end (`ended` or within `SEEK_EPS=.25` s of `duration`) and Left at the start page to
  the next/previous item instead — otherwise the key is a dead end at both extremes. Shift bypasses
  seeking. `duration` may be `NaN`/`Infinity` while metadata loads, hence the `isFinite` guards.
- **Type routing still lives in two places that must agree**: the Go `icon` template's `HasExt`
  lists and the JS `KINDS`/`kindOf` map. Any extension change touches both.
- **Perf**: `table-layout:fixed`, `content-visibility:auto` + `contain-intrinsic-size`, cached
  NFD-stripped lowercase filter index, `hidden` attribute toggled only on change, one shared
  `Intl.DateTimeFormat`, 12-entry bounded fetch cache, size bars via one gradient + `--w`.
- **State via URL**: `merge()` carries `CARRY = layout|filter|limit|sort|order` across navigation;
  `applyFilter` uses `history.replaceState`.
  - **`filter` is scoped to one directory** and is skipped unless `u.pathname===cur.pathname`. It is
    a view over the rows of the *current* listing, so it survives sort/order/layout chips and the
    pager but is dropped — from the applied state and from the query string — by folder links, the
    up-link and breadcrumbs. Carrying it re-filtered the new folder by a term meaningless there.
  - `clearFilter()` returns true only when it actually cleared something, so Escape stays a no-op
    otherwise. It is reachable **from any focus state**: the in-input branch handles Escape while
    `#filter` has focus (and blurs it), and the global branch handles it after focus has left — both
    dialogs `return` before that point, so their own Escape handling is untouched.

## History (what the rewrite fixed)

The pre-rewrite fork had, and no longer has: 5 CDN requests (highlight.js + 2 themes + atelier CSS +
**unpinned** `marked`) and therefore no CSP; DOM XSS via `innerHTML`/unsanitized `marked.parse`;
~15 correctness bugs (`lastScrollOffsetllY` typo, unescaped grid `img src`, `decodeURIComponent`
URIError on `%`, unescaped subtitle regex, `split('.')[0]` basename, `exitFullScreen`, ungated
keydown, filter on `keydown` that ignored grid, `NaN` size bars); keyboard-only gallery (unusable on
phones); leaked blob URLs and undismantled `<video>`; `transition: all`; dead CSS/JS. It also did not
adopt 7 upstream deltas (nonce'd CSP, `HumanTotalFileSize`, `SymlinkPath`, canonical link,
`.avif`/`.m4v`, grid sort controls, no `javascript:`/`onclick`) — all now present.

Post-rewrite fixes (2026-08-10), all documented above: the sticky cross-directory `filter` and dead
Escape; invisible-but-clickable `.v-bar` children under `hide-ui`; the ancestor `touch-action:pan-x`
that made every doc/code/iframe preview unscrollable on touch; `eatClick` leaking across viewer
sessions; the pointer-type polarity (only `"touch"` is special, so synthetic/unknown types get
the hover-safe default); and — found only once real touch input was driven over CDP — the
`overscroll-behavior:contain` on `.v-slide`/`.v-doc` that swallowed every horizontal pan, so **swipe
paging had never actually worked on a phone** in this fork or its ancestor.

## Conventions

Tabs for indentation, tabs inside `<style>`/`<script>` too. Go template actions use `{{- … }}`
trimming. `{{html .X}}` for text and for `.URL`; `pathEscape` only for values built from `.Name`.
Prefer `.URL` over `.Name` for hrefs/srcs. Keep the JS dependency-free, framework-free, ES5-shaped
(`var`, no classes) inside one IIFE. **Never** add a `style=` attribute or inline handler (CSP).

**Never run Prettier (or any HTML formatter) on `browse.html`** — `.prettierignore` now blocks it.
Its HTML parser does not know `{{ … }}`, so it reflows attribute values and (a) breaks Go string
literals across lines → `parsing browse template: … unterminated quoted string` at request time, and
(b) injects whitespace *inside* literals — `{{if eq .Sort "name"}}` became `{{if eq .Sort " name"}}`,
which parses fine and silently disables every sort chip and `aria-sort`, and
`{{template "icon" .}}` became `{{template " icon" .}}`, a missing-template error. Commit `bd38f2a`
shipped exactly this; `90725f9` was the last parseable revision and the repair was
`git show 90725f9:browse.html` + a re-applied semantic diff. Verify any edit with a bare
`text/template` parse (a 15-line Go program with a stub FuncMap) before reloading Caddy — the
template is only parsed on a directory request, so a syntax error surfaces as a 500 in the log, not
at load/reload time.

## Verification

No test suite ships in the repo. The scratchpad recipe used for the rewrite (recreate as needed):

1. **Render through real Caddy** — copy a clean tree (`git archive HEAD | tar -x`, since the local
   checkout may not compile) and drop an in-package test in `modules/caddyhttp/fileserver/` that
   builds `browseTemplateContext`s (list/grid/paged/empty) with `fileInfo{URL: url.URL{Path:"./"+name}.String()}`
   and asserts: nonce count, no `ZgotmplZ`, no `xlink:`, no `style="`, no `onclick=`, no
   `javascript:`, no `&amp;amp;`, symlink arrow, `#go-up`, grid `class="th"`, pager `offset=`.
2. **Parser fuzz** — extract the largest `<script>` body and run it against a minimal DOM shim;
   assert ~14 markdown cases plus pathological inputs (`` ``````…``, `**********`, `[[[[[`, `_a_a_`)
   under a 500 ms budget each. Catches regex `lastIndex` and fence-scanning blowups.
3. **Real browser E2E** — serve a fixture dir with a **threaded** HTTP server
   (`ThreadingHTTPServer`; a single-threaded one deadlocks behind media connections and produces
   phantom preview failures), inject a driver script into the rendered `index.html`, and run
   `chrome-headless-shell --dump-dom --virtual-time-budget=60000`, reporting results through
   `document.title`. The only working headless binary on this machine is Playwright's
   `~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell`
   — `Google Chrome for Testing.app` hangs forever under `--headless=new --dump-dom/--screenshot`.
   Same binary with `--screenshot=… --window-size=W,H` is the fastest way to check a *paint* bug
   (render a page per layout with `LAYOUT=`/`PATHV=` in the render test; add `data-theme="dark"`
   to `<html>` for the dark pass).
4. **Live end-to-end through the real server** — a `caddy` binary (v2.11.5-0.20260807215912,
   matching the reference checkout) sits in the repo root. Minimal config:
   `{admin off\n auto_https off\n persist_config off}` + `:8732 { root * DIR\n file_server { browse
   /abs/browse.html } }` — note `file_server browse { browse … }` is rejected ("browsing is already
   configured"). Use it to confirm the CSP response header exists and its nonce matches the body's
   (it does), and remember `/` serves a real `index.html` if the fixture has one, which bypasses the
   listing entirely. Drive: filter, sort, carousel (arrows/Home/End/counter/download), doc previews,
   dock, sandboxed iframe, srt→vtt, teardown, theme, help; plus icon paint, doc-scroll keys, and
   expanded mode (`imm`/`hide-ui`/idle/Esc two-step); plus the touch layer (`touch-action` per slide,
   tap-toggle, spring-back, axis lock, drag-dismiss, mouse backdrop-click). Last run **34 + 20 + 26 +
   18 assertions, 0 fail, 0 console errors** across the four drivers. These four use synthetic
   events and therefore **cannot** catch a broken native pan — see step 5.
5. **Real touch input via CDP — the only way to test native panning.** Synthetic `PointerEvent`s
   never move a scroller, so drivers 1-4 all passed while a real finger could not page at all. Node
   26 has a global `WebSocket`, so `scratchpad/cdp.js` speaks CDP with **zero dependencies**: launch
   `chrome-headless-shell … --remote-debugging-port=PORT about:blank`, take `webSocketDebuggerUrl`
   from `http://127.0.0.1:PORT/json/list`, then `Emulation.setDeviceMetricsOverride`
   (390×844, `mobile:true`) + `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`
   (`touchStart` → N `touchMove` → `touchEnd`, with advancing `timestamp`s so a fling is a fling).
   Asserts: coarse-pointer media query, arrows hidden, track geometry, per-slide `touch-action`,
   **swipe pages forward/back**, **swipe pages from a doc preview**, vertical flick dismisses,
   tap toggles chrome without closing, finger-scrolls a doc. Last run **16 assertions, 0 fail**.
   `scratchpad/probe.js` is the same rig in bisect form (reports `scrollEvents`/`scrollLeft`/
   `pointercancel`/`slideScrollW`, then re-tests with candidate rules injected through
   `styleSheets[0].insertRule` — CSSOM is CSP-legal, an injected `<style>` is not).
   Driver caveats:
   - synthetic `KeyboardEvent("Escape")` does not close a native `<dialog>` (click `.v-close`;
     dispatch a cancelable `Event("cancel")` to exercise the Esc handler);
   - wait on conditions, not fixed sleeps (virtual time skews them);
   - **the headless shell does not reliably tick CSS transitions**, so `getComputedStyle().opacity`
     stays at the pre-transition value; set `el.style.transition="none"` before asserting, or assert
     hit-testing via `elementFromPoint` instead;
   - a regex naming `requestFullscreen` inside the driver matches the driver's own `<script>` text —
     assert the API's absence with `grep` on `browse.html`, not from the page;
   - `.v-doc` nodes are re-mounted asynchronously after paging, so re-open the file (don't reuse a
     node captured before an `ArrowRight`);
   - **synthetic `PointerEvent`s carry `pointerType:""`** unless you pass it explicitly — pass
     `{pointerType:"touch",isPrimary:true}` to exercise the touch paths at all;
   - **the active slide is not the first `.v-slide`**: only a 3-slide window is mounted, so when the
     target is not item 0 the window starts at idx−1. Derive the index from `.v-count`
     (`+text.split("/")[0]-1`) and select `.v-slide[data-i="…"]`. In the fixture `LONG.md` sorts
     **last** (Caddy name-sorts case-insensitively, so `LONG.md` follows `c.png`), which also means
     `ArrowRight` has nowhere to page — make arrow assertions direction-aware
     (`q(".v-next").disabled?"ArrowLeft":"ArrowRight"`).

Manual sweep for anything visual: list + grid, deep/unicode/`%`/`#`/space filenames, symlinks, empty
dir, 5k-file dir, image/video/audio/md/code/html/pdf items, `?sort=`/`?order=`/`?layout=`/`?limit=`,
light + dark, mobile viewport (real swipe), `Accept: application/json` (must be unaffected).
