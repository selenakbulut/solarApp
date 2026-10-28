import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

// Exercise the real rendered client. All API writes are intercepted; GET requests
// use the preview API so these checks never add or update persistent records.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(scriptDir, '..', '..', '.local-preview', 'workflows-results.json');
const baseUrl = (process.env.GES_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '');
async function readApi(endpoint) {
  const url = `${baseUrl}/api${endpoint}`;
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(12000) }); }
  catch (error) { throw new Error(`Fixture discovery could not reach ${url}. Start the web client and API, or set GES_WEB_URL. ${error.message}`); }
  assert.equal(response.status, 200, `Fixture discovery GET ${url} must succeed. Check the web client's /api proxy.`);
  try { return await response.json(); }
  catch { throw new Error(`Fixture discovery expected JSON from ${url}. Check the web client's /api proxy.`); }
}
// Select real existing records instead of depending on bundled database IDs.
const sites = await readApi('/sites');
assert.ok(Array.isArray(sites), 'Fixture discovery expects GET /api/sites to return an array.');
let fixture = null;
for (const site of sites) {
  const runs = await readApi(`/sites/${site.id}/forecasts`);
  assert.ok(Array.isArray(runs), `Fixture discovery expects the forecast list for site ${site.id} to be an array.`);
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
const secondSite = sites.find(site => site.id !== selectedSite?.id);
const forecastFixture = fixture?.result;
const mockCreatedSiteId = Math.max(0, ...sites.map(site => site.id)) + 1;

function pageUrl(route) {
  const url = new URL(baseUrl);
  url.searchParams.set('page', route);
  if (selectedSite) url.searchParams.set('site', selectedSite.id);
  if (route === 'forecasts' && forecastFixture) url.searchParams.set('run', forecastFixture.run.id);
  return url.href;
}

function utcForLocalHour(local, timezone) {
  const [year, month, day, hour, minute] = local.match(/\d+/g).map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const clock = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    instant += wallTime - Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  }
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const runtimeErrors = [];
const blockedUnexpectedWrites = [];

function panel(page, title) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function settle(page) { await page.waitForLoadState('networkidle'); }
async function navigate(page, route) {
  await page.goto(pageUrl(route));
  await page.getByRole('heading', { name: route === 'actuals' ? 'Gerçek üretim' : route === 'sites' ? 'Santraller' : 'Üretim tahmini', exact: true }).waitFor();
  await settle(page);
}
async function upload(page, name, data, mimeType = 'text/csv') {
  await page.getByLabel('CSV veya Excel üretim dosyası seç', { exact: true }).setInputFiles({ name, mimeType, buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  await page.getByRole('heading', { name: 'Verileri eşleştirin', exact: true }).waitFor();
}
async function test(name, fn, { requiresSite = true, requiresForecast = false, requiresTwoSites = false } = {}) {
  const reason = requiresSite && !selectedSite ? 'No existing site is available.'
    : requiresForecast && !forecastFixture ? 'No existing saved forecast with hourly data is available.'
    : requiresTwoSites && !secondSite ? 'Two existing sites are required to check multi-site mapping.' : null;
  if (reason) { checks.push({ name, skipped: true, reason }); console.log(`SKIP ${name}: ${reason}`); return; }
  const started = Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const handlers = new Map();
  const writes = [];
  const testErrors = [];
  page.on('pageerror', error => { testErrors.push(error.message); runtimeErrors.push({ name, error: error.message }); });
  await context.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname.replace(/^\/api/, '')}`;
    const body = request.postDataJSON();
    writes.push({ key, body });
    const handler = handlers.get(key);
    if (!handler) {
      blockedUnexpectedWrites.push({ name, key, body });
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'QA guard: unexpected write blocked.' }) });
    }
    const response = await handler(body);
    return route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  const evidence = {};
  try {
    await fn({ page, writes, evidence, intercept: (method, route, handler) => handlers.set(`${method} ${route}`, handler) });
    assert.deepEqual(testErrors, [], 'No browser runtime errors');
    checks.push({ name, pass: true, durationMs: Date.now() - started, evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, pass: false, durationMs: Date.now() - started, error: error.message, evidence });
    console.log(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}

try {
  await test('Actual CSV: MWh, start labels, confirmation, safe sort/pagination, single submit', async ({ page, writes, intercept, evidence }) => {
    intercept('POST', '/actuals/import', body => ({ body: { saved_rows: body.rows.length, timestamp_semantics: 'interval_end' } }));
    await navigate(page, 'actuals');
    const data = 'time;energy\n' + Array.from({ length: 12 }, (_, hour) => `2026-10-20T${String(hour).padStart(2, '0')}:00;1.5`).join('\n');
    await upload(page, 'workflow-mwh-start.csv', data);
    await page.getByLabel(/^Dosyadaki enerji birimi/).selectOption('MWh');
    await page.getByLabel(/^Dosyadaki saat etiketi/).selectOption('start');
    const preview = panel(page, 'Kaydedilecek üretim');
    await preview.getByRole('cell', { name: '1.500', exact: true }).first().waitFor();
    assert.match(await preview.getByRole('row').nth(1).innerText(), /01:00/);
    const submit = preview.getByRole('button', { name: 'Gerçek üretimi kaydet', exact: true });
    assert.equal(await submit.isDisabled(), true, 'Save requires explicit confirmation');
    await page.getByLabel('Saha eşleştirmelerini, enerji birimini ve saat anlamını kontrol ettim.', { exact: true }).check();
    assert.equal(await submit.isEnabled(), true);
    await preview.getByRole('button', { name: 'Saat bitişi', exact: true }).click();
    await preview.getByRole('button', { name: 'Saat bitişi', exact: true }).click();
    await preview.getByRole('button', { name: 'Sonraki sayfa', exact: true }).click();
    await settle(page);
    assert.equal(writes.length, 0, 'Sorting and pagination must never submit the import form');
    assert.equal(await submit.isEnabled(), true);
    await submit.click();
    await preview.getByText(/12 üretim kaydı kaydedildi/).waitFor();
    assert.equal(writes.length, 1);
    const payload = writes[0].body;
    assert.equal(payload.timestamp_label, 'start');
    assert.equal(payload.rows.length, 12);
    assert.equal(payload.rows[0].production_time, '2026-10-20T00:00:00', 'Payload keeps the original label; backend adds one hour');
    assert.equal(payload.rows[0].actual_energy_kwh, 1500);
    assert.equal(payload.rows[0].site_id, selectedSite.id);
    assert.equal(await submit.isDisabled(), true, 'Confirmation resets after success');
    evidence.payload = payload;
    evidence.previewHour = '01:00';
    evidence.accidentalWritesAfterTableControls = 0;
  });

  await test('Actual CSV rejects negative production without writing', async ({ page, writes, evidence }) => {
    await navigate(page, 'actuals');
    await upload(page, 'negative.csv', 'time;energy\n2026-10-20T15:00;-1\n');
    await page.getByText(/1\. veri satırı: Üretim sonlu ve negatif olmayan/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Gerçek üretimi kaydet', exact: true }).count(), 0);
    assert.equal(writes.length, 0);
    evidence.validation = 'Negative production blocks the preview and save action.';
  });

  await test('Actual CSV rejects duplicate canonical site/hour without writing', async ({ page, writes, evidence }) => {
    await navigate(page, 'actuals');
    const utc = utcForLocalHour('2026-10-20T15:00', selectedSite.timezone);
    await upload(page, 'duplicate.csv', `time;energy\n2026-10-20T15:00;1\n${utc};2\n`);
    await page.getByText(/Aynı santral ve saat dosyada birden fazla kez bulunuyor/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Gerçek üretimi kaydet', exact: true }).count(), 0);
    assert.equal(writes.length, 0);
    evidence.validation = `15:00 local and ${utc} resolve to the same ${selectedSite.timezone || 'Europe/Istanbul (legacy UI fallback)'} hour and are rejected.`;
  });

  await test('Actual XLSX parses an Excel date cell and submits normalized data', async ({ page, writes, intercept, evidence }) => {
    intercept('POST', '/actuals/import', body => ({ body: { saved_rows: body.rows.length } }));
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Tarih', 'Üretim'], [46315.625, 25.5]]);
    sheet.A2.z = 'yyyy-mm-dd hh:mm';
    XLSX.utils.book_append_sheet(book, sheet, 'Üretim');
    const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    await navigate(page, 'actuals');
    await upload(page, 'workflow.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const preview = panel(page, 'Kaydedilecek üretim');
    await preview.getByRole('cell', { name: '25,5', exact: true }).waitFor();
    assert.match(await preview.getByRole('row').nth(1).innerText(), /15:00/);
    await page.getByLabel('Saha eşleştirmelerini, enerji birimini ve saat anlamını kontrol ettim.', { exact: true }).check();
    await preview.getByRole('button', { name: 'Gerçek üretimi kaydet', exact: true }).click();
    await preview.getByText(/1 üretim kaydı kaydedildi/).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.rows[0].production_time, '2026-10-20T15:00:00');
    assert.equal(writes[0].body.rows[0].actual_energy_kwh, 25.5);
    evidence.payload = writes[0].body;
  });

  await test('Actual Windows-1254 CSV preserves Turkish headers', async ({ page, writes, evidence }) => {
    await navigate(page, 'actuals');
    const bytes = Buffer.concat([Buffer.from('Tarih;'), Buffer.from([0xdc]), Buffer.from('retim\n20.10.2026 15:00;5\n')]);
    await upload(page, 'turkish-cp1254.csv', bytes);
    await page.getByText(/2 sütun \/ Windows-1254/).waitFor();
    assert.equal(await page.getByLabel(/^Üretim sütunu/).inputValue(), 'Üretim');
    await panel(page, 'Kaydedilecek üretim').getByRole('cell', { name: '5', exact: true }).waitFor();
    assert.equal(writes.length, 0);
    evidence.encoding = 'Windows-1254';
  });

  await test('Actual multi-site mapping rejects collisions and keeps site IDs', async ({ page, writes, intercept, evidence }) => {
    intercept('POST', '/actuals/import', body => ({ body: { saved_rows: body.rows.length } }));
    await navigate(page, 'actuals');
    await upload(page, 'multi-site.csv', 'time;energy;saha\n2026-10-20T15:00;100;Bölge A\n2026-10-20T15:00;200;Bölge B\n');
    await page.getByLabel(/^Saha sütunu/).selectOption('saha');
    await page.getByText(/Dosyadaki her saha adını kayıtlı bir santralle eşleştirin/).waitFor();
    await page.getByLabel(/^Bölge A/).selectOption(String(selectedSite.id));
    await page.getByLabel(/^Bölge B/).selectOption(String(selectedSite.id));
    await page.getByText(/Farklı saha adları aynı santrale eşleştirilemez/).waitFor();
    assert.equal(writes.length, 0);
    await page.getByLabel(/^Bölge B/).selectOption(String(secondSite.id));
    const preview = panel(page, 'Kaydedilecek üretim');
    await preview.getByRole('cell', { name: secondSite.name, exact: true }).waitFor();
    await page.getByLabel('Saha eşleştirmelerini, enerji birimini ve saat anlamını kontrol ettim.', { exact: true }).check();
    await preview.getByRole('button', { name: 'Gerçek üretimi kaydet', exact: true }).click();
    await preview.getByText(/2 üretim kaydı kaydedildi/).waitFor();
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].body.rows.map(row => row.site_id), [selectedSite.id, secondSite.id]);
    evidence.payload = writes[0].body;
  }, { requiresTwoSites: true });

  await test('Site creation validates DC/AC ratio and sends complete numeric inputs', async ({ page, writes, intercept, evidence }) => {
    intercept('POST', '/sites', body => ({ status: 201, body: { ...body, id: mockCreatedSiteId } }));
    await navigate(page, 'sites');
    if (!await page.getByRole('heading', { name: 'Yeni santral', exact: true }).count()) await page.getByRole('button', { name: 'Santral ekle', exact: true }).click();
    const create = panel(page, 'Yeni santral');
    await create.getByLabel('Santral adı', { exact: true }).fill('QA Santrali');
    await create.getByLabel(/^Montaj tipi/).selectOption('Çatı');
    await create.getByLabel('Toplam AC güç (kW)', { exact: true }).fill('100');
    await create.getByRole('button', { name: 'Santrali kaydet', exact: true }).click();
    await create.getByRole('alert').filter({ hasText: 'DC/AC oranı' }).waitFor();
    assert.equal(writes.length, 0);
    await create.getByLabel('Toplam AC güç (kW)', { exact: true }).fill('8');
    await create.getByRole('button', { name: 'Santrali kaydet', exact: true }).click();
    await page.getByText('QA Santrali santrali eklendi.', { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].body, { latitude: 39.9334, longitude: 32.8597, panel_count: 20, panel_power_wp: 500, ac_power_kw: 8, tilt: 20, azimuth: 0, site_age_years: 0, name: 'QA Santrali', mounting_type: 'Çatı', elevation: null, timezone: null });
    evidence.payload = writes[0].body;
    evidence.invalidRatioWrites = 0;
  }, { requiresSite: false });

  await test('Loss form requires confirmation and converts all nine percentages to ratios', async ({ page, writes, intercept, evidence }) => {
    intercept('PUT', `/sites/${selectedSite.id}/losses`, body => ({ body: { site_id: selectedSite.id, losses: body } }));
    await navigate(page, 'sites');
    const losses = panel(page, `${selectedSite.name} kayıp katsayıları`);
    await losses.getByLabel('Kirlenme (%)', { exact: true }).waitFor();
    const labels = ['Kirlenme', 'Yansıma / geliş açısı', 'Panel uyumsuzluğu', 'DC kablo', 'AC kablo', 'Trafo', 'Gölgelenme', 'Kullanılabilirlik', 'Kar'];
    for (const label of labels) await losses.getByLabel(`${label} (%)`, { exact: true }).fill('2.5');
    const save = losses.getByRole('button', { name: 'Kayıpları kaydet', exact: true });
    assert.equal(await save.isDisabled(), true);
    await losses.getByLabel('Kayıp değerlerini kontrol ettim.', { exact: true }).check();
    await save.click();
    await page.getByText(`${selectedSite.name} için kayıp katsayıları kaydedildi. Yeni tahminlerde kullanılacak.`, { exact: true }).first().waitFor();
    assert.equal(writes.length, 1);
    assert.equal(Object.keys(writes[0].body).length, 9);
    assert.ok(Object.values(writes[0].body).every(value => value === 0.025));
    evidence.payload = writes[0].body;
  });

  await test('Forward forecast sends advanced parameters and percentage coefficient', async ({ page, writes, intercept, evidence }) => {
    intercept('POST', '/forecasts', () => ({ status: 201, body: forecastFixture }));
    await navigate(page, 'forecasts');
    await page.getByRole('button', { name: 'Yeni tahmin', exact: true }).click();
    const form = panel(page, 'Yeni üretim tahmini');
    await form.getByLabel(/^Tahmin aralığı/).selectOption('5');
    await form.getByLabel('Panel sayısı', { exact: true }).fill('20');
    await form.getByLabel('Panel gücü (Wp)', { exact: true }).fill('500');
    await form.getByLabel('AC güç (kW)', { exact: true }).fill('8');
    await form.getByLabel('Panel eğimi (°)', { exact: true }).fill('30');
    await form.getByLabel(/^Azimut \(°\)/).fill('-20');
    await form.getByLabel('Santral yaşı (yıl)', { exact: true }).fill('3');
    await form.getByLabel('Sıcaklık katsayısı (%/°C)', { exact: true }).fill('-0.35');
    await form.getByRole('button', { name: 'Tahmin oluştur', exact: true }).click();
    await page.getByText(`Tahmin #${forecastFixture.run.id} oluşturuldu ve kaydedildi.`, { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    const { temperature_coefficient, ...technical } = writes[0].body;
    assert.deepEqual(technical, { site_id: selectedSite.id, source: 'forecast', forecast_days: 5, panel_count: 20, panel_power_wp: 500, ac_power_kw: 8, tilt: 30, azimuth: -20, site_age_years: 3 });
    assert.ok(Math.abs(temperature_coefficient - (-0.0035)) < 1e-12);
    evidence.payload = writes[0].body;
  }, { requiresForecast: true });

  await test('Historical forecast sends the selected date range', async ({ page, writes, intercept, evidence }) => {
    intercept('POST', '/forecasts', () => ({ status: 201, body: { ...forecastFixture, metadata: { ...forecastFixture.metadata, source: 'historical' } } }));
    await navigate(page, 'forecasts');
    await page.getByRole('button', { name: 'Yeni tahmin', exact: true }).click();
    const form = panel(page, 'Yeni üretim tahmini');
    await form.getByRole('button', { name: 'Geçmiş hava ile hesaplama', exact: true }).click();
    await form.getByLabel('Başlangıç tarihi', { exact: true }).fill('2026-10-10');
    await form.getByLabel('Bitiş tarihi', { exact: true }).fill('2026-10-12');
    await form.getByText(/geçmişte yapılmış bir ileri tahmin değildir/).waitFor();
    await form.getByRole('button', { name: 'Tahmin oluştur', exact: true }).click();
    await page.getByText(`Tahmin #${forecastFixture.run.id} oluşturuldu ve kaydedildi.`, { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.source, 'historical');
    assert.equal(writes[0].body.start_date, '2026-10-10');
    assert.equal(writes[0].body.end_date, '2026-10-12');
    evidence.payload = writes[0].body;
  }, { requiresForecast: true });

  await test('Forward forecast fallback displays warning without claiming a new record', async ({ page, writes, intercept, evidence }) => {
    const warning = 'QA bağlantı uyarısı. Yeni tahmin oluşturulmadı; uyumlu eski kayıt gösteriliyor.';
    intercept('POST', '/forecasts', () => ({ body: { ...forecastFixture, is_fallback: true, warning } }));
    await navigate(page, 'forecasts');
    await page.getByRole('button', { name: 'Yeni tahmin', exact: true }).click();
    await panel(page, 'Yeni üretim tahmini').getByRole('button', { name: 'Tahmin oluştur', exact: true }).click();
    await page.getByText(warning, { exact: true }).waitFor();
    assert.equal(await page.getByText(`Tahmin #${forecastFixture.run.id} oluşturuldu ve kaydedildi.`, { exact: true }).count(), 0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.source, 'forecast');
    evidence.visibleWarning = warning;
  }, { requiresForecast: true });
} finally {
  const result = {
    baseUrl,
    fixture: selectedSite ? { siteId: selectedSite.id, secondSiteId: secondSite?.id ?? null, runId: forecastFixture?.run.id ?? null, forecastVersions: fixture?.runs.length ?? 0, hasMatchedActuals: Boolean(fixture?.comparison.metrics) } : null,
    checks, runtimeErrors, blockedUnexpectedWrites,
    summary: { passed: checks.filter(check => check.pass === true).length, failed: checks.filter(check => check.pass === false).length, skipped: checks.filter(check => check.skipped).length, persistentWrites: 0, writeProtection: 'Every non-GET /api request is intercepted and fulfilled locally; unknown writes are blocked.' },
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary, null, 2));
  await browser.close();
  if (checks.some(check => check.pass === false) || runtimeErrors.length || blockedUnexpectedWrites.length) process.exitCode = 1;
}
