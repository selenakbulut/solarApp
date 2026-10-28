import React, { useId, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Inbox, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { number, dateLabel } from '../api';

export function Button({ children, variant = 'secondary', className = '', loading, type = 'button', ...props }) {
  return <button {...props} type={type} disabled={loading || props.disabled} aria-busy={loading || undefined} className={`button button-${variant} ${className}`}>
    {loading && <RefreshCw size={16} className="spin" />}{children}
  </button>;
}

export function Notice({ children, tone = 'info' }) {
  const Icon = tone === 'error' || tone === 'warning' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={18} /><div>{children}</div></div>;
}

export function Empty({ title, children, action, icon: Icon = Inbox }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={28} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Loading({ rows = 4 }) {
  return <div className="skeleton-wrap" aria-busy="true" aria-label="Veriler yükleniyor">{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} />)}<span className="sr-only">Veriler yükleniyor</span></div>;
}

export function ErrorState({ error, onRetry }) {
  return <Notice tone="error"><p>{error}</p>{onRetry && <Button onClick={onRetry}><RefreshCw size={15} />Yeniden dene</Button>}</Notice>;
}

export function Field({ label, hint, children, className = '', ...props }) {
  const generatedId = useId();
  const child = React.Children.only(children);
  const id = child.props.id || generatedId;
  return <div className={`field ${className}`} {...props}><label htmlFor={id}>{label}</label>{React.cloneElement(child, { id, 'aria-describedby': hint ? `${id}-hint` : child.props['aria-describedby'] })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}

export function Panel({ title, description, action, children, className = '', id }) {
  return <section id={id} className={`panel ${className}`}>{(title || action) && <div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}{children}</section>;
}

export function PageHeading({ title, description, action }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export function Metric({ label, value, unit, note, icon: Icon }) {
  return <div className="metric"><div className="metric-label">{label}{Icon && <Icon size={17} />}</div><div className="metric-value">{value}<span>{unit}</span></div>{note && <div className="metric-note">{note}</div>}</div>;
}

export function Tabs({ value, onChange, options, label = 'Görünüm' }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(option => {
    const item = typeof option === 'string' ? { value: option, label: option } : option;
    return <button key={item.value} type="button" aria-pressed={value === item.value} className={value === item.value ? 'selected' : ''} onClick={() => onChange(item.value)}>{item.label}</button>;
  })}</div>;
}

const titles = {
  forecast_time: 'Saat bitişi', production_time: 'Saat bitişi', predicted_energy_kwh: 'Tahmin (kWh)',
  actual_energy_kwh: 'Gerçekleşen (kWh)', average_power_kw: 'Ortalama güç (kW)', peak_power_kw: 'Tepe güç (kW)',
  clipping_loss_kwh: 'Kırpma kaybı (kWh)', tilted_radiation: 'Işınım (W/m²)', temperature: 'Sıcaklık (°C)',
  cloud_cover: 'Bulutluluk (%)', date: 'Üretim günü', hour_count: 'Saat sayısı', complete_day: 'Gün kapsamı',
  error_kwh: 'Sapma (kWh)', absolute_error_kwh: 'Mutlak hata (kWh)', percentage_deviation: 'Sapma (%)',
  first_energy_kwh: 'Birinci tahmin (kWh)', second_energy_kwh: 'İkinci tahmin (kWh)', difference_kwh: 'Fark (kWh)',
  name: 'Santral', latitude: 'Enlem', longitude: 'Boylam', panel_count: 'Panel sayısı', panel_power_wp: 'Panel gücü (Wp)',
  ac_power_kw: 'AC güç (kW)', tilt: 'Eğim (°)', azimuth: 'Azimut (°)', mounting_type: 'Montaj', timezone: 'Saat dilimi',
  mae_kwh: 'MAE (kWh)', rmse_kwh: 'RMSE (kWh)', bias_kwh: 'Bias (kWh)', nmae_percent: 'Normalize MAE (%)',
  nrmse_percent: 'Normalize RMSE (%)', hour: 'Saat', weather: 'Hava durumu', created_at: 'Oluşturulma', id: 'Kayıt',
  source: 'Kaynak', deviation_status: 'Durum', site_id: 'Santral ID',
};

export function DataTable({ rows = [], columns, pageSize = 10, caption = 'Veri tablosu' }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(null);
  if (!rows.length) return <p className="muted table-empty">Gösterilecek kayıt bulunmuyor.</p>;
  const cols = (columns || Object.keys(rows[0])).map(c => typeof c === 'string' ? { key: c, label: titles[c] || c } : c);
  const sorted = sort ? [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    return (typeof av === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), 'tr')) * sort.direction;
  }) : rows;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const display = (value, key) => {
    if (value == null) return <span className="muted">Veri yok</span>;
    if (key === 'complete_day') return <span className={`badge ${value ? 'badge-green' : 'badge-amber'}`}>{value ? 'Tam gün' : 'Kısmi gün'}</span>;
    if (typeof value === 'number') return number(value, key.includes('latitude') || key.includes('longitude') ? 5 : 2);
    if (key === 'forecast_time' || key === 'production_time') return `${dateLabel(value)} ${String(value).slice(11, 16)}`;
    if (key === 'date') return dateLabel(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  return <><div className="table-scroll" tabIndex={0} role="region" aria-label={caption}><table><caption className="sr-only">{caption}</caption><thead><tr>{cols.map(col => <th key={col.key} aria-sort={sort?.key === col.key ? sort.direction === 1 ? 'ascending' : 'descending' : undefined}><button type="button" onClick={() => setSort({ key: col.key, direction: sort?.key === col.key ? -sort.direction : 1 })}>{col.label}<ArrowUpDown size={12} /></button></th>)}</tr></thead><tbody>{sorted.slice(safePage * pageSize, (safePage + 1) * pageSize).map((row, i) => <tr key={i}>{cols.map(col => <td key={col.key}>{col.render ? col.render(row[col.key], row) : display(row[col.key], col.key)}</td>)}</tr>)}</tbody></table></div>
  <div className="table-pagination"><span>{number(rows.length, 0)} kayıt <span className="pagination-range">/ {safePage * pageSize + 1}-{Math.min((safePage + 1) * pageSize, rows.length)} gösteriliyor</span></span><div><Button aria-label="Önceki sayfa" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={15} /></Button><span>{safePage + 1} / {pages}</span><Button aria-label="Sonraki sayfa" disabled={safePage + 1 === pages} onClick={() => setPage(safePage + 1)}><ChevronRight size={15} /></Button></div></div></>;
}
