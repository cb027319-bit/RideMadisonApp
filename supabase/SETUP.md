# Ride Madison accounts: Supabase setup

Sign-ups (name, email, optional phone, opt-ins, riding preferences) and saved
rides live in Supabase. Do these steps once.

## 1. Create the project
supabase.com → New project → name `ride-madison`, region Central/East US.
Copy **Project URL** and the **anon / publishable key** (Project Settings → API).

## 2. Connect the app
Create `.env.local` in the app folder (it is not committed to git):

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Restart `npx expo start` after creating or changing it.

## 3. Create the tables
Dashboard → **SQL Editor** → New query → paste all of
`supabase/migrations/0001_accounts.sql` → **Run**.

This creates `profiles` and `saved_rides`, privacy rules (each rider can only
see their own rows), automatic profile creation on sign-up, and the
`delete_my_account` function Apple requires.

## 4. Email sign-in with a 6-digit code
Authentication → **Email Templates** → **Magic Link**. Replace the body with:

```html
<h2>Your Ride Madison code</h2>
<p>Enter this code in the app: <strong style="font-size:24px">{{ .Token }}</strong></p>
<p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
```

Subject: `Your Ride Madison sign-in code`

Also check Authentication → **Sign In / Providers** → Email is enabled.

> Before launch: Supabase's built-in email sender is limited to a few emails
> per hour. Connect a real sender (Resend, Postmark or SendGrid) under
> Authentication → **SMTP Settings**, sending from an @ridemadison.com address.

## 5. Allowed redirect URLs (needed for Google)
Authentication → **URL Configuration** → Redirect URLs → add:

```
exp://**
ridemadison://**
```

(`exp://` is Expo Go during development; `ridemadison://` is the real app.)

## 6. Google sign-in
1. console.cloud.google.com → create project "Ride Madison".
2. **Google Auth Platform / OAuth consent screen**: External, app name Ride Madison,
   support email, scopes `email`, `profile`, `openid`.
3. **Clients → Create client → Web application**. Authorized redirect URI:
   `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client secret into Supabase → Authentication →
   **Sign In / Providers → Google** → enable → save.

## 7. Sign in with Apple
Required by App Store rule 4.8 because the app offers Google sign-in.
Needs an Apple Developer Program membership ($99/year) for the real app.

Supabase → Authentication → **Sign In / Providers → Apple** → enable, and in
**Client IDs** enter:

```
com.ridemadison.app,host.exp.Exponent
```

(`host.exp.Exponent` lets it work inside Expo Go while testing.) The native
iPhone flow does not need the secret key; a web/Android Apple flow would.

## 8. See your sign-ups
Table Editor → `profiles`. Export with the **…** menu → Export to CSV.
`sms_opt_in` and `email_opt_in` record each rider's consent; only market to
riders where they are `true`.

## Before the App Store
- Publish a privacy policy and terms at ridemadison.com/privacy and /terms
  (the sign-up screen links there).
- App Store Connect → App Privacy: declare name, email, phone, coarse location.
- Account deletion is built in (More → Account → Delete account).

## Ride stats and badges (0003)

Run `supabase/migrations/0003_ride_stats.sql` in SQL Editor > New query > Run. It creates `ride_logs` (one row per finished ride, readable only by that rider). Deleting an account removes its ride log automatically.

## v1 fixes: ad reporting and account deletion (0004)

Run `supabase/migrations/0004_v1_fixes.sql` in SQL Editor > New query > Run (after 0001 and 0002). It:
- stops the app writing to `partner_events` directly; the app now calls `record_partner_event()`, which fills in the
  rider from their session, checks the event, only counts live partners and ignores repeats (impressions once per
  30 minutes per rider or app launch);
- links `partner_events.user_id` to the account and clears it when the account is deleted;
- adds the `offer` event.

Update the app and run this migration together: older builds insert into `partner_events` directly and their ad
events will be refused once 0004 is in.

Sign in with Apple token revocation on account deletion is still to do: see `supabase/functions/revoke-apple/README.md`.

## Email + password sign-up and welcome email (0006)

1. Authentication → Sign In / Providers → Email: turn **off** "Confirm email" so new accounts sign in right away.
2. Authentication → Emails → Reset Password: subject `Your Ride Madison password reset code`, body = all of `supabase/email-templates/reset-password.html` (branded, shows the 6-digit `{{ .Token }}` code the app asks for).
3. Run `supabase/migrations/0006_welcome_email.sql`.
4. Deploy the welcome email: see `supabase/functions/welcome-email/README.md`.
