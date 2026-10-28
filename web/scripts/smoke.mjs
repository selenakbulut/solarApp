import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const resultDir = path.resolve(scriptDir, '..', '..', '.local-preview');
const out = path.join(resultDir, 'screenshots');
const baseUrl = (process.env.GES_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '');

async function readApi(endpoint) {
  const url = `${baseUrl}/api${endpoint}`;
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(12000) }); }
  catch (error) { throw new Error(`Fixture discovery could not reach ${url}. Start the web client and API, or set GES_WEB_URL. ${error.message}`); }
  if (!response.ok) throw new Error(`Fixture discovery GET ${url} returned HTTP ${response.status}. Check the web client's /api proxy.`);
  try { return await response.json(); }
  catch { throw new Error(`Fixture discovery expected JSON from ${url}. Check the web client's /api proxy.`); }
}

// Only discover existing records. Tests never create production fixtures.
const sites = await readApi('/sites');
if (!Array.isArray(sites)) throw new Error('Fixture discovery expected GET /api/sites to return an array.');
let fixture = null;
for (const site of sites) {
  const runs = await readApi(`/sites/${site.id}/forecasts`);
  if (!Array.isArray(runs)) throw new Error(`Fixture discovery expected the forecast list for site ${site.id} to be an array.`);
  for (const run of runs) {
    const result = await readApi(`/forecasts/${run.id}`);
    if (!result.hourly?.length) continue;
    const comparison = await readApi(`/forecasts/${run.id}/comparison`);
    const score = (runs.length >= 2 ? 10 : 0) + (comparison.metrics ? 100 : 0);
    if (!fixture || score > fixture.score) fixture = { site, runs, result, comparison, score };
    if (score === 110) break;
  }
  if (fixture?.score === 110) break;
}
const selectedSite = fixture?.site || sites[0] || null;
const forecastMissing = fixture ? null : 'No existing site with a saved hourly forecast is available.';
function pageUrl(route) {
  const url = new URL(baseUrl);
  url.searchParams.set('page', route);
  if (selectedSite) url.searchParams.set('site', selectedSite.id);
  if (route === 'forecasts' && fixture) url.searchParams.set('run', fixture.result.run.id);
  return url.href;
}

await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', reducedMotion: 'reduce' });
const blockedUnexpectedWrites = [];
await context.route('**/api/**', route => {
  if (route.request().method() === 'GET') return route.continue();
  blockedUnexpectedWrites.push({ method: route.request().method(), url: route.request().url() });
  return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Smoke guard: unexpected API write blocked.' }) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const checks = [];
async function check(name, fn, skipReason = null) {
  if (skipReason) { checks.push({ name, skipped: true, reason: skipReason }); return; }
  try { await fn(); checks.push({ name, pass: true }); } catch (e) { checks.push({ name, pass: false, error: e.message }); }
}
async function ready() { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); }
await page.goto(pageUrl('forecasts')); await ready();
await check('Forecast populated', async () => { await page.getByRole('heading', { name: 'Saatlik üretim profili' }).waitFor(); }, forecastMissing);
await page.screenshot({ path: path.join(out, 'forecasts-desktop.png'), fullPage: true });
await check('Daily filter', async () => {
  const filter = page.getByLabel('Grafik üretim günü'); const options = await filter.locator('option').all();
  await filter.selectOption(await options[1].getAttribute('value')); await filter.selectOption('all');
}, forecastMissing || (!fixture.result.daily?.length ? 'The existing forecast has no daily summary to filter.' : null));
await check('Radiation chart toggle', async () => { await page.getByLabel('Işınımı göster').check(); await page.getByLabel('Işınımı göster').uncheck(); }, forecastMissing);
await check('Daily table', async () => { await page.getByRole('button', { name: 'Günlük', exact: true }).click(); await page.getByRole('columnheader', { name: 'Gün kapsamı' }).waitFor(); }, forecastMissing);
await check('Forecast CSV export', async () => {
  await page.locator('.export-menu summary').click();
  const pending = page.waitForEvent('download'); await page.getByRole('link', { name: 'CSV indir' }).click();
  const file = await pending; if (!file.suggestedFilename().endsWith('.csv')) throw new Error('CSV download missing');
  await page.locator('.export-menu summary').click();
}, forecastMissing);
await check('Forecast creation form switches', async () => {
  await page.getByRole('button', { name: 'Yeni tahmin', exact: true }).click();
  await page.getByRole('button', { name: 'Geçmiş hava ile hesaplama', exact: true }).click();
  await page.getByLabel('Başlangıç tarihi').waitFor();
  await page.getByRole('button', { name: 'İleri tahmin', exact: true }).click();
  await page.getByLabel('Tahmin aralığı').waitFor();
  await page.getByRole('button', { name: 'Tahmin formunu kapat' }).click();
}, !selectedSite ? 'A saved site is required to open the forecast form.' : null);
for (const [route, heading] of [['sites', 'Santraller'], ['actuals', 'Gerçek üretim'], ['comparison', 'Tahmin ne kadar doğru?'], ['scenarios', 'İki senaryo, aynı saatler']]) {
  await check(`Route ${route}`, async () => {
    await page.goto(pageUrl(route)); await ready();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    if (route === 'comparison' && fixture?.comparison.metrics) {
      await page.getByLabel('Kayıtlı tahmin', { exact: true }).selectOption(String(fixture.result.run.id));
      await page.getByRole('heading', { name: 'Tahmin ve gerçekleşen üretim', exact: true }).waitFor();
    }
    await page.screenshot({ path: path.join(out, `${route}-desktop.png`), fullPage: true });
  });
}
await check('Same scenario warning', async () => {
  const first = page.getByLabel('Birinci tahmin'); const second = page.getByLabel('İkinci tahmin');
  await second.selectOption(await first.inputValue());
  await page.getByText('Karşılaştırma için iki farklı tahmin seçin.', { exact: true }).waitFor();
}, !fixture || fixture.runs.length < 2 ? 'The selected site needs two saved forecast versions for this scenario check.' : null);
await check('Mobile responsive/menu', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl('forecasts')); await ready();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Horizontal page overflow');
  await page.screenshot({ path: path.join(out, 'forecasts-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ana menüyü aç' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Gerçek üretim' }).click(); await ready();
  await page.getByRole('heading', { name: 'Gerçek üretim', exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, 'actuals-mobile.png'), fullPage: true });
});
await check('Server failure/recovery', async () => {
  await page.route('**/api/sites', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Test bağlantı hatası' }) }));
  await page.goto(pageUrl('forecasts')); await ready(); await page.getByRole('alert').waitFor();
  await page.unroute('**/api/sites'); await page.getByRole('button', { name: 'Yeniden dene' }).click(); await ready();
  await page.getByRole('alert').waitFor({ state: 'hidden', timeout: 10000 });
});
const result = {
  baseUrl,
  fixture: selectedSite ? { siteId: selectedSite.id, runId: fixture?.result.run.id ?? null, forecastVersions: fixture?.runs.length ?? 0, hasMatchedActuals: Boolean(fixture?.comparison.metrics) } : null,
  checks, errors, blockedUnexpectedWrites,
  summary: { passed: checks.filter(c => c.pass === true).length, failed: checks.filter(c => c.pass === false).length, skipped: checks.filter(c => c.skipped).length, persistentWrites: 0 },
};
console.log(JSON.stringify(result, null, 2));
await fs.writeFile(path.join(resultDir, 'smoke-results.json'), JSON.stringify(result, null, 2));
await browser.close();
if (checks.some(c => c.pass === false) || errors.length || blockedUnexpectedWrites.length) process.exitCode = 1;
