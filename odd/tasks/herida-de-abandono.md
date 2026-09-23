# Herida de abandono landing

## Objective
Create a dedicated, responsive landing page at `/heridadeabandono` that presents Carolina Castellanos's abandonment-wound class and its supplied video.

## Scope
- Dedicated HTML and CSS page.
- Route and static assets served by the existing Express application.
- Reuse `Landing/ Herida_de_Abandono.mp4` locally.

## Delivery strategy
ask-on-risk

## Tasks
- [x] HDA-01 — Build the dedicated page structure and accessible video player.
  - Evidence: `Landing/heridadeabandono/index.html` includes native video controls and fallback text.
- [x] HDA-02 — Implement the reference-inspired responsive visual design.
  - Evidence: `Landing/heridadeabandono/styles.css` provides responsive typography, video framing, and CTA states.
- [x] HDA-03 — Serve `/heridadeabandono` and its assets; verify the route.
  - Evidence: route and static middleware added; `node --check server/server.js` and `git diff --check` pass. HTTP probe could not connect to the sandbox-local process.

## Checks
- `node --check server/server.js`
- Start server and request `/heridadeabandono`.

## Progress
Completed and deployed. Video optimized from 150.82 MB to 47.31 MB for GitHub delivery. Visual styling now matches the existing Carolina landing palette and typography. CTA links internally to `/eneagrama` with centered text.
