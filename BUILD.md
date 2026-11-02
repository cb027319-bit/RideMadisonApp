# Building Ride Madison for the App Store (EAS)

Run these in Terminal from the RideMadisonApp-main folder. EAS builds in the cloud: no Xcode needed.

## One-time setup (after Apple approves your developer account)

1. Log in to Expo:
   `npx eas-cli@latest login`
2. Link the project to your Expo account (answer Yes):
   `npx eas-cli@latest init`
3. Give cloud builds your Supabase settings (the same two values that are in `.env.local`):
   ```
   npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://fctneqfeioysiwuswsyk.supabase.co --environment production --visibility plaintext
   npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <the sb_publishable_ key from .env.local> --environment production --visibility plaintext
   ```
   (The publishable key is meant to ship inside the app; that's why it's plaintext.)

## Build for iPhone

`npx eas-cli@latest build --platform ios --profile production`

The first time, EAS asks you to sign in with your Apple ID and offers to create the
certificates, the app's bundle ID (com.ridemadison.app) and Sign in with Apple for you. Say yes.
A build takes about 15–25 minutes; you get a link when it's done.

## Send it to TestFlight

`npx eas-cli@latest submit --platform ios --latest`

EAS creates the app in App Store Connect if needed and uploads the build. About 10–30 minutes
later it appears in TestFlight. Install the TestFlight app on your iPhone to try it, then add
testers in App Store Connect → TestFlight.

## Later updates

Run the build + submit commands again. Build numbers go up automatically.

## Quick fixes without a new build (over-the-air updates)

Builds made after Nov 1, 2026 include EAS Update. For JavaScript-only changes (most fixes):

`npx eas-cli@latest update --channel production --message "what changed"`

Riders get it the next time they open the app (it downloads in the background and applies on
the following launch). Native changes (new packages, app.json permissions, icons) still need a
new build + submit.

## Usage stats (PostHog)

The app sends anonymous usage events to PostHog (event list: `docs/analytics-events.md`).
With no key set, analytics is switched off and the app works exactly the same.

1. Give cloud builds the PostHog key and host, once for each environment (copy and paste
   these four lines one at a time). The key starts with `phc_` and is a public key meant to
   ship inside the app, so it's plaintext like the Supabase one:
   ```
   npx eas-cli@latest env:set --name EXPO_PUBLIC_POSTHOG_KEY --value phc_Ay4eAedYquC4UQWNtfbtUxgnaGdYWqrNAXem2CtUwRvf --environment preview --visibility plaintext
   npx eas-cli@latest env:set --name EXPO_PUBLIC_POSTHOG_HOST --value https://us.i.posthog.com --environment preview --visibility plaintext
   npx eas-cli@latest env:set --name EXPO_PUBLIC_POSTHOG_KEY --value phc_Ay4eAedYquC4UQWNtfbtUxgnaGdYWqrNAXem2CtUwRvf --environment production --visibility plaintext
   npx eas-cli@latest env:set --name EXPO_PUBLIC_POSTHOG_HOST --value https://us.i.posthog.com --environment production --visibility plaintext
   ```
   (The host is PostHog US Cloud. If the project were ever moved to EU Cloud it would be
   `https://eu.i.posthog.com`.) For running the app on your own computer, the same two
   lines go in `.env.local` as `EXPO_PUBLIC_POSTHOG_KEY=...` and `EXPO_PUBLIC_POSTHOG_HOST=...`.
2. **This needs a new build, not just an over-the-air update.** Adding PostHog also added
   the `expo-application` native module, which the app store build has to include. Run the
   build + submit commands above once; after that, changes to which events are sent can go
   out as normal over-the-air updates.
3. Riders can turn it off in More → "Share anonymous usage stats" (on by default).

What is never sent: GPS points or coordinates, addresses, route lines, search text, or the
rider's name or email. Signed-in riders are linked only by their account's random id. There
is no session replay and no automatic tap recording, and PostHog's IP-to-location lookup is
switched off. Sponsor reports should still come from Supabase (`partner_events`), which stays
the official count; PostHog mirrors the same moments for exploring trends.
