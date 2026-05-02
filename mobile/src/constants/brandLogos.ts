// ─────────────────────────────────────────────────────────────────────────────
//  constants/brandLogos.ts — Brand logo URLs via Clearbit CDN
//  Pattern: https://logo.clearbit.com/{domain}
//  No auth required. Falls back to first-letter avatar on error.
// ─────────────────────────────────────────────────────────────────────────────

// Maps defendant slug → public logo URL
export const BRAND_LOGOS: Record<string, string> = {
  // ── Supermarkets & Food Retail
  shufersal:   'https://logo.clearbit.com/shufersal.co.il',
  ramilevi:    'https://logo.clearbit.com/rami-levy.co.il',
  victory:     'https://logo.clearbit.com/victoryonline.co.il',
  mega:        'https://logo.clearbit.com/mega.co.il',
  tivtaam:     'https://logo.clearbit.com/tivtaam.co.il',
  yeinot:      'https://logo.clearbit.com/yeinotbitan.co.il',

  // ── Food & Beverage Brands
  tnuva:       'https://logo.clearbit.com/tnuva.co.il',
  strauss:     'https://logo.clearbit.com/strauss-group.com',
  osem:        'https://logo.clearbit.com/osem.co.il',
  elite:       'https://logo.clearbit.com/elite.co.il',
  nestle:      'https://logo.clearbit.com/nestle.com',
  coca_cola:   'https://logo.clearbit.com/coca-cola.com',

  // ── Telecom
  partner:     'https://logo.clearbit.com/partner.co.il',
  cellcom:     'https://logo.clearbit.com/cellcom.co.il',
  pelephone:   'https://logo.clearbit.com/pelephone.co.il',
  hot:         'https://logo.clearbit.com/hot.net.il',
  bezeq:       'https://logo.clearbit.com/bezeq.co.il',
  golan:       'https://logo.clearbit.com/golantelecom.co.il',
  '012mobile': 'https://logo.clearbit.com/012mobile.co.il',
  xphone:      'https://logo.clearbit.com/xphone.co.il',

  // ── Banks & Finance
  hapoalim:    'https://logo.clearbit.com/bankhapoalim.co.il',
  leumi:       'https://logo.clearbit.com/leumi.co.il',
  discount:    'https://logo.clearbit.com/discountbank.co.il',
  mizrahi:     'https://logo.clearbit.com/mizrahi-tefahot.co.il',
  firstint:    'https://logo.clearbit.com/fibi.co.il',
  isracard:    'https://logo.clearbit.com/isracard.co.il',
  max:         'https://logo.clearbit.com/max.co.il',
  cal:         'https://logo.clearbit.com/cal-online.co.il',
  bit:         'https://logo.clearbit.com/bit.co.il',

  // ── Health & Pharma
  clalit:      'https://logo.clearbit.com/clalit.co.il',
  maccabi:     'https://logo.clearbit.com/maccabi.co.il',
  meuhedet:    'https://logo.clearbit.com/meuhedet.co.il',
  leumit:      'https://logo.clearbit.com/leumit.co.il',
  superpharm:  'https://logo.clearbit.com/super-pharm.co.il',
  kupa:        'https://logo.clearbit.com/kupat.co.il',

  // ── Retail & Fashion
  ksp:         'https://logo.clearbit.com/ksp.co.il',
  ivory:       'https://logo.clearbit.com/ivory.co.il',
  bug:         'https://logo.clearbit.com/bug.co.il',
  castro:      'https://logo.clearbit.com/castro.co.il',
  renuar:      'https://logo.clearbit.com/renuar.co.il',
  fox:         'https://logo.clearbit.com/foxgroup.co.il',
  golf:        'https://logo.clearbit.com/golf.co.il',
  zara:        'https://logo.clearbit.com/zara.com',
  hm:          'https://logo.clearbit.com/hm.com',
  ikea:        'https://logo.clearbit.com/ikea.com',
  terminalx:   'https://logo.clearbit.com/terminalx.com',

  // ── Insurance
  hachshara:   'https://logo.clearbit.com/hachshara.co.il',
  migdal:      'https://logo.clearbit.com/migdal.co.il',
  phoenix:     'https://logo.clearbit.com/fnx.co.il',
  harel:       'https://logo.clearbit.com/harel.co.il',
  clal:        'https://logo.clearbit.com/clalbit.co.il',
  menora:      'https://logo.clearbit.com/menora.co.il',

  // ── Travel & Transport
  elal:        'https://logo.clearbit.com/elal.com',
  amsalem:     'https://logo.clearbit.com/amsalem.co.il',
  israir:      'https://logo.clearbit.com/israir.co.il',
  egged:       'https://logo.clearbit.com/egged.co.il',
  kavim:       'https://logo.clearbit.com/kavim.co.il',

  // ── Tech & Digital
  waze:        'https://logo.clearbit.com/waze.com',
  malam:       'https://logo.clearbit.com/malam-team.com',
  amdocs:      'https://logo.clearbit.com/amdocs.com',
  comverse:    'https://logo.clearbit.com/comverse.com',
};

/**
 * Returns the logo URL for a defendant slug, or null if not found.
 * The Image component should use an onError fallback to show initials.
 */
export function getBrandLogo(slug: string): string | null {
  return BRAND_LOGOS[slug] ?? null;
}

/**
 * Returns 1–2 uppercase initials from a brand display name.
 * Used as fallback when no logo is available or image fails to load.
 */
export function getBrandInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
