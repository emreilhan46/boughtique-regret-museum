# Boughtique — The Regret Museum

A sleek, mobile-first purchase-confessions website with optional classified ads and private buyer–seller messaging.

## What works
- Browse and search publicly published confessions
- Filter available-for-sale items and categories
- Email/password account creation and sign-in
- Upload up to **6 JPG/PNG/WebP photos per exhibit**, maximum **5 MB each**
- Create a confession with price, category, story and optional lesson
- Optionally offer an item for resale with asking price, condition and pickup area
- Private messages between a buyer and the listing owner
- Seller can mark item as sold
- Report inappropriate listings (stored for admin review)
- Row-level security for messages, conversations, and uploads

## Setup — do these in order

### 1. Put files on GitHub
Open your existing `emreilhan46/boughtique` repository. If it already contains the old site, **back it up first** or create a separate repository for testing. Unzip this package and upload its contents (not the containing folder) into the repository, or use Git to commit and push.

### 2. Create Supabase backend
Create a project at https://supabase.com/dashboard. Go to **SQL Editor**, create a new query, paste all of `supabase/schema.sql` and run it once. This creates the database tables, access policies, messaging function and photo storage bucket.

In **Authentication > Providers > Email**, enable email/password authentication. For a public site, enable email confirmation and configure your site URL / redirect URLs. Supabase's default email service has limitations; configure a proper SMTP provider before public launch.

In **Project Settings > API** (or Connect), copy the **Project URL** and **publishable/anon key**. Never use a secret/service-role key in the frontend.

### 3. Deploy with Vercel
Import the GitHub repository into https://vercel.com/new. Select **Vite** (Vercel should auto-detect it). Add these environment variables in Vercel project settings:

`VITE_SUPABASE_URL` = your Supabase Project URL

`VITE_SUPABASE_ANON_KEY` = your Supabase publishable/anon key

Deploy. If you add/change env vars after deploying, redeploy.

### 4. Configure domain
First test the generated `*.vercel.app` address. When it works, go to Vercel **Settings > Domains** and add `boughtique.com` and `www.boughtique.com`. Follow **Vercel's exact DNS instructions**, which depend on your configuration. Don't reuse GitHub Pages DNS records.

### 5. Test the complete flow
Use two distinct email accounts. Account A submits a confession with photos and marks it for sale. Account B finds it, clicks **Message seller**, and sends a message. Account A signs in, sees the conversation, and replies. Account A marks the item sold; it stays visible as a museum exhibit.

## Local development
```bash
npm install
cp .env.example .env
# Fill in the values in .env
npm run dev
```

## Important before a public launch
This is an **MVP starter**, not a fully production-hardened classified-ads service. In particular:
- The starter **publishes immediately**. Add anti-spam controls (CAPTCHA, rate limiting, automated screening and/or pre-publication review) before inviting the public.
- Reports are saved to `public.reports`, but **there is no admin moderation dashboard** yet. Review reports in the Supabase dashboard and add a takedown workflow.
- Uploaded images are **public**. Warn users not to upload receipts, addresses, faces without permission or personal data. Add image scanning and metadata stripping before public launch.
- Add abuse controls for messaging, including block/mute, rate limits, scam reporting and account restrictions.
- Replace the starter Terms and Privacy pages with legally reviewed versions, including GDPR and relevant DSA obligations.
- No checkout, commission, payment processing or shipping is included. Buyer and seller arrange transactions directly.
- There are no fabricated reviews or sample confessions. The homepage is empty until a real user submits.
- Photos can be orphaned if a user uploads successfully but submission fails; add periodic cleanup for long-term operation.

## Stack
Vite + React + React Router + Supabase Auth/Postgres/Storage + Vercel. GitHub is source control, **not** the backend.
