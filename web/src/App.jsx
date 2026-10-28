import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Sun, ChartNoAxesCombined, Building2, Upload, GitCompareArrows, SlidersHorizontal, ChevronRight, Menu, X, CheckCircle2, RefreshCw, HelpCircle, CalendarDays, ExternalLink, Leaf, Pause, Play } from 'lucide-react';
import { useApi, number } from './api';
import { Button, Notice, Loading, ErrorState } from './components/ui';
import { SolarBackdrop } from './components/SolarBackdrop';
import { BrandCycle } from './components/BrandCycle';
const ForecastsPage = lazy(() => import('./pages/Forecasts').then(module => ({ default: module.ForecastsPage })));
const SitesPage = lazy(() => import('./pages/Sites').then(module => ({ default: module.SitesPage })));
const ActualsPage = lazy(() => import('./pages/Actuals').then(module => ({ default: module.ActualsPage })));
const ComparisonPage = lazy(() => import('./pages/Analysis').then(module => ({ default: module.ComparisonPage })));
const ScenariosPage = lazy(() => import('./pages/Analysis').then(module => ({ default: module.ScenariosPage })));

const pages = [
  { id: 'forecasts', label: 'Üretim tahmini', icon: ChartNoAxesCombined },
  { id: 'sites', label: 'Santraller ve kayıplar', icon: Building2 },
  { id: 'actuals', label: 'Gerçek üretim', icon: Upload },
  { id: 'comparison', label: 'Karşılaştırma', icon: GitCompareArrows },
  { id: 'scenarios', label: 'Senaryolar', icon: SlidersHorizontal },
];
function readLocation() {
  const params = new URLSearchParams(location.search);
  return { page: pages.some(p => p.id === params.get('page')) ? params.get('page') : 'forecasts', siteId: Number(params.get('site')) || null };
}

export function App() {
  const [route, setRoute] = useState(readLocation);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const [revision, setRevision] = useState(0);
  const [backgroundPaused, setBackgroundPaused] = useState(() => {
    try { return localStorage.getItem('ges-background-paused') === 'true'; } catch { return false; }
  });
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [isNarrow, setIsNarrow] = useState(() => matchMedia('(max-width: 1000px)').matches);
  const menuRef = useRef(null);
  const opened = useRef(false);
  const sites = useApi('/sites', revision);
  const health = useApi('/health', revision);
  const usage = useApi('/api-usage', revision);
  const selected = sites.data?.find(s => s.id === route.siteId) || sites.data?.[0] || null;
  const page = pages.find(p => p.id === route.page);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = event => setReducedMotion(event.matches);
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const pop = () => { setRoute(readLocation()); setMobileOpen(false); };
    addEventListener('popstate', pop); return () => removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const media = matchMedia('(max-width: 1000px)');
    const resize = event => { setIsNarrow(event.matches); if (!event.matches) setMobileOpen(false); };
    media.addEventListener('change', resize); return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (mobileOpen) {
      opened.current = true;
      document.querySelector('.sidebar-close')?.focus();
      const escape = event => {
        if (event.key === 'Escape') setMobileOpen(false);
        if (event.key === 'Tab') {
          const items = [...document.querySelectorAll('.sidebar a, .sidebar button')].filter(el => el.getClientRects().length);
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      };
      addEventListener('keydown', escape); return () => removeEventListener('keydown', escape);
    }
    if (opened.current) { menuRef.current?.focus(); opened.current = false; }
  }, [mobileOpen]);
  function navigate(id, siteId = selected?.id) {
    const next = { page: id, siteId };
    const url = new URL(location.href); url.searchParams.set('page', id);
    if (siteId) url.searchParams.set('site', siteId); else url.searchParams.delete('site');
    url.searchParams.delete('run'); history.pushState({}, '', url); setRoute(next); setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return <div className="app-shell">
    <SolarBackdrop paused={backgroundPaused || reducedMotion} />
    <a href="#main" className="skip-link">İçeriğe geç</a>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Menüyü kapat" />}
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`} id="main-navigation" aria-label="Ana menü" inert={isNarrow && !mobileOpen} aria-hidden={isNarrow && !mobileOpen ? true : undefined}>
      <a className="brand" href="?page=forecasts" aria-label="GES enerji ana sayfa" onClick={e => { e.preventDefault(); navigate('forecasts'); }}><BrandCycle paused={backgroundPaused || reducedMotion} /></a>
      <button className="sidebar-close icon-button" aria-label="Menüyü kapat" onClick={() => setMobileOpen(false)}><X size={20} /></button>
      <div className="workspace-label"><span className="workspace-avatar"><Leaf size={17} /></span><div><strong>Üretim yönetimi</strong><small>Güneş enerjisi</small></div></div>
      <nav aria-label="Çalışma alanları">{pages.map(({ id, label, icon: Icon }) => <a href={`?page=${id}${selected ? `&site=${selected.id}` : ''}`} key={id} aria-current={route.page === id ? 'page' : undefined} className={`nav-item ${route.page === id ? 'active' : ''}`} onClick={e => { e.preventDefault(); navigate(id); }}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{route.page === id && <ChevronRight size={15} />}</a>)}</nav>
      <div className="sidebar-bottom">
        <div className="service-summary"><div><Sun size={17} /><strong>Hava servisi kullanımı</strong></div>{usage.data ? <><p><b>{number(usage.data.daily_request_count, 0)}</b><span> / {number(usage.data.daily_limit, 0)} istek</span></p><progress aria-label="Bugünkü hava servisi kullanımı" max={usage.data.daily_limit || 1} value={usage.data.daily_request_count} /><small>Bugünkü Open-Meteo istekleri</small></> : <small>{usage.error ? 'Kullanım bilgisi alınamadı' : 'Kullanım yükleniyor…'}</small>}</div>
        <button className="sidebar-help" onClick={() => { setHelpOpen(v => !v); setMobileOpen(false); }} aria-expanded={helpOpen}><HelpCircle size={18} />Kullanım rehberi<ExternalLink size={14} /></button>
        <div className={`connection ${health.error ? 'connection-error' : ''}`}><CheckCircle2 size={16} /><span>{health.loading ? 'Bağlantı kontrol ediliyor' : health.error ? 'Bağlantı kurulamadı' : 'Sistem bağlantısı hazır'}</span></div>
      </div>
    </aside>
    <div className="app-body" inert={isNarrow && mobileOpen}>
      <header className="topbar"><div className="topbar-location"><Button ref={menuRef} variant="ghost" className="mobile-menu" aria-label="Ana menüyü aç" aria-controls="main-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={21} /></Button><span className="breadcrumb-root">Çalışma alanı</span><ChevronRight size={14} /><strong>{page.label}</strong></div><div className="topbar-actions"><span className="today"><CalendarDays size={16} />{new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric' })}</span><button className="icon-button motion-toggle" aria-pressed={backgroundPaused || reducedMotion} disabled={reducedMotion} aria-label={reducedMotion ? "Animasyonlar sistem tercihiyle kapalı" : backgroundPaused ? "Animasyonları başlat" : "Animasyonları durdur"} title={reducedMotion ? "Sistem tercihi: azaltılmış hareket" : backgroundPaused ? "Animasyonları başlat" : "Animasyonları durdur"} onClick={() => { const next = !backgroundPaused; setBackgroundPaused(next); try { localStorage.setItem("ges-background-paused", String(next)); } catch {} }}>{backgroundPaused || reducedMotion ? <Play size={15} /> : <Pause size={15} />}</button><span className="topbar-divider" /><label className="global-site"><Building2 size={17} /><span className="sr-only">Aktif santral</span><select value={selected?.id || ''} onChange={e => navigate(route.page, Number(e.target.value))} aria-label="Aktif santral" disabled={!sites.data?.length}>{sites.data?.length ? sites.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="">Santral seçin</option>}</select></label><button className="icon-button refresh-button" onClick={() => setRevision(v => v + 1)} aria-label="Verileri yenile" title="Kayıtlı verileri yenile"><RefreshCw size={17} className={sites.loading ? 'spin' : ''} /></button></div></header>
      <main id="main" tabIndex={-1} className="main-content">
        {flash && <div className="flash-message"><Notice tone="success">{flash}</Notice><Button variant="ghost" aria-label="Bildirimi kapat" onClick={() => setFlash('')}><X size={16} /></Button></div>}
        {helpOpen && <div className="help-panel"><div className="panel-heading"><h2>Çalışma alanı rehberi</h2><Button variant="ghost" onClick={() => setHelpOpen(false)} aria-label="Rehberi kapat"><X size={17} /></Button></div><p>Santral seçin ve kayıtlı üretim tahminini inceleyin. Yeni tahmin oluşturabilir, gerçek üretimi CSV/Excel ile yükleyebilir ve sonuçları karşılaştırabilirsiniz.</p><Notice>15:00 etiketi, 14:00–15:00 aralığının bitişidir. Enerji kWh, ortalama güç kW olarak gösterilir. Yeni tahmin ve konum arama hava servisini kullanabilir; kayıtlı verileri görüntülemek kullanmaz.</Notice></div>}
        <Suspense fallback={<Loading rows={6} />}>{sites.loading ? <Loading rows={8} /> : sites.error ? <ErrorState error={sites.error} onRetry={() => setRevision(v => v + 1)} /> : <React.Fragment key={`${route.page}-${selected?.id || 'empty'}`}>
          {route.page === 'forecasts' && <ForecastsPage site={selected} onNavigate={navigate} revision={revision} onForecastCreated={usage.reload} />}
          {route.page === 'sites' && <SitesPage sites={sites.data || []} site={selected} onSitesChanged={created => { if (created) { setFlash(`${created.name} santrali eklendi.`); navigate('sites', created.id); } setRevision(v => v + 1); }} />}
          {route.page === 'actuals' && <ActualsPage sites={sites.data || []} site={selected} />}
          {route.page === 'comparison' && <ComparisonPage site={selected} onNavigate={navigate} />}
          {route.page === 'scenarios' && <ScenariosPage site={selected} onNavigate={navigate} />}
        </React.Fragment>}</Suspense>
      </main>
      <footer className="app-footer"><span>GES saatlik üretim tahmini</span><div>Veri kaynakları <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a><a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a><a href="https://open-meteo.com/en/licence" target="_blank" rel="noreferrer">Lisans</a><a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">Koşullar</a></div></footer>
    </div>
  </div>;
}
