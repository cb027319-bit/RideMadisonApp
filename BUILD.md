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
