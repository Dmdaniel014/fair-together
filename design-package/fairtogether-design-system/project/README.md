# FairTogether · פייר טוגדר — Design System

> An Israeli consumer-rights mobile app that helps ordinary citizens discover, understand, and act on consumer-protection issues — class-action settlements, group claims, and AI-guided legal consultation.

**The app is Hebrew-first and RTL-native.** Every screen, list, icon, and gesture is designed right-to-left as the default — not mirrored from an LTR layout.

---

## Product context

FairTogether scans Israeli court databases (`odata.org.il`), uses Claude AI to extract case details from PDFs, matches users against the brands they shop with, and pushes notifications when money may be owed to them. Users can also found or join **pre-action "incubator" cases** — groups of wronged consumers that form *before* a lawyer is involved.

**Target user:** Israeli consumers 20–65, wronged by a company (overcharged, misled, defective goods) who don't know whether they have grounds to act.

**Brand feel:** Empowering, trustworthy, plainspoken. **Not** lawyerly. **Not** scary. "Duolingo-meets-small-claims-court" — a friendly guide that makes a scary-sounding process feel approachable.

**Core surfaces:**
- Onboarding — category → brands → shopping-frequency window
- Home / Feed — personalized settlements matched to the user
- Settlement detail — eligibility check + claim guide
- **Incubator** (flagship) — discovery, case detail, create-a-case flow
- Legal consultation — AI chat (strengthen / general modes)
- Profile + claims tracking
- Admin dashboard (role-gated)

---

## Sources used to build this system

| Source                                         | Path                                          |
|------------------------------------------------|-----------------------------------------------|
| Mobile app codebase (Expo / React Native)      | `fair-together/mobile/` *(read-only import)*  |
| Theme source of truth                          | `fair-together/mobile/src/theme/index.ts`     |
| Original screenshots (11 screens, 2026‑03‑27)  | `assets/screens/01‑11.png`                    |
| Backend architecture notes                     | `fair-together/CLAUDE.md` *(summarized)*      |

The mobile app is not published; everything here derives from the codebase + screenshots above.

---

## Visual foundations

### Color
The palette is built around **one primary blue** (`#1A56DB`) on a **cool neutral page** (`#F0F4F8`). Emerald (`#059669`) is the workhorse success/accent. Danger is used sparingly — this is a brand about empowerment, not alarm.

- **Never use red as a dominant color.** In Israeli consumer context red reads as *debt* or *danger*.
- Blue alone reads bureaucratic — so the visual language leans on a **soft sky gradient** (`#89B4E8 → #F0F4F8`) for splash moments and onboarding headers, pulling the blue out of pure-corporate territory.
- Status pills use a small but consistent palette: emerald (approved / paying), amber (in-settlement), blue (ruling), violet (certified), slate (filed / closed).

### Type
- **Heebo** (Google Fonts) — modern Hebrew sans with five weights. The app uses 400 / 500 / 600 / 700.
- Hebrew has no ascenders, so line-height is **1.4–1.5×** font size for readability (slightly generous vs. a Latin scale).
- **JetBrains Mono** is used for numerical data (payouts, deadlines, case numbers, confidence %) — giving lawsuit cards a "data readout" feel that differentiates structured facts from narrative copy.
- Numerals are always **Western Arabic digits** (`₪1,200`), never Hebrew-Arabic numerals — the codebase uses this convention universally.
- Display sizes cap at 28px on mobile; content density is high.

### Spacing & radii
- **4-pt grid** (xs 4 → 3xl 48). Base body spacing is 16px.
- **Rounded, soft geometry.** Cards use `radius-lg` (16px), pills use `radius-pill` (999), buttons match card radius. There are no sharp corners anywhere in the system.
- Layouts are generous — this is a text-heavy app with high legibility requirements.

### Backgrounds
- **Pages:** flat `#F0F4F8` cool gray. No patterns, no textures.
- **Hero moments** (splash, auth, onboarding headers): **sky gradient** bottom-fading to the page color. This is the one "brand flourish" in the visual language — otherwise the app is quiet.
- **Cards:** pure white `#FFFFFF` in the production screens. The theme file ships a `glass` token set for iOS blur surfaces; use sparingly (tab bar, floating CTAs).

### Elevation
- Three-layer shadow system: `card` (resting), `card-raised` (hovered / pressed states), `button` (primary CTA glow — colored with primary-blue shadow).
- No heavy drop shadows. Depth comes from the tiniest bit of blur (8–16px) at low opacity (4–10%).
- Primary CTAs carry a colored glow (`rgba(26, 86, 219, 0.20)`) rather than a neutral shadow — this signals "press me" energy.

### Corner radii
- Cards: 16px. Buttons: 16px. Chips & pills: 999px (fully round) or 12px (rectangular pill).
- Brand logo wells in onboarding: 12px square with 48×48 footprint.

### Borders
- Hairline borders (`rgba(148, 163, 184, 0.15)`) sit under shadows to define edges on near-white cards.
- Focus border is primary-blue at **1.5px** (thicker than the default 1px) for stronger selection feedback.

### Motion & interaction
- **Spring-based presses** (damping 18–20, stiffness 200–260) — a gentle 2–3% scale-down on press-in. No ease curves; everything is physical.
- **Fade-in + slight slide** (`FadeInDown`) as list items enter, with a `55ms * index` stagger, capped at 350ms total.
- Confidence bars and progress meters animate over **700ms** with a `withTiming` curve.
- Hover / press states: slight scale (0.97 on button press), background tint shift on chips (white → `#EEF3FD`), no opacity tricks.

### Transparency & blur
- Used intentionally: iOS tab bar is `rgba(255, 255, 255, 0.78)` + 70-intensity blur. On Android this degrades to an opaque 92% white.
- Action buttons on photo/gradient backgrounds use a white 72% "glass" fill with a 45% white hairline border — readable against sky.
- Never use blur as pure decoration on a flat page.

### Layout rules
- **Tab bar** is fixed bottom, 5 tabs, icon + label, safe-area-padded (iOS: 88px, Android: 68px tall).
- **Top header** is a simple greeting bar — app name on left is not repeated; the user's name is the dominant element ("היי דניאל!").
- **Cards** extend edge-to-edge with `space-base` (16px) horizontal margin; vertical rhythm between cards is `space-md` (12px).
- **Buttons** are typically full-width within their container; secondary buttons sit *below* primaries in confirmation flows.

---

## Content fundamentals

### Tone of voice
- **Hebrew first.** Every user-facing string is real Hebrew, not translated-from-English. English words are avoided where Hebrew equivalents exist (`משתמש` not "user"; `להצטרף` not "join").
- **Second person, informal.** `אתה יכול` / `הגש לי תזכורת` — never `ניתן` or third-person passive.
- **Concrete over abstract.** "45 אנשים הצטרפו" — not "קהילה פעילה". Numbers and names, not vibes.
- **Empowering verbs:** גלה · הצטרף · פעל · דרוש · בדוק. Action-forward, not passive.
- **No legal jargon.** The user is not a lawyer. The word `תובענה ייצוגית` is deliberately avoided for the incubator (wrong stage of process); use `יוזמת תביעה` or `קבוצת דרישה` instead.

### Casing & punctuation
- Hebrew has no case. Status labels in the codebase use `ALL CAPS` transliterations (`SETTLEMENT_APPROVED`) but **these are internal enum values** — the user sees the Hebrew label (`פשרה אושרה`).
- Latin brand names retain their native casing ("Partner", "Shufersal" — not shouted).
- Punctuation is minimal. No exclamation marks except in celebratory micro-moments ("היי דניאל!").

### Voice examples — real strings from the app

| Surface                | Hebrew copy                                              | Tone note                    |
|------------------------|----------------------------------------------------------|------------------------------|
| Onboarding hero        | הכסף שלך מחכה, אנחנו נמצא אותו בשבילך                    | Promise + partnership        |
| Category step heading  | בחר קטגוריות שמעניינות אותך                              | Direct imperative, 2p        |
| Brand step heading     | בחר מותגים                                               | Short imperative             |
| Home greeting          | היי דניאל!                                               | Personal, warm, no "welcome" |
| Home section title     | התאמות חדשות בשבילך                                      | Benefit-first                |
| Match confidence badge | התאמה חזקה                                               | Confidence signal            |
| Empty-ish payout range | ₪ 100-300                                                | Always concrete numbers      |
| Claim status           | ממתין לאימות / הבקשה הוגשה בהצלחה / התביעה אושרה לפיצויי 150₪ | Plain Hebrew, no passive     |
| Notification body      | נמצאה התאמה חדשה. ייתכן שמגיע לך פיצוי מ-שופרסל. בדקו זכאות. | Specific + CTA baked in      |

### Emoji
- **Used sparingly** as category icons (📱 🏦 🛒 🛡️ 🍎 💻 ✈️ 🏥) in onboarding + filter chips, and inside eligibility states (📋 ⚡ ✅ ❓).
- Emoji are **functional wayfinding**, not decoration. Never in body copy, headlines, or marketing prose.
- In the UI kit we treat emoji categories as placeholders that can swap to icons if the team adds a proper icon set.

---

## Iconography

The codebase **does not ship a custom icon set**. Three icon conventions are in use:

1. **Category icons → emoji.** Onboarding categories and home filter chips use platform emoji (📱 🏦 🛒 ✈️ etc). Pros: zero asset weight, rich color. Cons: inconsistent across platforms. **Flagged for replacement** with a proper stroke set.
2. **Tab bar → emoji too** (🏠 🧭 📄 ✉️ 👤). Same limitation as above. A production cut should use a line-icon set at 1.5px weight.
3. **Brand logos → Clearbit CDN.** `BRAND_LOGOS` maps 60+ Israeli brands to `https://logo.clearbit.com/{domain}`. Falls back to 1–2 uppercase initials in a brand-colored well when the logo fails.

**Recommendation for the design system:** substitute **Lucide** (lucide.dev, 1.5px stroke, rounded caps) wherever emoji were placeholders. Lucide matches the app's rounded-soft visual language, has RTL-safe iconography (mirrorable arrow variants), and is free. See `preview/iconography.html` for the substitution map.

**Brand logo handling in UI kits:** in our recreations we ship initial-letter wells colored to each brand's primary (Shufersal red, Partner green, etc). In production the Clearbit call will hydrate these.

---

## File index

### Root
- `README.md` — this file
- `colors_and_type.css` — all design tokens as CSS variables (light + dark) + semantic classes
- `SKILL.md` — agent skill entry point (for Claude Code handoff)

### `fonts/`
Heebo + JetBrains Mono are loaded via Google Fonts import in `colors_and_type.css`. No local TTFs bundled — flagged for the user: if your team requires offline fonts, drop the TTFs into `fonts/` and swap the `@import` for `@font-face` rules.

### `assets/`
- `brand/` — app icon, adaptive icon, splash image, favicon (from `mobile/assets/`)
- `screens/` — 11 original product screenshots (2026-03-27) referenced throughout

### `preview/`
Small HTML cards registered in the Design System tab — one sub-concept per card. Groups: Colors, Type, Spacing, Components, Brand.

### `ui_kits/`
- `mobile/` — full FairTogether mobile recreation. `index.html` is a clickable prototype with onboarding, home feed, settlement detail, incubator, legal chat, profile. Components live in `ui_kits/mobile/*.jsx`.

---

## Flagged substitutions & asks

1. **Heebo via Google Fonts CDN** — app imports via `@expo-google-fonts/heebo`. We mirror the same face via CSS import. Offline? Ask the user for TTFs.
2. **Icon set is emoji-based.** UI kit uses Lucide as a cleaner fallback. Replace with the team's production set when ready.
3. **Brand logos come from Clearbit CDN** at runtime in production. In HTML previews we use initial-letter wells colored per-brand — swap to actual logo files if offline delivery is required.
4. **No dark-mode screenshots provided** — dark tokens are interpolated from the light system and codebase conventions. Worth a design review pass once real dark screens exist.

---

## How to use this system

- **Tokens:** import `colors_and_type.css` or copy the `:root` block into your project. All spacings, radii, type scale, and colors are expressed as CSS custom properties so they translate cleanly to Tamagui / NativeWind / StyleSheet.
- **Components:** see `ui_kits/mobile/` for React recreations (JSX, not production RN). Props and naming mirror the upstream `mobile/src/components/` files.
- **Screens:** each core screen in the brief has a corresponding card in the Design System tab and a live clickable state in the UI kit.
- **Agent use:** load via `SKILL.md` — see that file for instructions.
