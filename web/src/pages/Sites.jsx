import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Plus, Save, Search, Sun, X } from 'lucide-react';
import { api, number, useApi } from '../api';
import { Button, DataTable, Empty, ErrorState, Field, Loading, Notice, PageHeading, Panel } from '../components/ui';

const LOSS_FIELDS = [
  ['soiling_loss', 'Kirlenme'], ['reflection_loss', 'Yansıma / geliş açısı'],
  ['mismatch_loss', 'Panel uyumsuzluğu'], ['dc_cable_loss', 'DC kablo'],
  ['ac_cable_loss', 'AC kablo'], ['transformer_loss', 'Trafo'],
  ['shading_loss', 'Gölgelenme'], ['availability_loss', 'Kullanılabilirlik'], ['snow_loss', 'Kar'],
];
const DEFAULT_SITE = {
  name: '', latitude: 39.9334, longitude: 32.8597, panel_count: 20,
  panel_power_wp: 500, ac_power_kw: 8, tilt: 20, azimuth: 0,
  site_age_years: 0, mounting_type: 'Arazi',
};

function LossForm({ site, saved, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(LOSS_FIELDS.map(([key]) => [key, Number(((saved?.[key] || 0) * 100).toFixed(6))])));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!confirmed || busy) return;
    const invalid = LOSS_FIELDS.find(([key]) => values[key] === '' || !Number.isFinite(Number(values[key])) || Number(values[key]) < 0 || Number(values[key]) >= 100);
    if (invalid) { setError(`${invalid[1]} kaybı %0 ile %100 arasında olmalı; %100 dahil değildir.`); return; }
    setBusy(true); setError(''); setSuccess('');
    try {
      await api(`/sites/${site.id}/losses`, { method: 'PUT', body: Object.fromEntries(LOSS_FIELDS.map(([key]) => [key, Number(values[key]) / 100])) });
      setSuccess(`${site.name} için kayıp katsayıları kaydedildi. Yeni tahminlerde kullanılacak.`);
      setConfirmed(false);
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="stack">
    <Notice>{saved ? 'Sahaya özel katsayılar etkin. Değişiklikler önceki tahmin sürümlerini etkilemez.' : 'Özel katsayı kaydı bulunmuyor. Şu anda varsayılan DC %5 ve AC %2 kayıp kullanılıyor.'}</Notice>
    <div className="form-grid-3">{LOSS_FIELDS.map(([key, label]) => <Field key={key} label={`${label} (%)`}>
      <input type="number" min="0" max="99.999999" step="any" required disabled={busy} value={values[key]} onChange={event => {
        setValues(current => ({ ...current, [key]: event.target.value })); setConfirmed(false); setSuccess('');
      }} />
    </Field>)}</div>
    <p className="muted">Dokuz katsayı birlikte kaydedilir ve varsayılan toplamların yerini alır. %0 kayıp uygulanmadığı anlamına gelir.</p>
    <label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>Kayıp değerlerini kontrol ettim.</span></label>
    {error && <Notice tone="error">{error}</Notice>}
    {success && <Notice tone="success">{success}</Notice>}
    <div className="form-actions"><Button type="submit" variant="primary" loading={busy} disabled={!confirmed}><Save size={16} />Kayıpları kaydet</Button></div>
  </form>;
}

export function SitesPage({ sites = [], site, onSitesChanged }) {
  const [showCreate, setShowCreate] = useState(!sites.length);
  const [form, setForm] = useState(DEFAULT_SITE);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState(null);
  const [placeIndex, setPlaceIndex] = useState(0);
  const [location, setLocation] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lossVersion, setLossVersion] = useState(0);
  const formRef = useRef(null);
  const losses = useApi(site ? `/sites/${site.id}/losses` : null, lossVersion);
  useEffect(() => { if (!sites.length) setShowCreate(true); }, [sites.length]);
  useEffect(() => { if (showCreate) formRef.current?.focus(); }, [showCreate]);

  const setValue = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function search(event) {
    event.preventDefault();
    if (searching || query.trim().length < 2) return;
    setSearching(true); setSearchError(''); setPlaces(null);
    try {
      const found = await api(`/geocoding?name=${encodeURIComponent(query.trim())}`);
      setPlaces(found); setPlaceIndex(0);
    } catch (err) { setSearchError(err.message); } finally { setSearching(false); }
  }
  function applyPlace() {
    const selected = places?.[placeIndex];
    if (!selected) return;
    setLocation(selected);
    setForm(current => ({ ...current, latitude: selected.latitude, longitude: selected.longitude }));
  }
  async function create(event) {
    event.preventDefault();
    if (saving) return;
    setError(''); setSuccess('');
    const numericKeys = ['latitude', 'longitude', 'panel_count', 'panel_power_wp', 'ac_power_kw', 'tilt', 'azimuth', 'site_age_years'];
    if (numericKeys.some(key => form[key] === '' || !Number.isFinite(Number(form[key])))) { setError('Teknik alanları geçerli sayılarla doldurun.'); return; }
    const values = Object.fromEntries(numericKeys.map(key => [key, Number(form[key])]));
    if (!form.name.trim()) { setError('Santral adını girin.'); return; }
    if (!Number.isInteger(values.panel_count)) { setError('Panel sayısı bir tam sayı olmalı.'); return; }
    const ratio = values.panel_count * values.panel_power_wp / 1000 / values.ac_power_kw;
    if (ratio < 0.8 || ratio > 1.5 || !Number.isFinite(ratio)) { setError(`DC/AC oranı 0,8-1,5 aralığında olmalı. Girdiğiniz oran: ${number(ratio, 2)}.`); return; }
    const coordinatesMatch = location && Number(location.latitude) === values.latitude && Number(location.longitude) === values.longitude;
    setSaving(true);
    try {
      const created = await api('/sites', { method: 'POST', body: {
        ...values, name: form.name.trim(), mounting_type: form.mounting_type,
        elevation: coordinatesMatch ? location.elevation ?? null : null,
        timezone: coordinatesMatch ? location.timezone ?? null : null,
      } });
      setSuccess(`${created.name} santrali eklendi.`);
      setForm(DEFAULT_SITE); setLocation(null); setPlaces(null); setQuery(''); setShowCreate(false);
      onSitesChanged?.(created);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  const ratio = Number(form.panel_count) * Number(form.panel_power_wp) / 1000 / Number(form.ac_power_kw);

  return <div className="stack">
    <PageHeading title="Santraller" description="Portföyünüzü ve üretim hesabında kullanılan kayıpları yönetin." action={<Button variant="primary" onClick={() => setShowCreate(current => !current)} disabled={saving}>{showCreate ? <X size={17} /> : <Plus size={17} />}{showCreate ? 'Formu kapat' : 'Santral ekle'}</Button>} />
    {success && <Notice tone="success">{success}</Notice>}
    {showCreate && <Panel title="Yeni santral" description="Konumu bulun veya koordinatları doğrudan girin.">
      <div className="stack">
        <form onSubmit={search} className="form-grid">
          <Field label="Şehir veya ilçe" hint="Konum araması hava servisi kotasını kullanabilir."><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Örneğin Ankara, Gölbaşı" minLength="2" maxLength="120" disabled={searching || saving} /></Field>
          <div className="form-actions"><Button type="submit" loading={searching} disabled={query.trim().length < 2 || saving}><Search size={16} />Konumu ara</Button></div>
        </form>
        {searchError && <Notice tone="error">{searchError}</Notice>}
        {places?.length === 0 && <Notice>Konum bulunamadı. İlçe adını değiştirin veya koordinatları aşağıya girin.</Notice>}
        {places?.length > 0 && <div className="form-grid"><Field label="Bulunan konum"><select value={placeIndex} onChange={event => setPlaceIndex(Number(event.target.value))} disabled={saving}>{places.map((place, i) => <option value={i} key={i}>{[place.name, place.admin1, place.country].filter(Boolean).join(', ')}</option>)}</select></Field><div className="form-actions"><Button onClick={applyPlace} disabled={saving}><MapPin size={16} />Koordinatları kullan</Button></div></div>}
        <form onSubmit={create} className="stack">
          <Field label="Santral adı"><input ref={formRef} value={form.name} onChange={setValue('name')} placeholder="Santralinizin adı" maxLength="120" required disabled={saving} /></Field>
          <div className="form-grid-3">
            <Field label="Enlem"><input type="number" min="-90" max="90" step="any" value={form.latitude} onChange={setValue('latitude')} required disabled={saving} /></Field>
            <Field label="Boylam"><input type="number" min="-180" max="180" step="any" value={form.longitude} onChange={setValue('longitude')} required disabled={saving} /></Field>
            <Field label="Montaj tipi"><select value={form.mounting_type} onChange={setValue('mounting_type')} disabled={saving}>{['Arazi', 'Çatı', 'İzleyici'].map(type => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Panel sayısı"><input type="number" min="1" step="1" value={form.panel_count} onChange={setValue('panel_count')} required disabled={saving} /></Field>
            <Field label="Panel gücü (Wp)"><input type="number" min="0.000001" step="any" value={form.panel_power_wp} onChange={setValue('panel_power_wp')} required disabled={saving} /></Field>
            <Field label="Toplam AC güç (kW)"><input type="number" min="0.000001" step="any" value={form.ac_power_kw} onChange={setValue('ac_power_kw')} required disabled={saving} /></Field>
            <Field label="Panel eğimi (°)"><input type="number" min="0" max="90" step="any" value={form.tilt} onChange={setValue('tilt')} required disabled={saving} /></Field>
            <Field label="Azimut (°)" hint="0° Güney, −90° Doğu, +90° Batı, ±180° Kuzey"><input type="number" min="-180" max="180" step="any" value={form.azimuth} onChange={setValue('azimuth')} required disabled={saving} /></Field>
            <Field label="Santral yaşı (yıl)"><input type="number" min="0" step="any" value={form.site_age_years} onChange={setValue('site_age_years')} required disabled={saving} /></Field>
          </div>
          <div className="inline"><span className={`badge ${Number.isFinite(ratio) && ratio >= 0.8 && ratio <= 1.5 ? 'badge-green' : 'badge-amber'}`}>DC/AC oranı {number(ratio, 2)}</span><span className="muted">Geçerli aralık: 0,8-1,5</span></div>
          <p className="muted">Montaj tipi kaydedilir. Mevcut üretim modeli montaja özel soğutma veya izleyici hareketi uygulamaz.</p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="form-actions"><Button type="submit" variant="primary" loading={saving}><Save size={16} />Santrali kaydet</Button><Button type="button" onClick={() => setShowCreate(false)} disabled={saving}>Vazgeç</Button></div>
        </form>
      </div>
    </Panel>}
    <Panel title="Santral portföyü" description={`${number(sites.length, 0)} kayıtlı santral. Aktif santrali üst çubuktan seçebilirsiniz.`}>
      {sites.length ? <DataTable rows={sites} columns={['name', { key: 'dc_power_kwp', label: 'DC güç (kWp)', render: (_, row) => number(row.panel_count * row.panel_power_wp / 1000, 2) }, 'ac_power_kw', 'panel_count', 'tilt', { key: 'mounting_type', label: 'Montaj', render: value => value || 'Belirtilmedi' }]} pageSize={10} caption="Kayıtlı güneş enerji santralleri" /> : <Empty title="İlk santralinizi ekleyin" icon={Sun}>Konum ve teknik bilgileri kaydederek üretim tahminine başlayın.</Empty>}
    </Panel>
    {site && <Panel title={`${site.name} kayıp katsayıları`} description="Üretim hesabına dahil edilen dokuz kayıp kalemi.">
      {losses.loading || (losses.data && losses.data.site_id !== site.id) ? <Loading /> : losses.error ? <ErrorState error={losses.error} onRetry={losses.reload} /> : losses.data ? <LossForm key={site.id} site={site} saved={losses.data.losses} onSaved={() => { setSuccess(`${site.name} için kayıp katsayıları kaydedildi. Yeni tahminlerde kullanılacak.`); setLossVersion(value => value + 1); }} /> : null}
      <details className="details"><summary>Santralin teknik bilgileri</summary><dl className="definition-list">
        <div><dt>Konum</dt><dd>{number(site.latitude, 6)}, {number(site.longitude, 6)}</dd></div>
        <div><dt>Saat dilimi</dt><dd>{site.timezone || 'Konumdan belirlenir'}</dd></div>
        <div><dt>Panel gücü</dt><dd>{number(site.panel_power_wp)} Wp</dd></div>
        <div><dt>Azimut</dt><dd>{number(site.azimuth)}°</dd></div>
        <div><dt>Santral yaşı</dt><dd>{number(site.site_age_years)} yıl</dd></div>
      </dl></details>
    </Panel>}
  </div>;
}
