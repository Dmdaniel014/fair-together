# Mobile App — React Native + Expo

## Structure
```
mobile/src/
├── screens/
│   └── OnboardingScreen.tsx    ← Brand/category selection flow
├── components/
│   ├── BrandCard.tsx           ← Brand selection tile
│   ├── LawsuitCard.tsx         ← Case summary card
│   ├── SelectionChip.tsx       ← Multi-select chip
│   └── GlobalAlertBanner.tsx   ← System-wide alert bar
├── theme/
│   └── index.ts                ← Colors, fonts, spacing (Figma-matched)
└── services/                   ← API client (TODO)
```

## Design System
- Theme tokens in `theme/index.ts` — always use theme values, never hardcode colors/spacing
- Font: Heebo (Hebrew-optimized Google Font via `@expo-google-fonts/heebo`)
- RTL layout — Hebrew is primary language, all text flows right-to-left
- Component naming: PascalCase, one component per file

## Backend Connection
- API base: `http://localhost:3001` (dev) / `https://api.fairtogether.co.il` (prod)
- Key endpoints:
  - `POST /api/matches` — send user profile, get matched lawsuits
  - `GET /api/lawsuits` — browse all ready lawsuits
  - `POST /api/user/feedback` — record user actions (JOINED/DISMISSED/SAVED)
  - `GET /api/insights/:userId/:lawsuitId` — AI explanation

## Current Status
- Components exist but **not yet connected** to backend API
- No navigation/routing setup yet
- No state management yet
- No `package.json` — needs Expo project initialization

## Next Steps
1. Initialize Expo project: `npx create-expo-app@latest`
2. Install dependencies: expo-font, expo-router, react-native-reanimated
3. Set up navigation (expo-router)
4. Create API service layer (`services/api.ts`)
5. Build Dashboard screen (list of matched lawsuits)
6. Connect OnboardingScreen to `POST /api/matches`
7. Add push notification registration (expo-notifications)

## Conventions
- All user-facing text in **Hebrew**
- Component props: TypeScript interfaces, no `any`
- Styles: StyleSheet.create (not inline)
- Colors/spacing: always from theme, never magic numbers
