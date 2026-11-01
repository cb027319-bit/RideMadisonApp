# Welcome email

Sends each new rider one branded welcome email (English or Spanish, matching the app),
right after they create an account and finish or skip the profile step. Works for email,
Apple and Google sign-ups. It never sends twice (profiles.welcomed_at).

Preview: `npx tsx` a script calling `welcomeEmail()` from template.ts, or see the tests.

## Set up (one time, about 10 minutes, no developer tools needed)

1. **Run migration 0006** (`supabase/migrations/0006_welcome_email.sql`) in SQL Editor.
   Existing accounts are marked as already welcomed, so only new riders get it.
2. **Logo** (optional but recommended): Supabase → Storage → New bucket `email`, Public on →
   upload `assets/email/logo.png` → click it → Get URL. Copy that URL.
3. **Secrets**: Supabase → Edge Functions → Secrets → add:
   - `RESEND_API_KEY`: your Resend key
   - `WELCOME_FROM`: e.g. `Ride Madison <hello@ridemadison.com>` (domain must be verified in Resend)
   - `WELCOME_REPLY_TO` (optional): the inbox where replies should land
   - `WELCOME_LOGO_URL` (optional): the logo URL from step 2
   - `MAILING_ADDRESS` (optional): a postal address for the footer
4. **Deploy**: Supabase → Edge Functions → Deploy a new function → Via Editor →
   name it `welcome-email` → replace the sample code with the whole of
   `dashboard-paste.ts` → Deploy. Then in the function's Settings, turn OFF "Verify JWT with legacy secret" (projects on the new JWT signing keys need this; the function checks the rider itself).
5. **Test**: create a new account in the app with an email you can check.

If you edit `template.ts` or `index.ts`, run `node scripts/build-welcome-email.mjs`
and paste the new `dashboard-paste.ts` again (or use `supabase functions deploy welcome-email`).
