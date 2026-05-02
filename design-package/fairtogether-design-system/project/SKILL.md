---
name: fairtogether-design
description: Use this skill to generate well-branded interfaces and assets for FairTogether (פייר טוגדר) — an Israeli consumer-rights mobile app. RTL Hebrew-first. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping and production handoff.
user-invocable: true
---

Read the `README.md` file within this skill first — it has the full product context, visual foundations, content tone, and iconography rules. Then explore:

- `colors_and_type.css` — all design tokens as CSS variables (light + dark)
- `ui_kits/mobile/` — React JSX recreations of the mobile app
- `preview/` — small specimen cards for every token + component
- `assets/brand/` — logo, splash, adaptive icon
- `assets/screens/` — 11 original product screenshots for reference

## Critical constraints

1. **RTL first.** Every screen, component, list, and gesture is designed RTL as the default, not mirrored later. Back button on the RIGHT, forward on the LEFT. Progress bars fill right-to-left. Leading icons on the right, trailing icons on the left.
2. **Hebrew content, not translated English.** Use `אתה יכול`, not `ניתן`. Avoid legal jargon. The user is not a lawyer.
3. **Numerals are Western Arabic digits** (`₪1,200`), never Hebrew-Arabic numerals.
4. **Never use red as a dominant color.** Primary is blue `#1A56DB`; accents are emerald `#059669`. Red is strictly for destructive/danger states.
5. **Avoid `תובענה ייצוגית`** — wrong term for the pre-action incubator stage. Use `יוזמת תביעה` or `קבוצת דרישה`.

## If creating visual artifacts (slides, mocks, throwaway prototypes)

Copy assets out of this skill folder into your output directory, and create static HTML files the user can view. Import `colors_and_type.css` for tokens; copy the JSX components from `ui_kits/mobile/` as a starting point. Always scaffold in a device frame (iPhone 14 Pro sized, 390×844 logical) and set `dir="rtl"` on the root.

## If working on production code

This skill is designed for the `fair-together` Expo / React Native app. The tokens in `colors_and_type.css` mirror the runtime theme at `mobile/src/theme/index.ts` exactly — keep both in sync. Component names and prop APIs in `ui_kits/mobile/` match the upstream `mobile/src/components/` directory so translations to real React Native are straightforward.

## If the user invokes this skill without further guidance

Ask them what they want to build or design. Offer: onboarding flow, settlement card variant, incubator case, AI chat interaction, admin review, a marketing landing. Ask about Hebrew fluency of the output (do they need the real copy, or placeholder?) — then act as an expert designer who outputs HTML artifacts OR production code depending on need.
