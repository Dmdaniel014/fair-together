# Fair Together — מדריך הפעלה מלא
## מאפס להרצה — שלב אחר שלב

---

## חלק א׳ — מה יש לנו ואיך הכל מחובר

### מבנה הפרויקט הסופי

```
fair-together/
│
├── mobile/                    ← האפליקציה בטלפון (React Native + Expo)
│   └── src/
│       ├── screens/           ← OnboardingScreen, Dashboard
│       ├── components/        ← BrandCard, LawsuitCard, SelectionChip, GlobalAlertBanner
│       ├── theme/             ← index.ts — צבעים, פונטים, spacing (Figma-matched)
│       └── services/         ← קריאות ל-API
│
└── backend/                   ← השרת + הסוכנים (Node.js + TypeScript)
    ├── types.ts               ← טיפוסים משותפים לכולם
    ├── api/                   ← REST endpoints
    ├── agents/                ← 5 סוכנים אוטומטיים
    │   ├── scraperAgent.ts    ← מגלה תביעות חדשות (שבועי)
    │   ├── extractionAgent.ts ← חולץ שדות מ-PDF דרך Claude
    │   └── pushAgent.ts       ← מתאים + מתריע + לומד
    ├── skills/                ← יכולות ניתנות לשימוש חוזר
    │   ├── scanLegalSources.ts← CSV מתולעת המשפט + PDF מנט המשפט
    │   └── extractPdfFields.ts← Claude API + OCR
    ├── orchestrator/          ← index.ts — מנהל, מנתב, retry
    ├── services/              ← matchingEngine.ts
    ├── db/                    ← index.ts + schema.prisma + seed.json
    ├── package.json
    ├── .env.example
    └── .github/workflows/     ← agents.yml — GitHub Actions cron
```

### איך הכל זורם

```
[GitHub Actions — ראשון + רביעי 03:00]
         ↓
[Orchestrator] — מנהל הסדר
         ↓
[Scraper Agent] — CSV מתולעת המשפט
         ↓
[Extraction Agent] — PDF → Claude API → JSON
         ↓
[Validation Agent] — בדיקות + "בבדיקת ייתכנות"
         ↓
[Push Agent] — matchingEngine + Expo Push
         ↓
[טלפון המשתמש] ← התראה: "מגיע לך פיצוי משופרסל"
```

---

## חלק ב׳ — דרישות מוקדמות

### כלים להתקין:

```bash
# בדוק שיש לך (הרץ בטרמינל):
node --version      # צריך 18 ומעלה
npm --version       # צריך 9 ומעלה
git --version       # כל גרסה

# אם אין PostgreSQL:
# Mac:   brew install postgresql@15
# Linux: sudo apt install postgresql
```

### חשבונות לפתוח (כולם חינם):

| שירות | למה | קישור |
|-------|-----|-------|
| **GitHub** | שמירת קוד + cron jobs | github.com |
| **Supabase** | מסד נתונים PostgreSQL בענן | supabase.com |
| **Expo** | Push notifications לטלפון | expo.dev |
| **Anthropic** | Claude API לחילוץ PDFs | console.anthropic.com |

---

## חלק ג׳ — הכנה חד-פעמית

### שלב 1 — הורד את הקבצים מ-Claude

כל הקבצים שקיבלת — שים אותם במבנה הזה:

```bash
# צור תיקיית פרויקט
mkdir ~/Desktop/fair-together
cd ~/Desktop/fair-together

# צור מבנה תיקיות
mkdir -p mobile/src/{screens,components,theme,services,store}
mkdir -p backend/{agents,skills,orchestrator,db,api,services}
mkdir -p backend/.github/workflows
```

**העתק כל קובץ למיקומו:**

```
# BACKEND
agentTypes.ts       → backend/types.ts
db.ts               → backend/db/index.ts
schema.prisma       → backend/db/schema.prisma
seed.json           → backend/db/seed.json
matchingEngine.ts   → backend/services/matchingEngine.ts
scanLegalSources.ts → backend/skills/scanLegalSources.ts
extractPdfFields.ts → backend/skills/extractPdfFields.ts
scraperAgent.ts     → backend/agents/scraperAgent.ts
extractionAgent.ts  → backend/agents/extractionAgent.ts
pushAgent.ts        → backend/agents/pushAgent.ts
orchestrator.ts     → backend/orchestrator/index.ts
package.json        → backend/package.json
.env.example        → backend/.env.example
agents.yml          → backend/.github/workflows/agents.yml

# MOBILE
OnboardingScreen.tsx    → mobile/src/screens/OnboardingScreen.tsx
SelectionChip.tsx       → mobile/src/components/SelectionChip.tsx
LawsuitCard.tsx         → mobile/src/components/LawsuitCard.tsx
BrandCard.tsx           → mobile/src/components/BrandCard.tsx
GlobalAlertBanner.tsx   → mobile/src/components/GlobalAlertBanner.tsx
theme.ts                → mobile/src/theme/index.ts
```

---

### שלב 2 — הגדר משתני סביבה

```bash
cd ~/Desktop/fair-together/backend
cp .env.example .env
```

פתח `.env` ומלא:

```env
# מ-Supabase: Settings → Database → Connection string
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres"

# מ-console.anthropic.com
ANTHROPIC_API_KEY="sk-ant-..."

# תיקייה לאחסון PDFs זמניים
PDF_STORAGE_PATH="/tmp/fair-together-pdfs"

# מחרוזת אקראית — תוכל להריץ: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CRON_SECRET="your-secret-here"

PORT=3001
NODE_ENV=development
```

---

### שלב 3 — התקן והגדר Backend

```bash
cd ~/Desktop/fair-together/backend

# התקן חבילות
npm install

# צור את ה-Prisma client
npx prisma generate

# צור את כל הטבלאות במסד הנתונים
npx prisma migrate dev --name init

# תפריט: Enter a name for the new migration → לחץ Enter
```

**איך לוודא שזה עבד:**
```bash
npx prisma studio
# פותח דפדפן — אמור לראות את כל הטבלאות ריקות
```

---

### שלב 4 — הכנס נתוני התחלה (Seed)

```bash
# בתיקיית backend
npx ts-node db/seed.ts

# אמור לראות:
# [Seed] Inserting 15 brands...
# [Seed] Inserting 10 lawsuits...
# [Seed] Done!
```

---

### שלב 5 — הרץ Backend

```bash
npm run dev

# אמור לראות:
# [Server] Running on http://localhost:3001
# [DB] Connected ✓
```

---

### שלב 6 — הרץ Mobile

```bash
cd ~/Desktop/fair-together/mobile

# התקן Expo (פעם אחת)
npm install -g expo-cli

# התקן חבילות
npm install expo react react-native
npm install @expo-google-fonts/heebo expo-font
npm install react-native-reanimated expo-linear-gradient
npm install expo-router

# הרץ
npx expo start
```

**בטלפון:**
1. הורד **Expo Go** מה-App Store / Google Play
2. סרוק את ה-QR שמופיע בטרמינל

---

## חלק ד׳ — טסטים (בדיקה שהכל עובד)

### טסט 1 — בדוק שהשרת חי

```bash
curl http://localhost:3001/health
# תשובה צפויה: {"ok":true,"db":"connected"}
```

### טסט 2 — הרץ סוכן סריקה ידנית

```bash
npm run agent:scrape

# מה לחפש בפלט:
# [ScraperAgent] Done. New: X, PDFs: Y, Errors: Z
```

### טסט 3 — עבד את ה-Events שנוצרו

```bash
npm run agent:events

# מה לחפש:
# [Orchestrator] Processing N pending events
# [ExtractionAgent] caseXXX: VERIFIED | fields ok: 8
# [PushAgent] Lawsuit XXX: 0 sent (no users yet — זה נורמלי)
```

### טסט 4 — בדוק מה נשמר

```bash
npx prisma studio
# → Lawsuit → אמור לראות רשומות חדשות עם שדות מחולצים
```

### טסט 5 — בדוק API Matching

```bash
curl -X POST http://localhost:3001/api/matches \
  -H "Content-Type: application/json" \
  -d '{
    "selectedBrands": ["shufersal", "tnuva"],
    "categories": ["dairy", "snacks"]
  }'

# תשובה צפויה: רשימת תביעות עם match scores
```

---

## חלק ה׳ — Git: Live vs Development

### הרעיון — שלושה שכבות

```
main     ← LIVE. מה שמשתמשים רואים. אף פעם לא נוגעים ישירות.
develop  ← בדיקות. שם עושים את כל השינויים לפני שמעלים.
feature/ ← פיצ׳ר ספציפי. נוצר מ-develop, חוזר ל-develop.
```

### הגדרה ראשונית:

```bash
cd ~/Desktop/fair-together

# חבר ל-GitHub (צור repo ריק ב-github.com קודם)
git init
git remote add origin https://github.com/YOUR_USERNAME/fair-together.git

# הוסף .gitignore
echo "node_modules/\n.env\n*.pdf\ndist/" > .gitignore

# Push ראשון
git add .
git commit -m "initial commit — full Fair Together system"
git push -u origin main

# צור branch develop
git checkout -b develop
git push -u origin develop
```

### עבודה יומיומית:

**כשמתחילים עבודה חדשה עם Claude:**
```bash
git checkout develop
git pull origin develop
git checkout -b feature/שם-השיפור
# דוגמאות:
# feature/add-partner-brand
# feature/improve-pdf-extraction
# feature/new-onboarding-step
```

**כשמסיימים וכל הטסטים עברו:**
```bash
# מיזג ל-develop
git checkout develop
git merge feature/שם-השיפור
git push origin develop

# בדוק שהכל עובד ב-develop (הרץ טסטים)
npm run agent:events
curl http://localhost:3001/health

# רק אחרי שאתה בטוח — דחוף ל-LIVE
git checkout main
git merge develop
git push origin main
```

**סיכום בפשטות:**

| מה אתה עושה | Branch |
|------------|--------|
| עובד עם Claude על שיפור | `feature/שם` |
| בודק שהכל תקין | `develop` |
| מוכן → עולה LIVE | `main` |

---

## חלק ו׳ — GitHub Actions (אוטומציה מלאה)

### חד-פעמי: הגדר Secrets ב-GitHub

1. כנס ל: `github.com/YOUR_USERNAME/fair-together`
2. **Settings → Secrets and variables → Actions → New repository secret**
3. הוסף:

| Secret Name | Value |
|------------|-------|
| `API_BASE_URL` | הכתובת של ה-backend שלך ב-production |
| `CRON_SECRET` | אותו ערך שב-.env |

### לוח זמנים אוטומטי:

```
כל יום ראשון 03:00 UTC  → Scraper Agent (תביעות חדשות)
כל יום רביעי 03:00 UTC  → Status Monitor (שינויי סטטוס)
ה-1 בחודש 02:00 UTC     → Cleanup (ניקוי)
```

---

## חלק ז׳ — שגיאות נפוצות ופתרונות

| שגיאה | פתרון |
|-------|-------|
| `Cannot connect to database` | בדוק שה-DATABASE_URL נכון ב-.env |
| `Prisma client not generated` | הרץ `npx prisma generate` |
| `ANTHROPIC_API_KEY not set` | בדוק שה-key ב-.env ושאין רווחים |
| `PDF extraction failed` | התקן `pdfplumber`: `pip install pdfplumber --break-system-packages` |
| `Expo: Metro bundler failed` | הרץ `npx expo start --clear` |
| `Push notification not sent` | בדוק שה-expoPushToken תקין ב-DB |

---

## סיכום הפקודות החשובות

```bash
# Backend
npm run dev              # הרץ שרת פיתוח
npm run agent:scrape     # הרץ סריקה ידנית
npm run agent:status     # הרץ Status Monitor ידנית
npm run agent:events     # עבד events ממתינים
npx prisma studio        # ממשק ויזואלי למסד
npx prisma migrate dev   # אחרי שינוי ב-schema.prisma

# Mobile
npx expo start           # הרץ אפליקציה
npx expo start --clear   # הרץ ונקה cache

# Git
git checkout develop                    # עבור ל-develop
git checkout -b feature/FEATURE-NAME   # branch חדש
git add . && git commit -m "..."        # שמור שינויים
git push origin BRANCH-NAME            # שלח ל-GitHub
```
