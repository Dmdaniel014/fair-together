# FairTogether Mobile UI Kit — Hebrew / RTL

Pixel-accurate recreation of the FairTogether Expo/React Native consumer app,
rebuilt as static HTML + JSX for design handoff.

## Components (Primitives.jsx)
- `Button` — variants: primary, secondary, ghost, destructive, success · sizes: sm, md, lg
- `Chip` — selectable filter/category chip (RTL)
- `Pill` — inline status/filter pill with optional icon
- `Badge` — tiny status dot + label (success / warning / info / neutral)
- `Card` — standard white card container
- `BrandLogo` — circular letter mark coloured by defendant brand (Shufersal red, Partner green, etc)
- `TabBar` — bottom 5-tab navigation, RTL order (profile is leftmost, home is rightmost)

## Screens (Screens.jsx)
| Screen | Component | Notes |
|---|---|---|
| Splash / intro | `SplashScreen` | Sky gradient, pager dots, "כניסה" CTA |
| Onboarding — categories | `CategoriesScreen` | Multi-select chips, blue progress bar |
| Home feed | `HomeScreen` | Personalised settlements, filter pills, search |
| Settlement detail | `SettlementDetail` | Eligibility meter, step-by-step CTA |
| Claims list | `ClaimsScreen` | Timeline steps, 5-segment progress bar |
| Notifications | `NotificationsScreen` | Unread dots, grouped by day |
| Profile | `ProfileScreen` | Avatar hero, grouped settings rows |
| Legal consultation (chat) | `LegalChat` | STRENGTHEN-mode AI chat with suggestion chips |

## Interactive prototype
`index.html` renders three phones side-by-side:
1. Splash
2. Onboarding chips (toggleable)
3. Full app — use the top bar or the in-phone tab bar to move between Home / Claims / Notifications / Profile / Legal chat. Tap a settlement card on Home to open its detail view.

## Source
Screens traced from `fair-together/mobile/app/**` (Expo Router) and Figma
screenshots in `uploads/`. Brand-colour map for Israeli defendants in
`Primitives.jsx :: BRAND_COLORS`.
