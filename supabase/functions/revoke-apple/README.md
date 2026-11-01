# revoke-apple (follow-up, not built yet)

Apple asks apps that offer Sign in with Apple to revoke the rider's Apple token
when they delete their account (App Store Review Guideline 5.1.1(v)). Today
"Delete account" in the More tab removes the Supabase user, profile, saved rides
and ride log, and unlinks ad events, but does not call Apple's revoke endpoint.

## Why it's waiting

Revoking needs a Sign in with Apple private key (.p8) from the Apple Developer
account, which isn't set up yet. Nothing else blocks on this.

## What to build when the key exists

1. In Apple Developer > Certificates, Identifiers & Profiles > Keys, create a key
   with "Sign in with Apple" enabled. Note the Key ID and your Team ID.
2. Store them as Edge Function secrets (never in code):
   ```
   supabase secrets set APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_CLIENT_ID=com.ridemadison.app
   supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
   ```
3. Add `supabase/functions/revoke-apple/index.ts` (Deno) that:
   - requires the caller's Supabase JWT and reads their user id;
   - takes the Apple `authorizationCode` the app gets from
     `AppleAuthentication.signInAsync()` (ask the rider to re-confirm with Apple
     on delete, since codes expire after 5 minutes);
   - builds an ES256 client secret JWT (iss = team id, sub = client id,
     aud = https://appleid.apple.com, kid = key id);
   - POSTs to `https://appleid.apple.com/auth/token` to get a refresh token, then
     to `https://appleid.apple.com/auth/revoke` with `token_type_hint=refresh_token`;
   - returns 200 even if Apple fails, so deletion is never blocked.
4. In `src/lib/auth.tsx` `deleteAccount()`: when the user signed in with Apple
   (`profile.signup_method === 'apple'`), get a fresh authorization code, call
   `supabase.functions.invoke('revoke-apple', { body: { code } })`, then call
   `delete_my_account` as today.
5. Deploy: `supabase functions deploy revoke-apple`.
