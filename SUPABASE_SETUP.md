# Connecting Supabase to KALA

This turns on **email sign-in (magic link)** and **sync across devices**.
Until you do this, KALA runs fine in guest mode (data stays on the device).

Total time: ~10 minutes.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick a name (e.g. `kala`), a strong database password, and a region close
   to your users.
3. Wait ~2 minutes for it to provision.

## 2. Create the table

1. In the project, open **SQL Editor** → **New query**.
2. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql).
3. Click **Run**. You should see "Success". This creates the `states` table
   with row-level security so each person can only read/write their own data.

## 3. Get your API keys

1. Go to **Project Settings → API**.
2. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`

## 4. Add the keys to Vercel

1. In Vercel → your KALA project → **Settings → Environment Variables**.
2. Add both:
   ```
   VITE_SUPABASE_URL        = https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY   = eyJhbGciOi...
   ```
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the new vars take effect.

For local dev, copy `.env.example` → `.env` and paste the same two values.

## 5. Point Supabase auth back to your site

1. In Supabase → **Authentication → URL Configuration**.
2. Set **Site URL** to `https://kala.knsl.tech`.
3. Under **Redirect URLs**, add:
   ```
   https://kala.knsl.tech
   http://localhost:5173
   ```
   (The second one lets sign-in work during local development.)

## 6. (Optional) Make the magic-link email on-brand

Supabase → **Authentication → Email Templates → Magic Link**. You can edit the
copy to match KALA's voice ("Here's your one-tap sign-in for KALA…").

---

## How it behaves once connected

- **New visitor** → enters email → gets a magic link → taps it → signed in,
  data syncs to the cloud and follows them to any device.
- **Existing guest** → when they sign in for the first time, whatever they
  created on the device is lifted up to the cloud automatically (nothing lost).
- **No keys set** → the app silently stays in guest mode. Nothing breaks.

All of this lives behind three functions in `src/lib/storage.js` and the small
`src/lib/auth.js` helper — so if you ever change backends, this is the only
corner of the app you touch.
