import { useEffect, useState } from 'react';

export async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(`/api${path}`, {
      ...options, signal: controller.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      let detail;
      try { detail = (await response.json()).detail; } catch { detail = null; }
      if (Array.isArray(detail)) detail = detail.map(e => `${e.loc?.slice(1).join('.')}: ${e.msg}`).join('; ');
      throw new Error(detail || `İşlem tamamlanamadı (${response.status}). Lütfen yeniden deneyin.`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'TypeError') throw new Error('Sunucuya bağlanılamadı. Bağlantıyı kontrol edip yeniden deneyin.');
    if (error.name === 'AbortError' && !options.signal?.aborted) throw new Error('İstek zaman aşımına uğradı. Yeniden deneyin.');
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}

export function useApi(path, version = 0) {
  const [state, setState] = useState({ path, data: null, loading: Boolean(path), error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) { setState({ path, data: null, loading: false, error: null }); return; }
    const controller = new AbortController();
    setState({ path, data: null, loading: true, error: null });
    api(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ path, data, loading: false, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ path, data: null, loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [path, version, retry]);
  const current = state.path === path;
  return { data: current ? state.data : null, error: current ? state.error : null,
    loading: Boolean(path) && (!current || state.loading), reload: () => setRetry(v => v + 1) };
}

export function number(value, digits = 1) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('tr-TR', { maximumFractionDigits: digits });
}

export function dateLabel(value, options = {}) {
  if (!value) return 'Belirtilmedi';
  // Unzoned forecast labels already belong to the site's local clock.
  const text = String(value).slice(0, 19);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', ...options });
}

export function createdLabel(value) {
  if (!value) return 'Belirtilmedi';
  const date = new Date(/Z|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const sourceLabel = source => source === 'historical' ? 'Geçmiş hava hesabı' : source === 'legacy' ? 'Eski sürüm' : 'İleri tahmin';
export const runLabel = run => `#${run.id} — ${createdLabel(run.created_at)} — ${sourceLabel(run.source)}`;

export function downloadCsv(rows, filename) {
  if (!rows?.length) return;
  const keys = Object.keys(rows[0]);
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [keys, ...rows.map(row => keys.map(key => row[key]))].map(row => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
