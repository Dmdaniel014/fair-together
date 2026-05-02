// ─────────────────────────────────────────────────────────────────────────────
//  theme.ts  —  Fair Together — Liquid Glass Design System
//  Premium glassmorphism-inspired design for Israeli consumer rights platform
//  Vibe: Apple Liquid Glass meets Israeli Fintech — translucent, depth, premium
// ─────────────────────────────────────────────────────────────────────────────

// ── Color Palette ──────────────────────────────────────────────────────────────
export const colors = {
  // ── Backgrounds
  bgPage:      '#F0F4F8',   // cool gray page base
  bgWhite:     '#FFFFFF',
  bgBlue:      '#E8F0FE',   // selected pill / chip fill
  bgGreenBadge:'#D1FAE5',
  bgAmberBadge:'#FEF3C7',
  bgSkyTop:    '#B8D4F0',   // gradient top (deeper for glass contrast)
  bgSkyMid:    '#C8DDF5',
  bgSkyBottom: '#F0F4F8',

  // ── Glass surfaces
  glass:         'rgba(255, 255, 255, 0.72)',   // primary glass fill
  glassBorder:   'rgba(255, 255, 255, 0.45)',   // glass border
  glassLight:    'rgba(255, 255, 255, 0.55)',   // lighter glass variant
  glassDark:     'rgba(255, 255, 255, 0.85)',   // more opaque glass
  glassSubtle:   'rgba(255, 255, 255, 0.35)',   // very translucent

  // ── Primary blue (richer for premium feel)
  primary:       '#1A56DB',
  primaryLight:  '#3B82F6',
  primaryDim:    '#93C5FD',
  primary50:     '#EEF3FD',   // chip selected fill (design system)
  primaryGlow:   'rgba(26, 86, 219, 0.15)',

  // ── Text
  textPrimary:   '#0F172A',  // slate-900 (deeper)
  textSecondary: '#334155',  // slate-700
  textTertiary:  '#64748B',  // slate-500
  textDisabled:  '#94A3B8',  // slate-400
  textOnPrimary: '#FFFFFF',
  textOnGlass:   '#1E293B',  // readable on glass

  // ── Semantic
  success:   '#059669',   // emerald-600 (premium green)
  successBg: '#D1FAE5',
  warning:   '#D97706',
  warningBg: '#FEF3C7',
  danger:    '#DC2626',
  dangerBg:  '#FEE2E2',

  // ── Accent & Info
  accent:    '#059669',
  info:      '#2563EB',

  // ── Surface aliases
  bg:        '#FFFFFF',
  bgCard:    'rgba(255, 255, 255, 0.72)',
  bgPanel:   '#F1F5F9',

  // ── Borders
  borderDefault: 'rgba(148, 163, 184, 0.2)',   // subtle on glass
  borderFocus:   '#1A56DB',
  borderLight:   'rgba(148, 163, 184, 0.12)',
  borderDim:     'rgba(148, 163, 184, 0.15)',

  // ── Badge: match strength
  badgeStrong:   '#059669',
  badgeStrongBg: '#D1FAE5',

  // ── Tab bar
  tabActive:   '#1A56DB',
  tabInactive: '#94A3B8',
} as const;

// ── Glass styles ──────────────────────────────────────────────────────────────
// Use these with <BlurView> or as fallback backgrounds
export const glass = {
  card: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  light: {
    backgroundColor: colors.glassLight,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  solid: {
    backgroundColor: colors.glassDark,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  tabBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.5)',
  },
  blurIntensity: 40,   // for BlurView
  blurTint: 'light' as const,
} as const;

// ── Typography ─────────────────────────────────────────────────────────────────
export const typography = {
  // Display
  displayLg: { fontFamily: 'Heebo_700Bold',     fontSize: 28, lineHeight: 38, letterSpacing: -0.5 },
  displayMd: { fontFamily: 'Heebo_700Bold',     fontSize: 22, lineHeight: 30, letterSpacing: -0.3 },

  // Headings
  h1: { fontFamily: 'Heebo_700Bold',     fontSize: 20, lineHeight: 28 },
  h2: { fontFamily: 'Heebo_600SemiBold', fontSize: 17, lineHeight: 24 },
  h3: { fontFamily: 'Heebo_600SemiBold', fontSize: 15, lineHeight: 22 },

  // Body
  bodyLg:    { fontFamily: 'Heebo_400Regular', fontSize: 15, lineHeight: 23 },
  bodyBase:  { fontFamily: 'Heebo_400Regular', fontSize: 14, lineHeight: 21 },
  bodySm:    { fontFamily: 'Heebo_400Regular', fontSize: 13, lineHeight: 19 },
  bodyMd:    { fontFamily: 'Heebo_400Regular', fontSize: 14, lineHeight: 21 },
  bodySmall: { fontFamily: 'Heebo_400Regular', fontSize: 13, lineHeight: 19 },

  // Labels / UI
  labelLg:  { fontFamily: 'Heebo_500Medium', fontSize: 15, lineHeight: 22 },
  labelMd:  { fontFamily: 'Heebo_500Medium', fontSize: 14, lineHeight: 20 },
  labelSm:  { fontFamily: 'Heebo_500Medium', fontSize: 12, lineHeight: 18 },
  labelXs:  { fontFamily: 'Heebo_500Medium', fontSize: 10, lineHeight: 14 },

  // Chips / pills
  chip: { fontFamily: 'Heebo_500Medium', fontSize: 14, lineHeight: 20 },

  // Button CTA
  button: { fontFamily: 'Heebo_600SemiBold', fontSize: 17, lineHeight: 24, letterSpacing: 0.1 },

  // Monospace-style data values
  monoLg: { fontFamily: 'Heebo_600SemiBold', fontSize: 16, lineHeight: 22 },
  monoMd: { fontFamily: 'Heebo_500Medium',   fontSize: 14, lineHeight: 20 },
  monoSm: { fontFamily: 'Heebo_500Medium',   fontSize: 12, lineHeight: 18 },
  monoXs: { fontFamily: 'Heebo_400Regular',  fontSize: 11, lineHeight: 16 },

  // Caption
  caption:   { fontFamily: 'Heebo_400Regular', fontSize: 12, lineHeight: 17 },
  stepBadge: { fontFamily: 'Heebo_500Medium',  fontSize: 13, lineHeight: 18 },
} as const;

// ── Spacing (8-pt grid) ────────────────────────────────────────────────────────
export const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   20,
  xl:   24,
  xxl:  32,
  xxxl: 48,
} as const;

// ── Border Radius — rounder for Liquid Glass feel ─────────────────────────────
export const radius = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,    // cards — rounder
  xl:   20,
  xxl:  24,
  pill: 999,
} as const;

// ── Elevation / Shadows — soft, layered for glass depth ──────────────────────
export const shadows = {
  none: {},
  card: {
    shadowColor:   '#64748B',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius:  8,
    elevation:     3,
  },
  cardRaised: {
    shadowColor:   '#64748B',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius:  12,
    elevation:     5,
  },
  button: {
    shadowColor:   '#1A56DB',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.20,
    shadowRadius:  12,
    elevation:     6,
  },
  glass: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius:  16,
    elevation:     2,
  },
  glow: {
    shadowColor:   '#1A56DB',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius:  20,
    elevation:     4,
  },
} as const;

// ── Sky gradient (premium version — deeper, more vibrant) ─────────────────────
export const skyGradient = {
  colors:    ['#89B4E8', '#A8CBEF', '#C8DDF5', '#E4EDF9', '#F0F4F8'] as const,
  locations: [0, 0.25, 0.5, 0.75, 1] as const,
  start:     { x: 0, y: 0 },
  end:       { x: 0, y: 1 },
};

// ── Step progress config ───────────────────────────────────────────────────────
export const stepProgress = {
  barHeight:   2,
  barColor:    colors.primary,
  barInactive: colors.primaryDim,
  chipBg:      colors.bgBlue,
  chipBorder:  colors.borderFocus,
  chipRadius:  radius.sm,
} as const;

// ── Status configuration ──────────────────────────────────────────────────────
export const statusConfig = {
  SETTLEMENT_APPROVED: { label: 'פשרה אושרה',     color: '#059669', bg: 'rgba(5, 150, 105, 0.12)',  priority: 1 },
  SETTLEMENT:          { label: 'בהליך פשרה',     color: '#D97706', bg: 'rgba(217, 119, 6, 0.10)',  priority: 2 },
  RULING:              { label: 'התקבלה',          color: '#2563EB', bg: 'rgba(37, 99, 235, 0.10)', priority: 3 },
  CERTIFIED:           { label: 'אושרה כייצוגית', color: '#7C3AED', bg: 'rgba(124, 58, 237, 0.10)', priority: 4 },
  FILED:               { label: 'הוגשה',           color: '#64748B', bg: 'rgba(100, 116, 139, 0.08)', priority: 5 },
  DISCOVERY:           { label: 'גילוי מסמכים',    color: '#64748B', bg: 'rgba(100, 116, 139, 0.08)', priority: 6 },
  CLOSED:              { label: 'סגור',            color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.08)', priority: 7 },
  DISMISSED:           { label: 'נדחה',            color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.08)', priority: 8 },
} as const;

// ── Brand colors (Israeli defendants — matches design system) ─────────────────
export const BRAND_COLORS: Record<string, string> = {
  'שופרסל':      '#E31019',
  'פרטנר':       '#00A651',
  'סלקום':       '#FF6600',
  'פלאפון':      '#0054A6',
  'הוט':         '#E4002B',
  'בזק':         '#003DA5',
  'רמי לוי':     '#FFD700',
  'בנק הפועלים': '#E30613',
  'בנק לאומי':   '#003DA5',
  'ביט':         '#0066FF',
  'אמזון':       '#FF9900',
  'גוגל פליי':   '#4285F4',
  'כלל':         '#003366',
  'מכבי':        '#006E3F',
  'אלעל':        '#002D82',
  'אפל':         '#000000',
  'פייסבוק':     '#1877F2',
};

export function brandColor(name: string | null | undefined): string {
  if (!name) return colors.primary;
  return BRAND_COLORS[name.trim()] || colors.primary;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1)   return 'היום';
  if (days < 7)   return `לפני ${days} ימים`;
  if (days < 30)  return `לפני ${Math.floor(days / 7)} שבועות`;
  if (days < 365) return `לפני ${Math.floor(days / 30)} חודשים`;
  const years = Math.floor(days / 365);
  return `לפני ${years} ${years === 1 ? 'שנה' : 'שנים'}`;
}

export function isStaleLawsuit(filingDate: string | null, lastUpdatedAt: string | null): boolean {
  if (!filingDate) return false;
  const oneYearAgo   = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const filed   = new Date(filingDate).getTime();
  const updated = lastUpdatedAt ? new Date(lastUpdatedAt).getTime() : 0;
  return filed < oneYearAgo && updated < sixMonthsAgo;
}

export function formatCurrency(val: string | null): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₪${(n / 1_000).toFixed(0)}K`;
  return `₪${n.toFixed(0)}`;
}
