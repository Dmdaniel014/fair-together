// ─────────────────────────────────────────────────────────────────────────────
//  types.ts  —  Single source of truth for all types
//  Used by: all 5 agents, matchingEngine, db, server
//
//  Previously there were TWO conflicting type files:
//  - agentTypes.ts  (had CERTIFIED, SETTLEMENT_APPROVED, RULING)
//  - matchingEngine (had OPEN, SETTLED — different values)
//  This file merges both into one complete set.
// ─────────────────────────────────────────────────────────────────────────────

// ── Lawsuit Status ────────────────────────────────────────────────────────────
// Mirrors the Prisma LawsuitStatus enum — do not add values that don't exist in
// schema.prisma, or sorting/ranking Record<LawsuitStatus,_> will silently miss rows.
export type LawsuitStatus =
  | 'FILED'                // הוגשה — נרשמה בבית המשפט
  | 'CERTIFIED'            // אושרה — אושרה כתובענה ייצוגית
  | 'DISCOVERY'            // גילוי מסמכים
  | 'SETTLEMENT'           // פשרה בתהליך
  | 'SETTLEMENT_APPROVED'  // פשרה אושרה — ניתן להגיש תביעות
  | 'RULING'               // ניתן פסק דין
  | 'CLOSED'               // נסגר
  | 'DISMISSED'            // נדחה
  | 'GLOBAL_POTENTIAL';    // תביעה בינלאומית — פוטנציאל ישראלי

export type DataConfidence =
  | 'VERIFIED'             // אומת מול מסמך רשמי
  | 'PENDING_REVIEW'       // בבדיקת ייתכנות — confidence < 0.85
  | 'UNVERIFIED';          // לא אומת

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type ShoppingFrequency =
  | 'DAILY'
  | 'SEVERAL_TIMES_WEEK'
  | 'WEEKLY'
  | 'BI_WEEKLY'
  | 'MONTHLY';

// ── Lawsuit ───────────────────────────────────────────────────────────────────

export interface Lawsuit {
  id:                      string;
  caseNumber:              string;
  brandName:               string;
  defendants:              string[];          // brand slugs
  caseTitleEn:             string;
  caseTitleHe?:            string;
  court?:                  string;
  status:                  LawsuitStatus;
  priority:                Priority;
  isIsraeli:               boolean;
  isGlobal:                boolean;
  potentialPayout?:        string;
  estimatedPoolILS?:       number;
  classSize?:              string;
  affectedProductCategories: string[];
  summary:                 string;
  eligibilityCriteria:     string;
  claimDeadline?:          string;
  confidence:              DataConfidence;
  technicalSpecs?: {
    confidenceRating?:     number;
    globalNote?:           string;
    estimatedDuration?:    string;
    compensationFormula?:  string;
    legalBasis?:           string;
    evidenceType?:         string;
    filingJurisdiction?:   string;
  };
}

export interface LawsuitRecord extends Lawsuit {
  defendantSlug:           string;
  payoutMinILS?:           number;
  payoutMaxILS?:           number;
  totalPoolILS?:           number;
  affectedPeriodStart?:    string;
  affectedPeriodEnd?:      string;
  classSizeEstimate?:      number;
  confidenceScores:        Record<string, number>;
  rawExtraction?:          string;
  sourceUrl?:              string;
  pdfPath?:                string;
  firstSeenAt:             string;
  lastUpdatedAt:           string;
  statusHistory:           StatusChange[];
  requiresReview:          boolean;
  reviewNotes?:            string;
  isActive:                boolean;
  isReady:                 boolean;
}

export interface StatusChange {
  from:       LawsuitStatus;
  to:         LawsuitStatus;
  detectedAt: string;
  source:     'CSV' | 'PDF' | 'MANUAL';
}

// ── User ──────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id:                      string;
  selectedBrands:          string[];
  consumerCategoryPrefs:   string[];
  shoppingFrequency:       ShoppingFrequency;
  householdSize:           number;
}

// ── Matching ──────────────────────────────────────────────────────────────────

export interface MatchResult extends Lawsuit {
  relevanceScore:          number;   // 0–100 base
  matchConfidenceScore:    number;   // 0–100 weighted
  matchReasons:            string[];
  matchType:               'DIRECT_BRAND' | 'CATEGORY' | 'GLOBAL_WATCH' | 'SECTOR';
}

export interface UserMatchRecord {
  userId:                  string;
  lawsuitId:               string;
  relevanceScore:          number;
  matchConfidence:         number;
  matchReasons:            string[];
  notified:                boolean;
  notifiedAt?:             string;
  userAction?:             'JOINED' | 'DISMISSED' | 'SAVED' | 'AI_INSIGHT_VIEWED';
  userActionAt?:           string;
  feedbackScore?:          number;
}

// ── Agent Infrastructure ──────────────────────────────────────────────────────

export type AgentName =
  | 'orchestrator'
  | 'scraper'
  | 'extraction'
  | 'validation'
  | 'status_monitor'
  | 'push';

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL';

export interface AgentRun {
  id:          string;
  agent:       AgentName;
  triggeredBy: 'CRON' | 'EVENT' | 'MANUAL' | 'RETRY';
  startedAt:   string;
  finishedAt?: string;
  status:      RunStatus;
  stats:       Record<string, number>;
  errors:      AgentError[];
  retryCount:  number;
}

export interface AgentError {
  code:    string;
  message: string;
  context: Record<string, unknown>;
  at:      string;
}

export interface PushPayload {
  userId:        string;
  expoPushToken: string;
  title:         string;
  body:          string;
  data: {
    lawsuitId:   string;
    screen:      'LAWSUIT_DETAIL' | 'DASHBOARD';
    matchScore:  number;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD = 0.85;
export const MIN_MATCH_SCORE      = 50;
export const HIGH_MATCH_SCORE     = 75;
export const MAX_RETRIES          = 3;
export const SCRAPER_THROTTLE_MS  = 3000;

// ── Brand name mapping (Hebrew → slug) ───────────────────────────────────────
// Single source of truth — used by scanLegalSources and scrapeCourtRegistry
export const BRAND_NAME_MAP: Record<string, string> = {
  // Supermarkets
  'שופרסל':        'shufersal',
  'רמי לוי':       'ramilevi',
  'ויקטורי':       'victory',
  'מגה':           'mega',
  'יוחננוף':       'yohananoff',
  'אושר עד':       'osheraad',
  'טיב טעם':       'tivtaam',
  // Food manufacturers
  'תנובה':         'tnuva',
  'שטראוס':        'strauss',
  'עלית':          'elite',
  'אסם':           'osem',
  'נסטלה':         'nestle',
  'יוניליוור':     'unilever',
  'פריגת':         'prigat',
  // Telecom
  'פרטנר':         'partner',
  'סלקום':         'cellcom',
  'פלאפון':        'pelephone',
  'הוט':           'hot',
  'בזק':           'bezeq',
  'yes':           'yes',
  'גולן טלקום':    'golan',
  // Banks
  'בנק הפועלים':   'hapoalim',
  'בנק לאומי':     'leumi',
  // Health
  'כללית':         'clalit',
  'מכבי':          'maccabi',
  // Retail
  'סופר-פארם':     'superpharm',
  'פוקס':          'fox',
  'קסטרו':         'castro',
  'H&O':           'hando',
  'גולף':          'golf',
  // Insurance
  'הפניקס':        'phoenix',
  'מגדל':          'migdal',
  'הראל':          'harel',
  'כלל':           'clal',
  'מנורה':         'menora',
  'איילון':        'ayalon',
  'שירביט':        'shirbit',
  // Finance
  'ישראכרט':       'isracard',
  'לאומי קארד':    'leumi-card',
  // Airlines / Travel
  'אלעל':          'elal',
  'אל על':         'elal',     // with space — registry variant
  'אל על נתיבי אויר לישראל': 'elal',
  'אמזון':         'amazon',
  // Tech
  'אפל':           'apple',
  'גוגל':          'google',
  'מטא':           'meta',
  'וולט':          'wolt',
  'סמסונג':        'samsung',
  'samsung':       'samsung',
  'אל ג׳י':        'lg',
  'אל גי':         'lg',
  'אל ג\'י':       'lg',     // common alt-quote variant in registry
  'LG':            'lg',
  'סוני':          'sony',
  'sony':          'sony',
  'שיאומי':        'xiaomi',
  'xiaomi':        'xiaomi',
  'הואוואי':       'huawei',
  'huawei':        'huawei',
  'מיקרוסופט':     'microsoft',
  'microsoft':     'microsoft',
  'נטפליקס':       'netflix',
  'netflix':       'netflix',
  'ספוטיפיי':      'spotify',
  'spotify':       'spotify',
  'פייפאל':        'paypal',
  'paypal':        'paypal',
  'PayPal':        'paypal',
  'אייביי':        'ebay',
  'eBay':          'ebay',
  'אמזון ישראל':   'amazon',     // additional amazon variant
  'אקספדיה':       'expedia',
  'בוקינג':        'booking',
  'booking.com':   'booking',
  'AirBnB':        'airbnb',
  'אייר בי אנד בי': 'airbnb',
  'wix':           'wix',
  'ויקס':          'wix',
  'מונדיי':        'monday',
  'monday':        'monday',
  'monday.com':    'monday',
  'פייבר':         'fiverr',
  'fiverr':        'fiverr',
  'אליאקספרס':     'aliexpress',
  'AliExpress':    'aliexpress',
  // Auto / Vehicles
  'טויוטה':        'toyota',
  'יונדאי':        'hyundai',
  'מאזדה':         'mazda',
  'ניסאן':         'nissan',
  'הונדה':         'honda',
  'קיה':           'kia',
  'מיצובישי':      'mitsubishi',
  'סוזוקי':        'suzuki',
  'פולקסווגן':     'volkswagen',
  'סקודה':         'skoda',
  'סיאט':          'seat',
  'BMW':           'bmw',
  'ב.מ.וו':        'bmw',
  'מרצדס':         'mercedes',
  'מרצדס בנץ':     'mercedes',
  'אאודי':         'audi',
  'audi':          'audi',
  'יוניון מוטורס': 'union-motors',
  'קרסו':          'carasso',
  'דלק רכב':       'delek-motors',
  'קולמוביל':      'colmobil',
  'מאיר':          'meir-cars',         // Meir cars — auto importer
  'לובינסקי':      'lubinski',          // Mitsubishi importer
  'טלקאר':         'telcar',            // Hyundai importer
  // Fashion / Retail
  'IKEA':          'ikea',
  'איקאה':         'ikea',
  'ZARA':          'zara',
  'זארה':          'zara',
  'H&M':           'hm',
  'נייקי':         'nike',
  'nike':          'nike',
  'אדידס':         'adidas',
  'adidas':        'adidas',
  'מנגו':          'mango',
  'mango':         'mango',
  'דקתלון':        'decathlon',
  'דקטלון':        'decathlon',
  'רנואר':         'renuar',
  'אמריקן איגל':   'american-eagle',
  'TerminalX':     'terminalx',
  'מקס סטוק':      'maxstock',
  'דרבי':          'derbi',
  'אופיס דיפו':    'office-depot',
  'נייצ׳רס פלייס': 'natures-place',
  'KSP':           'ksp',
  'באג':           'bug',
  'ZAP':           'zap',
  'זאפ':           'zap',
  'iHerb':         'iherb',
  'אייהרב':        'iherb',
  // Food chains
  'מקדונלדס':      'mcdonalds',
  'בורגר קינג':    'burgerking',
  'KFC':           'kfc',
  'דומינוס':       'dominos',
  'פיצה האט':      'pizzahut',
  'ארומה':         'aroma',
  'קופיקס':        'cofix',
  'קפה גרג':       'greg',
  'גרג':           'greg',
  'קפה לנדוור':    'landwer',
  'לחם ארז':       'erez',
  'ויסוצקי':       'wissotzky',
  'תה ויסוצקי':    'wissotzky',
  // Transport
  'אגד':           'egged',
  'דן':            'dan-bus',
  'מטרופולין':     'metropolin',
  'רכבת ישראל':    'israel-railways',
  'נתיב אקספרס':   'nativ-express',
  'קווים':         'kavim',
  'אפיקים':        'afikim',
  // Health / Pharma
  'מאוחדת':        'meuhedet',
  'לאומית':        'leumit-health',
  'טבע':           'teva',
  'ניאופרם':       'neopharm',
  'סופרפארם':      'superpharm',        // alt spelling without dash
  'שטראוס בריאות': 'strauss',           // already mapped via 'שטראוס'
  // Lottery / Sports
  'טוטו':          'toto',
  'מפעל הפיס':     'mifal-hapayis',
  'הפיס':          'mifal-hapayis',
  // Banks (additions)
  'בנק יהב':       'yahav',
  'בנק ירושלים':   'jerusalem-bank',
  'בנק אגוד':      'igud',
  'בנק אוצר החייל': 'otzar-hahayal',
  'בנק מסד':       'masad',
  // Insurance (additions)
  'הכשרה':         'hachshara',
  'AIG':           'aig',
  'aig':           'aig',
  // E-commerce / Marketplaces
  'גרופון':        'groupon',
  'groupon':       'groupon',
  // Energy & Utilities (additions)
  'טן':            'ten-fuel',
  'אלון':          'alon-fuel',
  'גזית':          'gazit',
  // Media / Streaming
  'דיסני':         'disney',
  'disney':        'disney',
  'HOT':           'hot',     // english variant for existing slug
  'yes plus':      'yes',
  // ── Importers → brand mapping (many-to-one) ─────────────────────────────
  // Israeli importers often sued instead of the brand they distribute
  'דיפלומט':       'diplomat',     // Gillette, Oral-B, Braun, P&G products
  'שסטוביץ':       'schestowitz',  // Colgate, Palmolive, Sanex
  'S. Schestowitz': 'schestowitz',
  'נורדיה':        'nordiya',      // Philips, Samsung small appliances
  'אלקטרה מוצרי צריכה': 'electra', // Electra consumer products
  'סנו':           'sano',         // cleaning products
  'ריקיט':         'reckitt',      // Finish, Vanish, Dettol, Durex
  'שופרא':         'shufra',       // Oréal, Garnier distributor
  'לוריאל':        'loreal',       // L'Oréal Israel
  "L'Oréal":       'loreal',
  'נוגה':          'noga',         // ice cream importer (Magnum, Ben & Jerry's)
  'פרוקטר':        'procter',      // Procter & Gamble Israel
  'P&G':           'procter',
  'קימברלי':       'kimberly',     // Huggies, Kotex
  'הנקל':          'henkel',       // Persil, Schwarzkopf
  'כללי':          'general',      // placeholder for other importers
  'ביטוח ישיר':    'bituach-yashir',
  'דלק':           'delek',        // Delek energy & gas
  'פז':            'paz',          // Paz fuel
  'סונול':         'sonol',        // Sonol fuel
  'דור אלון':      'doralon',      // Dor-Alon fuel
  'רשת':           'reshet',       // Reshet media
  'חברת החשמל':    'iec',          // Israel Electric Corp
  'מקורות':        'mekorot',      // Mekorot water
  'עיריית':        'iriya',        // municipalities
  'עירית':         'iriya',        // common spelling variant (single yod)
  'מדינת ישראל':   'medina',       // state defendant
  'חברת דואר ישראל': 'israel-post',
  'דואר ישראל':    'israel-post',
  'יינות ביתן':    'yeinot-bitan', // supermarket chain
  'די בי אס שרותי לווין': 'yes',   // DBS = yes parent company
  'די.בי.אס. שרותי לווין': 'yes',
  'כל בו חצי חינם': 'hatzi-hinam', // discount retail chain
  'חצי חינם':      'hatzi-hinam',
  'כרטיסי אשראי לישראל': 'kal',    // CAL credit card variant
  'בנק דיסקונט':   'discount',     // Discount bank
  'בנק מזרחי':     'mizrahi',      // Mizrahi-Tefahot bank
  'הבנק הבינלאומי': 'fibi',        // First International Bank
  'כאל':           'cal',          // Cal credit card
  'מקס':           'max',          // Max (Leumi Card)
  'ביג':           'big',          // Big shopping centers
  'עזריאלי':       'azrieli',      // Azrieli malls
  'גט':            'gett',         // Gett taxi
  'יאנגו':         'yango',        // Yango taxi
};

// ── Settlement Categories ────────────────────────────────────────────────────
// 7 simple categories for Phase 1 — replaces brand-level matching
export const SETTLEMENT_CATEGORIES = {
  telecom:   { he: 'תקשורת',   icon: '📱' },
  banks:     { he: 'בנקים',    icon: '🏦' },
  retail:    { he: 'קמעונאות', icon: '🛒' },
  insurance: { he: 'ביטוח',    icon: '🛡️' },
  food:      { he: 'מזון',     icon: '🍎' },
  tech:      { he: 'טכנולוגיה', icon: '💻' },
  transport: { he: 'תחבורה',   icon: '✈️' },
  health:    { he: 'בריאות',   icon: '🏥' },
  other:     { he: 'אחר',      icon: '📋' },
} as const;

export type SettlementCategory = keyof typeof SETTLEMENT_CATEGORIES;

// Map brand slugs → category
export const BRAND_TO_CATEGORY: Record<string, SettlementCategory> = {
  // Telecom
  partner: 'telecom', cellcom: 'telecom', pelephone: 'telecom',
  hot: 'telecom', bezeq: 'telecom', yes: 'telecom', golan: 'telecom',
  // Banks & Finance
  hapoalim: 'banks', leumi: 'banks', isracard: 'banks', 'leumi-card': 'banks',
  // Retail
  shufersal: 'retail', ramilevi: 'retail', victory: 'retail', mega: 'retail',
  yohananoff: 'retail', osheraad: 'retail', tivtaam: 'retail',
  superpharm: 'retail', fox: 'retail', castro: 'retail', hando: 'retail', golf: 'retail',
  // Insurance
  phoenix: 'insurance', migdal: 'insurance', harel: 'insurance',
  clal: 'insurance', menora: 'insurance', ayalon: 'insurance', shirbit: 'insurance',
  // Food
  tnuva: 'food', strauss: 'food', elite: 'food', osem: 'food',
  nestle: 'food', unilever: 'food', prigat: 'food',
  // Tech
  apple: 'tech', google: 'tech', meta: 'tech', amazon: 'tech', wolt: 'tech',
  samsung: 'tech', lg: 'tech', sony: 'tech', xiaomi: 'tech', huawei: 'tech',
  microsoft: 'tech', netflix: 'tech', spotify: 'tech', paypal: 'tech',
  ebay: 'tech', expedia: 'tech', booking: 'tech', airbnb: 'tech',
  wix: 'tech', monday: 'tech', fiverr: 'tech', aliexpress: 'tech',
  iherb: 'tech', groupon: 'tech', disney: 'tech',
  // Health
  clalit: 'health', maccabi: 'health',
  meuhedet: 'health', 'leumit-health': 'health',
  teva: 'health', neopharm: 'health',
  // (superpharm intentionally lives under 'retail' above — it's a chain)
  // Transport
  elal: 'transport', gett: 'transport', yango: 'transport',
  toyota: 'transport', hyundai: 'transport', mazda: 'transport',
  nissan: 'transport', honda: 'transport', kia: 'transport',
  mitsubishi: 'transport', suzuki: 'transport', volkswagen: 'transport',
  skoda: 'transport', seat: 'transport', bmw: 'transport',
  mercedes: 'transport', audi: 'transport',
  'union-motors': 'transport', carasso: 'transport',
  'delek-motors': 'transport', colmobil: 'transport',
  'meir-cars': 'transport', lubinski: 'transport', telcar: 'transport',
  egged: 'transport', 'dan-bus': 'transport', metropolin: 'transport',
  'israel-railways': 'transport', 'nativ-express': 'transport',
  kavim: 'transport', afikim: 'transport',
  'ten-fuel': 'transport', 'alon-fuel': 'transport',
  // Importers & Distributors → mapped to product category
  diplomat: 'retail', schestowitz: 'retail', nordiya: 'retail',
  shufra: 'retail', loreal: 'retail', noga: 'food',
  procter: 'retail', kimberly: 'retail', henkel: 'retail',
  sano: 'retail', reckitt: 'retail', general: 'other',
  // Energy & Utilities
  delek: 'transport', paz: 'transport', sonol: 'transport', doralon: 'transport',
  iec: 'other', mekorot: 'other', iriya: 'other',
  // Banks & Finance (new)
  discount: 'banks', mizrahi: 'banks', fibi: 'banks',
  cal: 'banks', max: 'banks', 'bituach-yashir': 'insurance',
  // Real estate & Malls
  big: 'retail', azrieli: 'retail',
  // Fashion / extra retail
  ikea: 'retail', zara: 'retail', hm: 'retail', nike: 'retail',
  adidas: 'retail', mango: 'retail', decathlon: 'retail', renuar: 'retail',
  'american-eagle': 'retail', terminalx: 'retail', maxstock: 'retail',
  derbi: 'retail', 'office-depot': 'retail', 'natures-place': 'retail',
  ksp: 'retail', bug: 'retail', zap: 'retail',
  // Food chains
  mcdonalds: 'food', burgerking: 'food', kfc: 'food', dominos: 'food',
  pizzahut: 'food', aroma: 'food', cofix: 'food', greg: 'food',
  landwer: 'food', erez: 'food', wissotzky: 'food',
  // Lottery
  toto: 'other', 'mifal-hapayis': 'other',
  // Government / Public
  medina: 'other', 'israel-post': 'other',
  // Retail (additions surfaced by backfill)
  'yeinot-bitan': 'retail', 'hatzi-hinam': 'retail',
  // Banks (additions)
  yahav: 'banks', 'jerusalem-bank': 'banks', igud: 'banks',
  'otzar-hahayal': 'banks', masad: 'banks',
  // Insurance (additions)
  hachshara: 'insurance', aig: 'insurance',
  // Energy
  gazit: 'transport',
  // Media
  reshet: 'other',
  // Electra
  electra: 'retail',
};

// ── Status mapping helper ────────────────────────────────────────────────────
// Maps CSV status column (פתוח/סגור) + result column to our enum.
// Used by both scraperAgent and db seeding.
export function mapStatus(csvStatus: string, csvResult?: string): LawsuitStatus {
  // Pass-through if already in English enum format
  const passThrough: Record<string, LawsuitStatus> = {
    'FILED': 'FILED', 'CERTIFIED': 'CERTIFIED', 'DISCOVERY': 'DISCOVERY',
    'SETTLEMENT': 'SETTLEMENT', 'SETTLEMENT_APPROVED': 'SETTLEMENT_APPROVED',
    'RULING': 'RULING', 'CLOSED': 'CLOSED', 'DISMISSED': 'DISMISSED',
    'GLOBAL_POTENTIAL': 'GLOBAL_POTENTIAL',
  };
  if (passThrough[csvStatus]) return passThrough[csvStatus];

  const result = (csvResult ?? '').trim();
  const status = (csvStatus ?? '').trim();

  if (status === 'סגור') {
    if (result.includes('פשרה'))  return 'SETTLEMENT_APPROVED';
    if (result.includes('התקבל')) return 'RULING';
    if (result.includes('נדחה'))  return 'DISMISSED';
    if (result.includes('נמחק'))  return 'DISMISSED';
    return 'CLOSED';
  }
  if (status === 'פתוח' || status === '') {
    if (result.includes('פשרה'))  return 'SETTLEMENT';
    if (result.includes('התקבל')) return 'CERTIFIED';
    if (result.includes('גילוי')) return 'DISCOVERY';
    return 'FILED';
  }
  return 'FILED';
}
