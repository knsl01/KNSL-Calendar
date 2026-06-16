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

## 6. (Required) Put the sign-in **code** in the email

KALA signs people in with a **6-digit code** they type into the app, not just
a tappable link. This is essential: when KALA is added to the iOS home screen,
it runs as a standalone app with its own storage. Tapping a magic link in an
email always opens **Safari**, never the installed app — so the session lands
in Safari and the home-screen app stays logged out. A code the user types in
never leaves the app, so it works everywhere.

For the code to appear in the email:

1. Supabase → **Authentication → Email Templates → Magic Link**.
2. Make sure the template includes the token, e.g.:
   ```html
   <h2>Your KALA sign-in code</h2>
   <p>Enter this code in the app to sign in:</p>
   <p style="font-size:28px;letter-spacing:6px;"><strong>{{ .Token }}</strong></p>
   <p>Or, on a desktop browser, you can tap this link instead:</p>
   <p><a href="{{ .ConfirmationURL }}">Sign in to KALA</a></p>
   ```
   The `{{ .Token }}` is the 6-digit code. Keep `{{ .ConfirmationURL }}` too —
   it's a handy fallback when the email is opened in the same browser.

## 7. (Required for production) Send the emails through Resend

Supabase's built-in email service is rate-limited to a handful of messages per
hour and is meant only for testing — in production, sign-in codes will silently
stop arriving. Point Supabase at **Resend** (custom SMTP) so emails are sent
reliably from your own domain. KALA sends from **`no-reply@kala.knsl.tech`**.

### 7a. Verify the sending domain in Resend

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add Domain** → enter `kala.knsl.tech`.
3. Resend shows a set of DNS records (the exact values are unique to your
   account — copy them from the Resend dashboard, don't hand-copy these):
   - an **MX** record + **SPF** `TXT` record on a `send.` subdomain
     (return-path),
   - a **DKIM** `TXT` record (`resend._domainkey…`),
   - (optional but recommended) a **DMARC** `TXT` record.
4. Add those records in the DNS for `knsl.tech` (Vercel DNS / your registrar),
   then click **Verify** in Resend. Verification usually takes a few minutes
   (can be longer while DNS propagates).

### 7b. Create an API key

1. Resend → **API Keys → Create API Key** (Sending access is enough).
2. Copy the key (`re_…`). You'll paste it as the SMTP password below — it's
   shown only once.

### 7c. Enable custom SMTP in Supabase

1. Supabase → **Project Settings → Authentication → SMTP Settings**.
2. Turn on **Enable Custom SMTP** and enter:
   ```
   Host            = smtp.resend.com
   Port            = 465        (or 587)
   Username        = resend
   Password        = re_…       (the Resend API key from 7b)
   Sender email    = no-reply@kala.knsl.tech
   Sender name     = KALA
   ```
3. Save. Under **Authentication → Rate Limits**, raise the email rate limit
   from the default (it's intentionally tiny while on the built-in service).
4. Send yourself a sign-in code from the app to confirm the email arrives from
   `no-reply@kala.knsl.tech` and shows the 6-digit code.

> The sender email's domain **must** be the one you verified in Resend
> (`kala.knsl.tech`), or Resend will reject the message.

---

## How it behaves once connected

- **New visitor** → enters email → gets a 6-digit code → types it into the app
  → signed in, data syncs to the cloud and follows them to any device. (The
  link in the email still works as a fallback on desktop.)
- **Existing guest** → when they sign in for the first time, whatever they
  created on the device is lifted up to the cloud automatically (nothing lost).
- **No keys set** → the app silently stays in guest mode. Nothing breaks.

All of this lives behind three functions in `src/lib/storage.js` and the small
`src/lib/auth.js` helper — so if you ever change backends, this is the only
corner of the app you touch.
