import { scrapeCourtRegistry } from '../skills/scrapeCourtRegistry';

async function main() {
  const r = await scrapeCourtRegistry({
    dateFrom: new Date('2026-01-01'),
    dateTo:   new Date('2026-01-31'),
    brandFilterOnly: false,
    headless: true,
    maxPages: 8,
  });
  console.log('Total found:', r.totalFound, '| Extracted:', r.cases.length, '| Blocked:', r.blocked);
  r.cases.slice(0, 15).forEach(c => {
    console.log(`  ${c.caseNumber} | slug=${c.defendantSlug ?? 'NULL'} | defendant="${c.defendantName}" | court=${c.court}`);
  });
  if (r.errors.length) console.log('Errors:', r.errors.slice(0, 3));
}
main().catch(console.error).finally(() => process.exit());
