import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Check, Download, FileSpreadsheet, RefreshCw, Save, Upload, X } from 'lucide-react';
import { api, downloadCsv, number, useApi } from '../api';
import { Button, DataTable, Empty, ErrorState, Field, Loading, Notice, PageHeading, Panel } from '../components/ui';

const pad = value => String(value).padStart(2, '0');
const MAX_ROWS = 50000;

function normalizeTimestamp(value, timezone, label, date1904 = false) {
  let text;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!parsed) throw new Error('Excel tarih değeri okunamadı.');
    text = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}T${pad(parsed.H)}:${pad(parsed.M)}:${pad(parsed.S)}`;
    if (parsed.u > 0.0001) throw new Error('Saat etiketi tam saat olmalı.');
  } else {
    text = String(value ?? '').trim();
  }
  if (!text) throw new Error('Tarih ve saat boş bırakılamaz.');
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  const local = !iso && text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?$/);
  if (!iso && !local) throw new Error('Tarih biçimi geçersiz. 2026-10-20 15:00 veya 20.10.2026 15:00 kullanın.');
  const parts = iso || local;
  const [year, month, day] = iso ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : [Number(parts[3]), Number(parts[2]), Number(parts[1])];
  const hour = Number(parts[4] || 0), minute = Number(parts[5] || 0), second = Number(parts[6] || 0);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
    throw new Error('Geçersiz gün veya saat bulundu.');
  }
  if (Number(`0.${parts[7] || 0}`) !== 0) throw new Error('Saat etiketi tam saat olmalı.');
  let zone = iso?.[8] || '';
  if (zone && zone.toUpperCase() !== 'Z') {
    zone = `${zone.slice(0, 3)}:${zone.slice(-2)}`;
    if (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(-2)) > 59) throw new Error('Saat dilimi farkı geçersiz.');
  } else if (zone) zone = 'Z';
  const payload = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${zone}`;
  let localParts = { year, month, day, hour, minute, second };
  if (zone) {
    const instant = new Date(payload);
    if (!Number.isFinite(instant.getTime())) throw new Error('Saat dilimi içeren tarih okunamadı.');
    const formatted = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    localParts = Object.fromEntries(formatted.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  }
  if (localParts.minute !== 0 || localParts.second !== 0) throw new Error('Saat etiketi santral saatinde tam saate hizalanmalı; örneğin 15:00.');
  const end = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day, localParts.hour + (label === 'start' ? 1 : 0)));
  return { payload, canonical: end.toISOString().slice(0, 16) };
}

function energyValue(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  if (!text || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('Üretim değeri geçerli bir sayı olmalı.');
  return Number(text.replace(',', '.'));
}

function tableFromMatrix(matrix) {
  const nonempty = matrix.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
  if (nonempty.length < 2) throw new Error('Dosyada bir başlık satırı ve en az bir veri satırı bulunmalı.');
  const columns = nonempty[0].map((cell, index) => String(cell ?? '').replace(/^\uFEFF/, '').trim() || `Sütun ${index + 1}`);
  if (columns.length < 2) throw new Error('Dosyada en az iki sütun bulunmalı.');
  if (new Set(columns).size !== columns.length) throw new Error('Sütun başlıkları yineleniyor. Her sütuna farklı bir ad verin.');
  const source = nonempty.slice(1);
  if (source.length > MAX_ROWS) throw new Error('Tek yüklemede en fazla 50.000 satır kaydedilebilir. Dosyayı bölerek yeniden seçin.');
  if (source.some(row => row.length > columns.length && row.slice(columns.length).some(cell => String(cell ?? '').trim()))) throw new Error('Bazı satırlarda başlıklardan fazla sütun var. Dosyanın ayıracını ve satırlarını kontrol edin.');
  return { columns, rows: source.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? '']))) };
}

async function readFile(file) {
  const buffer = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) {
    let text, encoding = 'UTF-8';
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder('windows-1254').decode(buffer); encoding = 'Windows-1254'; }
    const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
    const fatal = parsed.errors.find(error => error.code !== 'UndetectableDelimiter');
    if (fatal) throw new Error(`CSV okunamadı: ${fatal.message}`);
    return { ...tableFromMatrix(parsed.data), encoding, sheet: '' };
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error('CSV veya .xlsx uzantılı bir Excel dosyası seçin.');
  const book = XLSX.read(buffer, { type: 'array', cellDates: false });
  if (!book.SheetNames.length) throw new Error('Excel dosyasında çalışma sayfası bulunamadı.');
  const sheet = book.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: true, defval: '', blankrows: false });
  return { ...tableFromMatrix(matrix), encoding: 'Excel', sheet, sheetCount: book.SheetNames.length, date1904: Boolean(book.Workbook?.WBProps?.date1904) };
}

export function ActualsPage({ sites = [], site }) {
  const [file, setFile] = useState(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [timeColumn, setTimeColumn] = useState('');
  const [energyColumn, setEnergyColumn] = useState('');
  const [siteColumn, setSiteColumn] = useState('');
  const [mapping, setMapping] = useState({});
  const [unit, setUnit] = useState('kWh');
  const [label, setLabel] = useState('end');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [actualVersion, setActualVersion] = useState(0);
  const inputRef = useRef(null);
  const readGeneration = useRef(0);
  const actuals = useApi(site ? `/sites/${site.id}/actuals` : null, actualVersion);

  useEffect(() => { setConfirmed(false); setSaveError(''); setSuccess(''); }, [site?.id, timeColumn, energyColumn, siteColumn, mapping, unit, label, file]);
  useEffect(() => () => { readGeneration.current += 1; }, []);

  async function chooseFile(selected) {
    if (!selected || saving) return;
    const generation = ++readGeneration.current;
    setReading(true); setFile(null); setFileError(''); setSaveError(''); setSuccess(''); setConfirmed(false);
    try {
      const parsed = await readFile(selected);
      if (generation !== readGeneration.current) return;
      const time = parsed.columns.find(column => /tarih|time|date|saat/i.test(column)) || parsed.columns[0];
      const energy = parsed.columns.find(column => column !== time && /üretim|uretim|energy|enerji|kwh|mwh/i.test(column)) || parsed.columns.find(column => column !== time);
      setTimeColumn(time); setEnergyColumn(energy); setSiteColumn(''); setMapping({}); setUnit('kWh'); setLabel('end');
      setFile({ ...parsed, name: selected.name });
    } catch (err) { if (generation === readGeneration.current) setFileError(err.message || 'Dosya okunamadı. Biçimini kontrol edip tekrar seçin.'); }
    finally { if (generation === readGeneration.current) setReading(false); }
  }
  function resetFile() {
    readGeneration.current += 1;
    setFile(null); setFileError(''); setConfirmed(false); setSaveError(''); setSuccess(''); setReading(false);
    if (inputRef.current) inputRef.current.value = '';
  }
  function changeTime(value) {
    setTimeColumn(value);
    if (value === energyColumn) setEnergyColumn(file.columns.find(column => column !== value) || '');
    if (value === siteColumn) setSiteColumn('');
  }
  function changeEnergy(value) {
    setEnergyColumn(value);
    if (value === siteColumn) setSiteColumn('');
  }
  const sourceNames = useMemo(() => file && siteColumn ? [...new Set(file.rows.map(row => String(row[siteColumn] ?? '').trim()))].sort((a, b) => a.localeCompare(b, 'tr')) : [], [file, siteColumn]);
  const resolvedMapping = useMemo(() => Object.fromEntries(sourceNames.map(name => [name, mapping[name] ?? sites.find(item => item.name === name)?.id ?? ''])), [sourceNames, mapping, sites]);

  const prepared = useMemo(() => {
    if (!file || !timeColumn || !energyColumn) return { rows: [], preview: [], error: '' };
    try {
      if (!siteColumn && !site) throw new Error('Sol menüden üretim verisinin ait olduğu santrali seçin.');
      if (sourceNames.some(name => !name)) throw new Error('Dosyanın saha sütununda boş değer var. Saha adlarını tamamlayın.');
      if (sourceNames.length > sites.length) throw new Error(`Dosyada ${sourceNames.length} farklı saha adı var, ancak ${sites.length} santral kayıtlı. Önce eksik santralleri ekleyin.`);
      if (sourceNames.some(name => !resolvedMapping[name])) throw new Error('Dosyadaki her saha adını kayıtlı bir santralle eşleştirin.');
      if (new Set(Object.values(resolvedMapping).map(String)).size !== sourceNames.length) throw new Error('Farklı saha adları aynı santrale eşleştirilemez. Eşleştirmeleri kontrol edin.');
      const seen = new Set(), rows = [], preview = [];
      let total = 0;
      file.rows.forEach((row, index) => {
        try {
          const targetId = siteColumn ? Number(resolvedMapping[String(row[siteColumn] ?? '').trim()]) : site.id;
          const target = sites.find(item => item.id === targetId);
          if (!target) throw new Error('Geçerli bir santral seçin.');
          const energy = energyValue(row[energyColumn]) * (unit === 'MWh' ? 1000 : 1);
          if (!Number.isFinite(energy) || energy < 0) throw new Error('Üretim sonlu ve negatif olmayan bir sayı olmalı.');
          const timestamp = normalizeTimestamp(row[timeColumn], target.timezone, label, file.date1904);
          const key = `${targetId}/${timestamp.canonical}`;
          if (seen.has(key)) throw new Error(`Aynı santral ve saat dosyada birden fazla kez bulunuyor (${timestamp.canonical.replace('T', ' ')}).`);
          seen.add(key); total += energy;
          rows.push({ site_id: targetId, production_time: timestamp.payload, actual_energy_kwh: energy });
          if (preview.length < 100) preview.push({ name: target.name, production_time: timestamp.canonical, actual_energy_kwh: energy });
        } catch (err) { throw new Error(`${index + 1}. veri satırı: ${err.message}`); }
      });
      return { rows, preview, error: '', total };
    } catch (err) { return { rows: [], preview: [], error: err.message }; }
  }, [file, timeColumn, energyColumn, siteColumn, site, sites, sourceNames, resolvedMapping, unit, label]);

  async function save(event) {
    event.preventDefault();
    if (saving || !confirmed || !prepared.rows.length || prepared.error) return;
    setSaving(true); setSaveError(''); setSuccess('');
    try {
      const result = await api('/actuals/import', { method: 'POST', body: { timestamp_label: label, rows: prepared.rows } });
      setSuccess(`${number(result.saved_rows, 0)} üretim kaydı kaydedildi. Aynı santral ve saate ait önceki değerler güncellendi.`);
      setConfirmed(false); setActualVersion(version => version + 1);
    } catch (err) { setSaveError(err.message); } finally { setSaving(false); }
  }
  function downloadTemplate() {
    downloadCsv([{ production_time: '2026-10-20T15:00', actual_energy_kwh: 0 }], 'uretim_sablonu_ornek.csv');
  }

  return <div className="stack">
    <PageHeading title="Gerçek üretim" description="Üretim verilerinizi yükleyin, tahminlerinizi gerçek sonuçlarla doğrulayın." action={<Button onClick={downloadTemplate}><Download size={16} />CSV şablonu</Button>} />
    {!sites.length ? <Panel><Empty title="Önce bir santral ekleyin" icon={FileSpreadsheet}>Üretim verisini eşleştirmek için Santraller sayfasından ilk santralinizi oluşturun.</Empty></Panel> : <>
      <ol className="workflow-stepper" aria-label="Yükleme adımları"><li className={file ? 'complete' : 'active'} aria-current={!file ? 'step' : undefined}><span>{file ? <Check size={15} /> : '1'}</span>Dosya seçimi</li><li className={file && prepared.error ? 'active' : prepared.rows.length ? 'complete' : ''} aria-current={file && prepared.error ? 'step' : undefined}><span>{prepared.rows.length ? <Check size={15} /> : '2'}</span>Sütun eşleştirme</li><li className={prepared.rows.length ? 'active' : ''} aria-current={prepared.rows.length ? 'step' : undefined}><span>3</span>Kontrol ve kayıt</li></ol>
      <Panel title="Üretim dosyası" description="CSV veya Excel (.xlsx) dosyanızı seçin. Her satır bir saatlik üretimi temsil eder." action={file && <Button variant="ghost" onClick={resetFile} disabled={saving}><X size={16} />Dosyayı kaldır</Button>}>
        <div className="stack">
          <div className="upload-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!saving && !reading) chooseFile(event.dataTransfer.files[0]); }}>
            <Upload size={28} aria-hidden="true" />
            <div><strong>{reading ? 'Dosya okunuyor…' : file ? file.name : 'Dosyanızı buraya bırakın'}</strong><p className="muted">CSV veya XLSX. En fazla 50.000 veri satırı.</p></div>
            <label className="button button-secondary upload-input-label">{file ? 'Başka dosya seç' : 'Dosya seç'}<input ref={inputRef} className="upload-input" aria-label="CSV veya Excel üretim dosyası seç" type="file" accept=".csv,.xlsx" disabled={saving || reading} onClick={event => { event.currentTarget.value = ''; }} onChange={event => chooseFile(event.target.files[0])} /></label>
          </div>
          {reading && <Loading rows={2} />}
          {fileError && <Notice tone="error">{fileError}</Notice>}
          {file && <><div className="file-summary"><span className="badge badge-green">{number(file.rows.length, 0)} satır</span><span className="muted">{file.columns.length} sütun / {file.encoding}{file.sheet ? ` / ${file.sheet}` : ''}</span></div>{file.sheetCount > 1 && <Notice>Excel dosyasının ilk çalışma sayfası olan “{file.sheet}” okunuyor. Diğer sayfaları yüklemek için ayrı bir dosya kaydedin.</Notice>}<details className="details"><summary>Kaynak dosyayı görüntüle</summary><DataTable rows={file.rows.slice(0, 10)} columns={file.columns} caption="Dosyanın ilk on veri satırı" /></details></>}
        </div>
      </Panel>
      {file && <Panel title="Verileri eşleştirin" description="Kaynak sütunları, enerji birimini ve saat anlamını belirleyin."><div className="stack">
        <div className="form-grid-3">
          <Field label="Tarih ve saat sütunu"><select value={timeColumn} onChange={event => changeTime(event.target.value)} disabled={saving}>{file.columns.map(column => <option key={column}>{column}</option>)}</select></Field>
          <Field label="Üretim sütunu"><select value={energyColumn} onChange={event => changeEnergy(event.target.value)} disabled={saving}>{file.columns.filter(column => column !== timeColumn).map(column => <option key={column}>{column}</option>)}</select></Field>
          <Field label="Saha sütunu"><select value={siteColumn} onChange={event => { setSiteColumn(event.target.value); setMapping({}); }} disabled={saving}><option value="">Tek santral: {site?.name || 'Santral seçin'}</option>{file.columns.filter(column => column !== timeColumn && column !== energyColumn).map(column => <option key={column}>{column}</option>)}</select></Field>
          <Field label="Dosyadaki enerji birimi"><select value={unit} onChange={event => setUnit(event.target.value)} disabled={saving}><option>kWh</option><option>MWh</option></select></Field>
          <Field label="Dosyadaki saat etiketi" hint={label === 'start' ? '14:00 etiketi 14:00–15:00 aralığıdır. Kayıtta 15:00 olur.' : '15:00 etiketi 14:00–15:00 aralığıdır.'}><select value={label} onChange={event => setLabel(event.target.value)} disabled={saving}><option value="end">Saat bitişi</option><option value="start">Saat başlangıcı</option></select></Field>
          <Field label="Kayıt birimi" hint={unit === 'MWh' ? 'Dosyadaki değerler 1.000 ile çarpılarak kWh’a çevrilir.' : 'Enerji değerleri kWh olarak kaydedilir.'}><input value="kWh" readOnly /></Field>
        </div>
        {siteColumn && sourceNames.length > 0 && sourceNames.length <= sites.length && <><h3>Saha eşleştirmeleri</h3><div className="form-grid-3">{sourceNames.filter(Boolean).map(name => <Field key={name} label={name}><select value={resolvedMapping[name]} onChange={event => setMapping(current => ({ ...current, [name]: event.target.value }))} disabled={saving}><option value="">Santral seçin</option>{sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>)}</div></>}
        {prepared.error && <Notice tone="warning">{prepared.error} Hiçbir kayıt yazılmadı.</Notice>}
        {(siteColumn ? Object.values(resolvedMapping).some(id => sites.find(item => item.id === Number(id))?.timezone == null) : site?.timezone == null) && <Notice>Saat dilimi eksik eski santral kayıtlarının önizlemesinde Europe/Istanbul varsayılır. Saat dilimi içermeyen tarihler doğrudan santralin yerel saati olarak yorumlanır.</Notice>}
        <p className="muted">Saat dilimi içeren tarihler santralin saatine çevrilir. Aynı saha ve saat dosyada yalnız bir kez bulunabilir.</p>
      </div></Panel>}
      {file && prepared.rows.length > 0 && <Panel title="Kaydedilecek üretim" description="Bu önizleme, dönüşümlerden sonraki kWh değerlerini ve santral saatindeki saat bitişini gösterir.">
        <form onSubmit={save} className="stack">
          <div className="inline"><span className="badge badge-green">{number(prepared.rows.length, 0)} kayıt hazır</span><span className="muted">Toplam {number(prepared.total, 2)} kWh</span></div>
          <DataTable rows={prepared.preview} columns={['name', 'production_time', 'actual_energy_kwh']} pageSize={10} caption="Doğrulanmış ve kaydedilmeye hazır üretim verileri" />
          {prepared.rows.length > 100 && <p className="muted">Önizlemede ilk 100 kayıt gösterilir. Kaydettiğinizde {number(prepared.rows.length, 0)} satırın tamamı işlenir.</p>}
          <Notice>Aynı santral ve saat için kayıt varsa üretim değeri güncellenir. Dosyada hata varsa yüklemenin tamamı reddedilir.</Notice>
          <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={saving} /><span>Saha eşleştirmelerini, enerji birimini ve saat anlamını kontrol ettim.</span></label>
          {saveError && <Notice tone="error">{saveError}</Notice>}
          {success && <Notice tone="success">{success}</Notice>}
          <div className="form-actions"><Button type="submit" variant="primary" loading={saving} disabled={!confirmed}><Save size={16} />Gerçek üretimi kaydet</Button><span className="muted">{siteColumn ? `${sourceNames.length} santral` : site?.name}</span></div>
        </form>
      </Panel>}
    </>}
    {site && <Panel title={`${site.name} kayıtlı üretimi`} description="Gerçekleşen üretim değerleri kWh, zaman etiketleri saat bitişidir." action={<Button variant="ghost" onClick={actuals.reload} disabled={actuals.loading}><RefreshCw size={15} />Yenile</Button>}>
      {actuals.loading ? <Loading /> : actuals.error ? <ErrorState error={actuals.error} onRetry={actuals.reload} /> : actuals.data?.length ? <DataTable rows={actuals.data} columns={['production_time', 'actual_energy_kwh']} pageSize={10} caption={`${site.name} kayıtlı saatlik gerçek üretim`} /> : <Empty title="Henüz üretim verisi yok" icon={FileSpreadsheet}>Bir CSV veya Excel dosyası yükleyerek bu santralin gerçekleşen üretimini ekleyin.</Empty>}
    </Panel>}
  </div>;
}
