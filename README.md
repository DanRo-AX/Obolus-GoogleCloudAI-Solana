# OPENSHELF

An agent that searches what people wrote instead of the web, and pays them over
x402 for every document it opens.

> Turn the internet into a database, and charge x402 for access.

React 19 + TypeScript + Vite + Tailwind v4. Light mode only.

```bash
npm install
npm run dev      # http://localhost:4319
npm run build
npm run preview
```

## The three screens the meeting locked

| Route | Screen | What it does |
| --- | --- | --- |
| `/` | **Chat** (01) | The front door. Ask, and SHELF-1 searches the shelves. If nothing matches it offers to commission the answer. |
| `/dashboard` | **Dashboard** (02) | The answerer's side. Open calls arrive with a price per answer; pick one, answer, get paid. |
| `/memory` | **My memory** (03) | Everything you have answered. The thicker it gets, the better auto-match sticks. |
| `/shelf` | Shelves | Browsable catalogue of the database — 24 shelves, 10 categories. |
| `/pricing` `/shelf-1` `/terms` `/privacy` `/login` | | Per-open pricing, the agent launch post, legal, auth. |

## The one thing that had to be built new

Step 4 of the question lifecycle — the hit/miss branch — is the project's only
invention, so `src/pages/Chat.tsx` implements it as a state machine that speaks
the exact dialogue the meeting settled on:

```
ask → search the shelves → rank by similarity → HIT or MISS
  HIT  → open N docs → quote each → x402 settlement line → accrues to authors
  MISS → "Nobody has covered this yet. Want me to ask people?"
       → "How many people?"  → "What do you want to pay per answer?"
       → call posted → dashboard
```

Above ₩1,500 of spend the agent confirms before opening anything. A question
that already has enough matching documents skips the call entirely and offers
to settle on the spot — the inverted order the meeting called out.

Matching is content-word overlap against shelf text (`MATCH_MIN` / `MATCH_RATIO`
in `Chat.tsx`), so on-topic questions hit and genuinely uncovered ones fall
through to an open call. Both paths are reachable in a demo.

## Canvases

`src/components/GlitterWrap.tsx` — the hero starfield, ported from the
Originkit/Framer component. Algorithm kept verbatim (framerate-independent trail
decay, cached colour strings, per-star speed jitter); the Framer plumbing was
stripped and the preset baked in as defaults. Stars composite additively, so the
hero panel carries a deep base colour for them to read against.

`src/components/PointField.tsx` — every other point field (shelf ticker, the MD
lattice, the use-case carousel, the footer wordmark), on the 2D canvas. Two
distributions: `nebula` (filament random walks) and `mask` (a lattice sampled
through an SVG or rasterised text). Both pause off-screen and honour
`prefers-reduced-motion`.

## Honest gaps

Carried over from the meeting, and stated in the FAQ rather than smoothed over:

1. **How the shelves get filled at launch.** The biggest open problem. An empty
   shelf leaves the librarian nothing to do. The dashboard ships with seeded
   open calls so a demo has something to show.
2. **Voice vs chat collection.** Undecided; v1 uses the open-call answer flow.
3. **Who gets picked when more documents match than are needed.** Undecided.
4. **Low-effort answers.** ID-verified identity is out of scope for v1.

No backend: chats, open calls, and memory persist to `localStorage`, and
`/login` validates the form then says plainly that there is no auth server.

`BRIEF.md` holds the source-of-truth product brief the copy was written against.
