import React, { useState } from 'react';
import { Plus, Download, ChevronDown, X, Sun, Zap, CalendarDays, Clock3, ArrowUpRight, SlidersHorizontal, Info, MapPin, Layers3 } from 'lucide-react';
import { api, useApi, number, dateLabel, createdLabel, sourceLabel, runLabel } from '../api';
import { Button, Notice, Empty, Loading, ErrorState, Field, Panel, PageHeading, Metric, Tabs, DataTable } from '../components/ui';
import { EnergyChart } from '../components/Charts';

function localDate(offset, timezone) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: timezone || 'Europe/Istanbul' }));
  today.setDate(today.getDate() + offset);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function ForecastForm({ site, onClose, onCreated }) {
  const [source, setSource] = useState('forecast');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const body = { site_id: site.id, source, forecast_days: Number(form.get('forecast_days') || 3) };
    for (const key of ['panel_count', 'panel_power_wp', 'ac_power_kw', 'tilt', 'azimuth', 'site_age_years']) body[key] = Number(form.get(key));
    body.temperature_coefficient = Number(form.get('coefficient')) / 100;
    const ratio = body.panel_count * body.panel_power_wp / 1000 / body.ac_power_kw;
    if (ratio < 0.8 || ratio > 1.5) { setError('DC/AC oranı 0,8 ile 1,5 arasında olmalı. Panel sayısı, panel gücü ve AC gücü kontrol edin.'); return; }
    if (source === 'historical') {
      body.start_date = form.get('start_date'); body.end_date = form.get('end_date');
      if (body.start_date > body.end_date) { setError('Bitiş tarihi başlangıç tarihinden önce olamaz.'); return; }
    }
    setBusy(true);
    try { const result = await api('/forecasts', { method: 'POST', body }); onCreated(result); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Panel title="Yeni üretim tahmini" description="Bu ayarlar yalnızca yeni tahmin sürümüne uygulanır. Santral kaydı değişmez." action={<Button variant="ghost" aria-label="Tahmin formunu kapat" onClick={onClose} disabled={busy}><X size={18} /></Button>} className="forecast-form-panel">
    <form onSubmit={submit} className="stack">
      <fieldset disabled={busy} className="form-fieldset stack">
        <Tabs value={source} onChange={setSource} options={[{ value: 'forecast', label: 'İleri tahmin' }, { value: 'historical', label: 'Geçmiş hava ile hesaplama' }]} label="Hesaplama türü" />
        {source === 'forecast' ? <div className="form-grid"><Field label="Tahmin aralığı"><select name="forecast_days" defaultValue="3">{[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} gün / {n * 24} saat</option>)}</select></Field><div className="field-explanation"><CalendarDays size={20} /><p>İlk aralık yarın 00:00'da başlar. Mevcut hava önbelleği uygunsa yeniden kullanılır.</p></div></div> : <><div className="form-grid"><Field label="Başlangıç tarihi"><input type="date" name="start_date" defaultValue={localDate(-10, site.timezone)} max={localDate(-2, site.timezone)} required /></Field><Field label="Bitiş tarihi"><input type="date" name="end_date" defaultValue={localDate(-8, site.timezone)} max={localDate(-2, site.timezone)} required /></Field></div><Notice>Geçmiş hava koşullarından hesaplanır; geçmişte yapılmış bir ileri tahmin değildir. Son tamamlanmış günler arşivde henüz bulunmayabilir.</Notice></>}
        <details className="details" open><summary><SlidersHorizontal size={16} />Teknik parametreler<span>Santral değerleriyle dolduruldu</span></summary><div className="form-grid form-grid-3 details-content">
          <Field label="Panel sayısı"><input name="panel_count" type="number" min="1" step="1" defaultValue={site.panel_count || 20} required /></Field>
          <Field label="Panel gücü (Wp)"><input name="panel_power_wp" type="number" min="0.01" step="any" defaultValue={site.panel_power_wp || 500} required /></Field>
          <Field label="AC güç (kW)"><input name="ac_power_kw" type="number" min="0.01" step="any" defaultValue={site.ac_power_kw || 8} required /></Field>
          <Field label="Panel eğimi (°)"><input name="tilt" type="number" min="0" max="90" step="any" defaultValue={site.tilt ?? 20} required /></Field>
          <Field label="Azimut (°)" hint="0° Güney, −90° Doğu, +90° Batı"><input name="azimuth" type="number" min="-180" max="180" step="any" defaultValue={site.azimuth ?? 0} required /></Field>
          <Field label="Santral yaşı (yıl)"><input name="site_age_years" type="number" min="0" step="any" defaultValue={site.site_age_years || 0} required /></Field>
          <Field label="Sıcaklık katsayısı (%/°C)"><input name="coefficient" type="number" min="-2" max="0" step="0.05" defaultValue="-0.4" required /></Field>
        </div></details>
      </fieldset>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-actions"><p className="muted">Her başarılı hesaplama yeni bir sürüm olarak saklanır.</p><Button variant="primary" loading={busy} type="submit"><Zap size={16} />{busy ? 'Tahmin hesaplanıyor…' : 'Tahmin oluştur'}</Button></div>
    </form>
  </Panel>;
}

function ForecastResult({ result, site, onNavigate }) {
  const [view, setView] = useState('hourly');
  const [chartDay, setChartDay] = useState('all');
  const [radiation, setRadiation] = useState(false);
  const { run, metadata, hourly = [], daily = [] } = result;
  const total = hourly.reduce((sum, row) => sum + row.predicted_energy_kwh, 0);
  const clipping = hourly.reduce((sum, row) => sum + (row.clipping_loss_kwh || 0), 0);
  const peak = Math.max(...hourly.map(row => row.average_power_kw || 0), 0);
  const energyUnit = total >= 10000 ? 'MWh' : 'kWh';
  const energyDivisor = total >= 10000 ? 1000 : 1;
  const rows = chartDay === 'all' ? hourly : hourly.filter(row => {
    const d = new Date(row.forecast_time); d.setHours(d.getHours() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === chartDay;
  });
  const fetched = metadata.weather_fetched_at;
  const weatherAge = fetched ? (Date.now() - new Date(/Z|[+-]\d\d:\d\d$/.test(fetched) ? fetched : `${fetched}Z`).getTime()) / 3600000 : null;
  return <>
    {metadata.source === 'historical' && <Notice>Geçmiş hava koşullarından hesaplanan üretim gösteriliyor. Bu kayıt ileri tahmin başarısını temsil etmez.</Notice>}
    <div className="metrics-row forecast-metrics">
      <Metric label="Toplam üretim tahmini" value={number(total / energyDivisor, 2)} unit={energyUnit} note={`${daily.length} üretim günü için toplam`} icon={Sun} />
      <Metric label="Tepe güç" value={number(peak / (peak >= 10000 ? 1000 : 1), 2)} unit={peak >= 10000 ? 'MW' : 'kW'} note="En yüksek saatlik ortalama" icon={Zap} />
      <Metric label="Tahmin kapsamı" value={hourly.length} unit="saat" note={`${dateLabel(hourly[0]?.forecast_time)} - ${dateLabel(hourly.at(-1)?.forecast_time)}`} icon={Clock3} />
      <Metric label="Kırpma kaybı" value={number(clipping / energyDivisor, 2)} unit={energyUnit} note="AC güç sınırına bağlı kayıp" icon={Layers3} />
    </div>
    <div className="forecast-workspace">
      <Panel title="Saatlik üretim profili" description={`${dateLabel(hourly[0]?.forecast_time, { year: 'numeric' })} - ${dateLabel(hourly.at(-1)?.forecast_time, { year: 'numeric' })}`} className="chart-panel" action={<label className="compact-select"><span className="sr-only">Grafik üretim günü</span><select value={chartDay} onChange={e => setChartDay(e.target.value)}><option value="all">Tüm günler</option>{daily.map(day => <option key={day.date} value={day.date}>{dateLabel(day.date)}</option>)}</select></label>}>
        <EnergyChart data={rows} radiation={radiation} height={280} />
        <div className="chart-footnote"><span><Info size={14} />15:00 etiketi, 14:00-15:00 aralığını gösterir.</span><label className="checkbox-row"><input type="checkbox" checked={radiation} onChange={e => setRadiation(e.target.checked)} />Işınımı göster</label></div>
      </Panel>
      <Panel title="Günlük üretim" description="Üretim günü bazında özet" className="daily-panel">
        <div className="daily-list">{daily.map((day, i) => <button key={day.date} className={`daily-row ${chartDay === day.date ? 'active' : ''}`} onClick={() => setChartDay(chartDay === day.date ? 'all' : day.date)} aria-pressed={chartDay === day.date}>
          <div><span className="day-icon"><Sun size={19} /></span><div><strong>{dateLabel(day.date)}</strong><small>{day.complete_day ? '24 saat / tam gün' : `${day.hour_count} saat / kısmi gün`}</small></div></div>
          <b>{number(day.predicted_energy_kwh / energyDivisor, 1)}<small>{energyUnit}</small></b>
        </button>)}</div>
        <div className="daily-total"><span>Toplam tahmini üretim</span><strong>{number(total / energyDivisor, 2)} {energyUnit}</strong></div>
        <p className="daily-explanation">Günlük toplamlar aralık başlangıcına göre hesaplanır. 00:00 önceki güne dahildir.</p>
      </Panel>
    </div>
    <div className="result-context">
      <div className="context-site"><span className="context-icon"><MapPin size={20} /></span><div><strong>{site.name}</strong><p>{number(site.latitude, 4)}° K / {number(site.longitude, 4)}° D</p></div></div>
      <div><span>Tahminde DC güç</span><strong>{number((run.panel_count || 0) * (run.panel_power_wp || 0) / 1000, 1)} kWp</strong></div>
      <div><span>Panel eğimi / azimut</span><strong>{number(run.tilt, 0)}° / {number(run.azimuth, 0)}°</strong></div>
      <button className="text-link" onClick={() => onNavigate('sites')}>Santral ayrıntıları<ArrowUpRight size={16} /></button>
    </div>
    <Panel title="Üretim verileri" description="Saatlik sonuçları ve günlük toplamları inceleyin." action={<Tabs value={view} onChange={setView} options={[{ value: 'hourly', label: 'Saatlik' }, { value: 'daily', label: 'Günlük' }]} />}>
      <DataTable key={view} rows={view === 'hourly' ? hourly : daily} columns={view === 'hourly' ? ['forecast_time', 'predicted_energy_kwh', 'average_power_kw', 'tilted_radiation', 'temperature', 'clipping_loss_kwh'] : ['date', 'predicted_energy_kwh', 'peak_power_kw', 'clipping_loss_kwh', 'hour_count', 'complete_day']} caption={view === 'hourly' ? 'Saatlik üretim sonuçları' : 'Günlük üretim özeti'} />
    </Panel>
    <details className="details run-details"><summary><Info size={17} />Tahmin kaynağı ve model ayrıntıları<span>#{run.id}</span></summary><div className="details-content stack">
      <dl className="parameter-list"><div><dt>Hesaplama türü</dt><dd>{sourceLabel(metadata.source)}</dd></div><div><dt>Oluşturulma (Türkiye saati)</dt><dd>{createdLabel(run.created_at)}</dd></div><div><dt>Santral saat dilimi</dt><dd>{metadata.timezone || 'Eski kayıtta belirtilmedi'}</dd></div><div><dt>Hava verisi yaşı</dt><dd>{weatherAge == null || !Number.isFinite(weatherAge) ? 'Eski kayıtta belirtilmedi' : `${number(Math.max(0, weatherAge), 1)} saat`}</dd></div><div><dt>Panel sayısı / gücü</dt><dd>{number(run.panel_count, 0)} / {number(run.panel_power_wp)} Wp</dd></div><div><dt>AC güç / santral yaşı</dt><dd>{number(run.ac_power_kw)} kW / {number(run.site_age_years)} yıl</dd></div></dl>
      <Notice>{result.assumptions?.explanation || 'Bu eski tahminde varsayım kaydı yok.'}</Notice>
      <p className="muted">Model: sabit panel, NOCT 45°C, yıllık %0,5 yaşlanma. Montaja özel soğutma uygulanmıyor. Kayıtlı sürüm, hava verisinin güncel olduğunu garanti etmez.</p>
      <details className="details"><summary>Tüm saatlik ara değerler</summary><DataTable rows={hourly} caption="Tüm model ara değerleri" /></details>
      <details className="details"><summary>Kaydedilen tüm teknik parametreler</summary><pre>{JSON.stringify(run, null, 2)}</pre></details>
    </div></details>
  </>;
}

export function ForecastsPage({ site, onNavigate, revision = 0, onForecastCreated }) {
  const [formOpen, setFormOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [activeRun, setActiveRun] = useState(() => Number(new URLSearchParams(location.search).get('run')) || null);
  const [message, setMessage] = useState(null);
  const runs = useApi(site ? `/sites/${site.id}/forecasts` : null, version + revision);
  const available = runs.data || [];
  const runId = available.some(r => r.id === activeRun) ? activeRun : available[0]?.id;
  const result = useApi(runId ? `/forecasts/${runId}` : null, version);
  function selectRun(id) { setActiveRun(id); const url = new URL(location.href); url.searchParams.set('run', id); history.replaceState({}, '', url); setMessage(null); }
  function created(data) {
    setVersion(v => v + 1); selectRun(data.run.id); setFormOpen(false);
    setMessage({ tone: data.is_fallback ? 'warning' : 'success', text: data.is_fallback ? data.warning : `Tahmin #${data.run.id} oluşturuldu ve kaydedildi.` });
    onForecastCreated?.();
  }
  return <div className="stack page-content"><PageHeading title="Üretim tahmini" description="Üretimi öngörün. Her saati veriye dönüştürün." action={site && <Button variant="primary" onClick={() => setFormOpen(v => !v)} aria-expanded={formOpen}><Plus size={17} />Yeni tahmin</Button>} />
    {!site ? <Empty title="İlk santralinizle başlayın" action={<Button variant="primary" onClick={() => onNavigate('sites')}>Santral ekle</Button>}>Konum ve panel bilgilerini ekledikten sonra üretim tahmini oluşturabilirsiniz.</Empty> : <>
      {formOpen && <ForecastForm site={site} onClose={() => setFormOpen(false)} onCreated={created} />}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {runs.error ? <ErrorState error={runs.error} onRetry={runs.reload} /> : runs.loading ? <Loading /> : !available.length ? <Empty title="Henüz kayıtlı tahmin yok" action={!formOpen && <Button variant="primary" onClick={() => setFormOpen(true)}>İlk tahmini oluştur</Button>}>Santral bilgileri hazır. Bir tarih aralığı seçerek ilk üretim tahmininizi oluşturun.</Empty> : <>
        <div className="forecast-toolbar"><div className="run-selector"><Field label="Kayıtlı tahmin"><select value={runId} onChange={e => selectRun(Number(e.target.value))}>{available.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select></Field><span className="badge badge-green">{sourceLabel(available.find(r => r.id === runId)?.source)}</span></div><details className="export-menu"><summary className="button button-secondary"><Download size={16} />Dışa aktar<ChevronDown size={14} /></summary><div className="export-options"><a href={`/api/forecasts/${runId}/export?format=csv`} download>CSV indir<span>Saatlik sonuçlar</span></a><a href={`/api/forecasts/${runId}/export?format=xlsx`} download>Excel indir<span>Sonuçlar, özet ve parametreler</span></a></div></details></div>
        <div className="run-meta"><span><Clock3 size={14} />{createdLabel(available.find(r => r.id === runId)?.created_at)}</span><span>Kayıt #{runId}</span><span>{available.length} kayıtlı sürüm</span><span className="run-meta-note">Son kayıt, güncel hava garantisi değildir.</span></div>
        {result.loading ? <Loading rows={6} /> : result.error ? <ErrorState error={result.error} onRetry={result.reload} /> : result.data && <ForecastResult key={runId} result={result.data} site={site} onNavigate={onNavigate} />}
        <details className="details"><summary><Layers3 size={17} />Tüm tahmin sürümleri<span>{available.length} kayıt</span></summary><DataTable rows={available} columns={['id', 'created_at', 'source', 'tilt', 'azimuth', 'hour_count']} caption="Kayıtlı tahmin sürümleri" /></details>
      </>}
    </>}
  </div>;
}
