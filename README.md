# FamilyLoop Mobile

Native iOS and Android companion for [FamilyLoop](https://familyloop.net), built with React Native and Expo. This repository is intentionally separate from the FamilyLoop web/backend repository.

## Included

- Native email/password and consumer demo sign-in
- Household selection
- Household dashboard
- Budget, calendar, notes, meals and account views
- Shared state from the existing FamilyLoop API
- Native checklist completion with server persistence
- Pull-to-refresh, loading, error and session-expiry handling
- EAS build profiles for internal testing and store releases

## Local development

```bash
pnpm install
pnpm check
pnpm test
pnpm start
```

Set `EXPO_PUBLIC_API_URL` in `.env` to use another backend. A physical device must be able to reach that URL.

## Distribution

Install and authenticate the Expo Application Services CLI:

```bash
pnpm dlx eas-cli login
pnpm dlx eas-cli build:configure
pnpm dlx eas-cli build --platform android --profile preview
pnpm dlx eas-cli build --platform ios --profile preview
```

Production store builds:

```bash
pnpm dlx eas-cli build --platform all --profile production
pnpm dlx eas-cli submit --platform android --profile production
pnpm dlx eas-cli submit --platform ios --profile production
```

Apple distribution requires an Apple Developer Program account. Google Play distribution requires a Play Console account. Store listing copy, screenshots, privacy declarations and account-deletion review requirements must be completed before public release.

## Architecture

The native app talks directly to the HTTPS FamilyLoop API. The API keeps the signed, HttpOnly session cookie and owns PostgreSQL persistence. No credentials or household data are bundled into the application binary.
