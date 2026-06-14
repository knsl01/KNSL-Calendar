# KALA

**Design your life, not just your week.**

KALA visualizes your whole life in weeks — birth to life expectancy — so you can step back and ask the question a calendar never lets you ask: *am I moving toward the life I actually want?*

A product by **KNSL**.

---

## Quick start

```bash
npm install
npm run dev      # local dev at http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```

Requires Node 18+.

---

## Deploy to Vercel (the easy path)

1. Push this folder to a GitHub repo.
2. In [Vercel](https://vercel.com), **Add New → Project** and import the repo.
3. Vercel auto-detects Vite. Defaults are correct (`vercel.json` is included):
   - Build command: `npm run build`
   - Output directory: `dist`
4. Click **Deploy**. Done — your app is live.
5. Add your domain (`kala.knsl.tech`) under **Project → Settings → Domains**.

No environment variables are required to run. Data is stored locally in the
browser until you connect Supabase (see below).

---

## Project structure

The codebase is split so that **pure logic** (easy to test, easy to move to a
backend) is separated from **UI**. As the app grows, components can be pulled
out of `app/` into `components/` and `views/` without touching the logic layer.

```
kala/
├── public/                  Static assets served as-is
│   ├── icon.png             App icon (PWA / favicon)
│   ├── og-image.png         Social share image
│   ├── manifest.webmanifest PWA manifest
│   └── service-worker.js    Offline shell + web-push (weekly nudge)
│
├── src/
│   ├── lib/                 Pure logic — no UI, no React. The scale-up core.
│   │   ├── storage.js       loadState / saveState / clearState.
│   │   │                     ← swap this one file for Supabase later.
│   │   ├── themes.js        THEME_DEFS + buildPalette (5 themes × light/dark)
│   │   ├── constants.js     Areas, tabs, seasons, relations, wrapped, prompts
│   │   ├── helpers.js       weeksBetween, fmt, currentWeekKey
│   │   └── i18n.js          Minimal EN/ID translation
│   │
│   ├── app/
│   │   └── KalaApp.jsx      The application (all views & components today)
│   │
│   ├── components/          (reserved) shared UI as it gets extracted
│   ├── views/               (reserved) top-level screens as they get extracted
│   │
│   ├── App.jsx              Thin wrapper — future home of routing/providers
│   ├── main.jsx             Entry point + service-worker registration
│   └── styles.css           Global reset only (styling is theme-driven inline)
│
├── index.html               SEO + Open Graph + font preloads
├── vite.config.js           Vite + "@/" alias to src/
├── vercel.json              SPA rewrites + asset caching headers
├── .env.example             Supabase / push key slots
└── package.json
```

### Why this shape scales

- **`lib/` is framework-free.** Every number KALA shows comes from `helpers.js`;
  every byte it stores goes through `storage.js`. You can unit-test these and
  reason about them without rendering anything.
- **One swap point for the backend.** Moving from on-device storage to
  multi-device cloud sync means rewriting **only** `src/lib/storage.js`
  (a Supabase template is in the file's comments). Nothing else changes.
- **The UI can split gradually.** `KalaApp.jsx` holds the views today. When a
  view earns its own file, move it to `views/` and shared pieces to
  `components/` — the `@/` alias keeps imports clean.

---

## Connecting Supabase (when you want cloud sync)

1. Create a project at [supabase.com](https://supabase.com).
2. `npm install @supabase/supabase-js`
3. Copy `.env.example` → `.env` and fill `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
4. Implement `loadState` / `saveState` / `clearState` in `src/lib/storage.js`
   against Supabase (template included in that file's comments).
5. Wire the magic-link sign-in where `AuthScreen` calls `signIn()` in
   `KalaApp.jsx` (marked with a TODO).

Because the rest of the app only ever calls those three storage functions and
that one auth hook, nothing else needs to change.

---

## Tech

- **React 18** + **Vite 5**
- No CSS framework — styling is theme-driven inline styles over a runtime
  palette, so all 5 themes × light/dark work with zero extra CSS.
- The life grid renders on a single `<canvas>` (not thousands of DOM nodes),
  so it stays smooth even at ~4,000 weeks.

---

© KNSL. KALA and the KALA mark are part of the KNSL product family.
