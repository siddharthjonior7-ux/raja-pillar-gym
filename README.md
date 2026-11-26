# Pillar Fitness — gym management

Members, memberships, fees, renewals, WhatsApp reminders and reports for **Pillar Fitness, Kothri, MP** (owner: Raja Pillar).
React + Supabase (PostgreSQL, Row Level Security). Works on desktop and phone.

This project uses **its own Supabase project** (organisation "raja pillar"). It does not touch any Lovable project or its GitHub repo.

## What is already done
- The database (tables, security rules, payment functions) is installed in the Supabase project.
- `.env` already holds that project's URL and **public** key. The public key is safe in the app; access is controlled by the database security rules.
- Plans loaded: 1 Month ₹1,000 and 3 Months ₹2,500 (men and women). Add 6 or 12 months in Settings > Prices and plans.
- The first owner is approved by **email** (see step 2). Nobody else can get in until the owner adds them.

## 1. Run it
```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build in /dist
```

## 2. Make login work (do this first)
Login is **email and password only**. There is no SMS or phone login, so nothing extra to pay for.

1. Supabase dashboard > **Authentication** > Providers > **Email**. For a quick start turn **Confirm email** off; otherwise each person must click a link in their inbox first.
2. Approve the first owner. In **SQL Editor** run this once with the owner's real email:
   ```sql
   insert into public.staff_invites (full_name, email, role) values ('Owner name', 'owner@example.com', 'owner');
   ```
3. Open the app > **New here? Create an account** using that same email and a password of 8+ characters. He lands in the app as owner.
4. **Reset links:** Authentication > URL Configuration: set **Site URL** to your live address once deployed.

## 3. Add staff
Owner logs in > Settings > Staff > enter the receptionist's email > Add staff. They then create an account with that email. Anyone not added gets "Waiting for access" and sees no data.

## 4. Put it online
Any static host works. Vercel: import the repo, add the two variables from `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), deploy. `vercel.json` and `public/_redirects` (Netlify) are included.

## 5. Your own GitHub repo (separate from Lovable)
Create a new empty repository on GitHub, then:
```
git init && git add . && git commit -m "Pillar Fitness"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-NEW-REPO.git
git push -u origin main
```
`.env` is git-ignored.

## 6. Automatic WhatsApp (optional, later)
**Today, reminders work without any API:** every "WhatsApp" button opens WhatsApp with the message already typed (click-to-chat, +91 added). The app logs it as "Opened in WhatsApp". It does not claim the message was delivered.

To send automatically from the gym's own number you need the **WhatsApp Business Platform (Cloud API)** from Meta: a verified business, a phone number, a permanent access token, and **approved message templates** (WhatsApp requires templates for business-initiated messages). Then:
1. Owner > Settings > **WhatsApp**: paste Phone Number ID, Business Account ID, token. Saved on the server only; never shown again.
2. Settings > **Reminders**: enter each approved template name and switch on what to send automatically.
   Template variables, in order: pending fee `{{1}}` name `{{2}}` amount · overdue name, amount, due date · expiry name, expiry date · renewal name, expiry date · payment confirmation name, amount, plan, valid until.
3. Deploy the two functions with the Supabase CLI (`supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`):
   ```
   supabase functions deploy send-whatsapp
   supabase functions deploy whatsapp-auto --no-verify-jwt
   supabase secrets set CRON_SECRET=choose-a-long-random-text
   ```
4. Run `supabase/schedule-reminders.sql` (fill in the two placeholders) to schedule the daily run.

Guards: members without WhatsApp consent are never messaged; the same member is not messaged again inside the "do not repeat" window; failed sends are retried at most 3 times per window.

## How the rules work
- **Membership status** (active / expired) and **fee status** (paid / pending / partly paid / overdue) are separate and always calculated from dates and payments.
- **Revenue** = payments actually received. Voided payments are excluded and never double counted.
- Each plan purchase (new or renewal) has its own price, discount, final amount, due date and payments. Old records are never overwritten; price changes affect only new plans.
- Payments cannot be edited or deleted. The owner can **void** one with a reason; it stays in the history.
- Paying twice by double-click is blocked (idempotency key); the same UPI/transaction ID cannot be used twice.
- Members are archived, never deleted; history is kept.

## Roles
| | Owner | Receptionist |
|---|---|---|
| Add/edit members, record payments, renew, send reminders | yes | yes |
| Discounts | any | up to the limit the owner sets (default none) |
| Prices, staff, WhatsApp setup, reports, export | yes | no |
| Void payment, cancel plan, archive member | yes | no |

## Tests
`npm run test:db` runs 58 checks against the real database file in an in-memory PostgreSQL: prices (₹1,000 / ₹2,500), mobile-only registration, dashboard counts, pending/partial/overdue, revenue, renewal history, discount limits, permissions, secrets never readable, duplicate-payment protection and reminder de-duplication.
