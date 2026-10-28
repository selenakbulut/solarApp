import React, { useState } from 'react';
import { Download, GitCompareArrows, LineChart } from 'lucide-react';
import { useApi, number, dateLabel, createdLabel, runLabel, sourceLabel, downloadCsv } from '../api';
import { Button, Notice, Empty, Loading, ErrorState, Field, Panel, PageHeading, Metric, Tabs, DataTable } from '../components/ui';
import { EnergyChart } from '../components/Charts';

const parameters = {
  panel_count: { label: 'Panel sayısı', unit: 'adet' },
  panel_power_wp: { label: 'Panel gücü', unit: 'Wp' },
  ac_power_kw: { label: 'AC güç', unit: 'kW' },
  site_age_years: { label: 'Santral yaşı', unit: 'yıl' },
  tilt: { label: 'Panel eğimi', unit: '°' },
  azimuth: { label: 'Azimut', unit: '°' },
};

const diagnosticColumns = ['mae_kwh', 'rmse_kwh', 'bias_kwh', 'nmae_percent', 'nrmse_percent'];
const signed = (value, digits = 2) => value == null ? '-' : `${value > 0 ? '+' : ''}${number(value, digits)}`;
const timestampLabel = value => `${dateLabel(value)} ${String(value).slice(11, 16)}`;

function NoSite({ onNavigate }) {
  return <Empty title="Önce bir santral seçin" action={<Button onClick={() => onNavigate('sites')}>Santrallere git</Button>}>
    Kayıtlı tahminleri incelemek için menüden bir santral seçin veya yeni bir santral ekleyin.
  </Empty>;
}

function RunSourceNotice({ run }) {
  if (run?.source === 'historical') return <Notice tone="warning">Bu sürüm geçmiş hava koşullarından hesaplanmıştır. Geçmişte yapılmış ileri tahmin başarısını göstermez.</Notice>;
  if (run?.source === 'legacy') return <Notice>Bu eski sürümün ilk ve son üretim günleri kısmi olabilir. Günlük kapsamı ve kayıt tarihini kontrol edin.</Notice>;
  return null;
}

function RunPeriod({ run }) {
  if (!run) return null;
  return <p className="muted">{sourceLabel(run.source)}: {timestampLabel(run.first_time)} - {timestampLabel(run.last_time)}. {number(run.hour_count, 0)} saatlik kayıt.</p>;
}

function MissingHours({ hours = [] }) {
  if (!hours.length) return null;
  return <details className="details">
    <summary>Gerçek üretimi eksik {number(hours.length, 0)} saat</summary>
    <p className="muted">Bu saatler karşılaştırma metriklerine ve günlük toplamlara dahil edilmedi. İlgili gerçek üretimi yükleyerek kapsamı tamamlayabilirsiniz.</p>
    <DataTable rows={hours.map(forecast_time => ({ forecast_time }))} columns={['forecast_time']} pageSize={8} caption="Gerçek üretimi bulunmayan saatler" />
  </details>;
}

export function ComparisonPage({ site, onNavigate }) {
  return <div className="stack">
    <PageHeading title="Tahmin ne kadar doğru?" description="Gerçekleşen üretimle farkı ve veri kapsamını birlikte inceleyin." />
    {site ? <ComparisonContent key={site.id} site={site} onNavigate={onNavigate} /> : <NoSite onNavigate={onNavigate} />}
  </div>;
}

function ComparisonContent({ site, onNavigate }) {
  const runs = useApi(`/sites/${site.id}/forecasts`);
  const [selection, setSelection] = useState('');
  const [mode, setMode] = useState('hourly');
  const available = runs.data || [];
  const selectedRun = available.find(run => String(run.id) === selection) || available[0];
  const comparison = useApi(selectedRun ? `/forecasts/${selectedRun.id}/comparison` : null);
  const result = comparison.data?.run_id === selectedRun?.id ? comparison.data : null;

  if (runs.loading) return <Loading />;
  if (runs.error) return <ErrorState error={runs.error} onRetry={runs.reload} />;
  if (!available.length) return <Empty title="Karşılaştırmaya hazır bir tahmin yok" icon={LineChart} action={<Button variant="primary" onClick={() => onNavigate('forecasts')}>Tahmin oluştur</Button>}>
    {site.name} için önce bir tahmin oluşturun, ardından aynı saatlerin gerçek üretimini yükleyin.
  </Empty>;

  const metrics = result?.metrics;
  const rows = result ? (mode === 'hourly' ? result.hourly : result.daily) : [];
  const columns = [mode === 'hourly' ? 'forecast_time' : 'date', 'predicted_energy_kwh', 'actual_energy_kwh', 'error_kwh', 'percentage_deviation'];
  if (mode === 'hourly') columns.push('absolute_error_kwh', 'deviation_status');
  else columns.push('hour_count', 'complete_day');

  return <>
    <Panel title="Karşılaştırılacak sürüm" description={site.name}>
      <Field label="Kayıtlı tahmin" hint="Kayıt tarihi, verinin bugün güncel olduğu anlamına gelmez.">
        <select value={selectedRun.id} onChange={event => setSelection(event.target.value)}>
          {available.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}
        </select>
      </Field>
      <RunPeriod run={selectedRun} />
    </Panel>
    <RunSourceNotice run={selectedRun} />
    {comparison.error ? <ErrorState error={comparison.error} onRetry={comparison.reload} /> : !result ? <Loading /> : <>
      {!metrics ? <>
        <Empty title="Bu tahminle eşleşen gerçek üretim yok" action={<Button variant="primary" onClick={() => onNavigate('actuals')}>Gerçek üretim yükle</Button>}>
          Karşılaştırma için aynı santralin ve aynı saatlerin üretim kayıtları gerekli. Dosyanızın saat başlangıcı veya saat bitişi etiketini doğru seçin.
        </Empty>
        <MissingHours hours={result.missing_actual_hours} />
      </> : <>
        <div className="metrics-row">
          <Metric label="Ortalama mutlak hata" value={number(metrics.mae_kwh, 3)} unit="kWh" note={`MAE / normalize: %${number(metrics.nmae_percent, 2)}`} />
          <Metric label="Karesel ortalama hata" value={number(metrics.rmse_kwh, 3)} unit="kWh" note={`RMSE / normalize: %${number(metrics.nrmse_percent, 2)}`} />
          <Metric label="Ortalama yönlü sapma" value={signed(metrics.bias_kwh, 3)} unit="kWh" note="Pozitif: yüksek, negatif: düşük tahmin" />
          <Metric label="Eşleşen saat" value={`${number(metrics.hour_count, 0)} / ${number(result.forecast_hour_count, 0)}`} note={`${number(result.missing_actual_hours.length, 0)} saatte gerçek üretim eksik`} />
        </div>
        {result.missing_actual_hours.length > 0 && <Notice tone="warning">Karşılaştırma {number(metrics.hour_count, 0)} eşleşen saati kapsıyor. Eksik saatler hata metriklerine ve günlük toplamlara dahil edilmedi.</Notice>}
        <Panel title="Tahmin ve gerçekleşen üretim" description="Aynı saatlerdeki enerji üretimi (kWh)." action={<Tabs value={mode} onChange={setMode} options={[{ value: 'hourly', label: 'Saatlik' }, { value: 'daily', label: 'Günlük' }]} label="Karşılaştırma aralığı" />}>
          <EnergyChart data={rows} timeKey={mode === 'hourly' ? 'forecast_time' : 'date'} series={[
            { key: 'predicted_energy_kwh', label: 'Tahmin', color: 'var(--color-accent)' },
            { key: 'actual_energy_kwh', label: 'Gerçekleşen', color: 'var(--color-energy)' },
          ]} />
          <p className="muted">Saat etiketleri aralık bitişidir: 15:00, 14:00-15:00 üretimini gösterir. Saatler santralin yerel saatidir.</p>
        </Panel>
        <Panel title={mode === 'hourly' ? 'Saatlik karşılaştırma' : 'Günlük karşılaştırma'} action={<Button onClick={() => downloadCsv(rows, `comparison_${selectedRun.id}_${mode}.csv`)}><Download size={16} />CSV indir</Button>}>
          {mode === 'daily' && <Notice>Günlük toplamlar yalnız eşleşen saatlerden hesaplanır. 24 saat içermeyen üretim günleri “Kısmi gün” olarak işaretlenir.</Notice>}
          <DataTable key={`${selectedRun.id}-${mode}`} rows={rows} columns={columns} caption={mode === 'hourly' ? 'Saatlik tahmin ve gerçekleşen üretim karşılaştırması' : 'Günlük tahmin ve gerçekleşen üretim karşılaştırması'} />
          <p className="muted">Yüzde sapma = (tahmin − gerçek) / gerçek × 100. Gerçek üretim sıfırsa yüzde hesaplanmaz; boş gösterilir.</p>
        </Panel>
        <Panel title="Hatanın ayrıntıları" description="Gün içindeki dağılımı, hava koşullarını ve karşılaştırma kapsamını inceleyin.">
          <details className="details">
            <summary>Günün saatine göre hata</summary>
            <p className="muted">Saatler santralin yerel saatinde aralık bitişini gösterir.</p>
            <DataTable rows={result.hour_of_day} columns={[{ key: 'hour', label: 'Saat bitişi', render: value => `${String(value).padStart(2, '0')}:00` }, ...diagnosticColumns]} pageSize={8} caption="Günün saatine göre hata metrikleri" />
          </details>
          <details className="details">
            <summary>Hava koşuluna göre hata</summary>
            <DataTable rows={result.weather_groups} columns={['weather', ...diagnosticColumns]} caption="Hava koşuluna göre hata metrikleri" />
          </details>
          <details className="details">
            <summary>Dünün aynı saati referansı</summary>
            <Notice tone="warning">{result.baseline.note}</Notice>
            {result.baseline.matched_hours ? <>
              <p className="muted">İki hata değeri de aynı {number(result.baseline.matched_hours, 0)} saatlik alt kümede karşılaştırılır.</p>
              <dl className="parameter-list">
                <div><dt>Model MAE</dt><dd>{number(result.baseline.model_metrics_same_hours?.mae_kwh, 3)} kWh</dd></div>
                <div><dt>Önceki gün referansı MAE</dt><dd>{number(result.baseline.mae_kwh, 3)} kWh</dd></div>
              </dl>
            </> : <p className="muted">Referansı hesaplamak için önceki günün aynı saatine ait gerçek üretim kayıtları da gerekli.</p>}
          </details>
          <MissingHours hours={result.missing_actual_hours} />
        </Panel>
      </>}
    </>}
  </>;
}

export function ScenariosPage({ site, onNavigate }) {
  return <div className="stack">
    <PageHeading title="İki senaryo, aynı saatler" description="Teknik parametreleri ve üretim farkını kayıtlı tahminler üzerinden karşılaştırın." />
    {site ? <ScenariosContent key={site.id} site={site} onNavigate={onNavigate} /> : <NoSite onNavigate={onNavigate} />}
  </div>;
}

function ScenariosContent({ site, onNavigate }) {
  const runs = useApi(`/sites/${site.id}/forecasts`);
  const [firstSelection, setFirstSelection] = useState('');
  const [secondSelection, setSecondSelection] = useState('');
  const available = runs.data || [];
  const first = available.find(run => String(run.id) === firstSelection) || available[0];
  const second = available.find(run => String(run.id) === secondSelection) || available[1];
  const sameRun = first && second && first.id === second.id;
  const comparison = useApi(first && second && !sameRun ? `/scenarios/compare?first_run_id=${first.id}&second_run_id=${second.id}` : null);
  const result = comparison.data?.first_run_id === first?.id && comparison.data?.second_run_id === second?.id ? comparison.data : null;

  if (runs.loading) return <Loading />;
  if (runs.error) return <ErrorState error={runs.error} onRetry={runs.reload} />;
  if (available.length < 2) return <Empty title="İki tahminle başlayın" icon={GitCompareArrows} action={<Button variant="primary" onClick={() => onNavigate('forecasts')}>Yeni senaryo oluştur</Button>}>
    {site.name} için farklı teknik parametrelerle en az iki tahmin kaydedin. Santral kaydı değişmeden senaryoları karşılaştırabilirsiniz.
  </Empty>;

  const rows = result?.hourly || [];
  const firstTotal = rows.reduce((sum, row) => sum + row.first_energy_kwh, 0);
  const secondTotal = rows.reduce((sum, row) => sum + row.second_energy_kwh, 0);
  const difference = rows.reduce((sum, row) => sum + row.difference_kwh, 0);
  const parameterRows = Object.entries(parameters).map(([key, parameter]) => ({
    parameter: parameter.label,
    first: `${number(first[key], 2)} ${parameter.unit}`,
    second: `${number(second[key], 2)} ${parameter.unit}`,
    changed: result?.changed_parameters.includes(key),
  }));

  return <>
    <Panel title="Senaryoları seçin" description={`${site.name} için kaydedilmiş tahminler.`}>
      <div className="form-grid">
        <div>
          <Field label="Birinci tahmin">
            <select value={first.id} onChange={event => setFirstSelection(event.target.value)}>{available.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select>
          </Field>
          <RunPeriod run={first} />
        </div>
        <div>
          <Field label="İkinci tahmin">
            <select value={second.id} onChange={event => setSecondSelection(event.target.value)}>{available.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select>
          </Field>
          <RunPeriod run={second} />
        </div>
      </div>
    </Panel>
    {(first.source === 'historical' || second.source === 'historical') && <Notice tone="warning">Seçilen sürümler arasında geçmiş hava hesabı var. Bu karşılaştırma, geçmişte yapılmış ileri tahmin başarısını göstermez.</Notice>}
    {sameRun ? <Notice tone="warning">Karşılaştırma için iki farklı tahmin seçin.</Notice> : comparison.error ? <ErrorState error={comparison.error} onRetry={comparison.reload} /> : !result ? <Loading /> : <>
      <Notice tone="warning">{result.warning}</Notice>
      <Panel title="Teknik parametreler" description={result.changed_parameters.length ? `Değişen parametreler: ${result.changed_parameters.map(key => parameters[key]?.label || key).join(', ')}.` : 'Seçilen sürümlerin temel teknik parametreleri aynı.'}>
        <DataTable rows={parameterRows} pageSize={6} columns={[
          { key: 'parameter', label: 'Parametre' },
          { key: 'first', label: `Birinci tahmin #${first.id}` },
          { key: 'second', label: `İkinci tahmin #${second.id}` },
          { key: 'changed', label: 'Karşılaştırma', render: changed => <span className={`badge ${changed ? 'badge-amber' : ''}`}>{changed ? 'Farklı' : 'Aynı'}</span> },
        ]} caption="İki tahminin teknik parametreleri" />
      </Panel>
      {!rows.length ? <Empty title="Ortak tahmin saati bulunmuyor" action={<Button onClick={() => onNavigate('forecasts')}>Tahminlere git</Button>}>
        Üretim farkını hesaplayabilmek için tarih aralıkları kesişen iki sürüm seçin. Seçilen sürümlerin saat aralıklarını yukarıdan kontrol edebilirsiniz.
      </Empty> : <>
        <div className="metrics-row">
          <Metric label={`Birinci tahmin #${first.id}`} value={number(firstTotal, 2)} unit="kWh" note="Yalnız ortak saatlerin toplamı" />
          <Metric label={`İkinci tahmin #${second.id}`} value={number(secondTotal, 2)} unit="kWh" note="Yalnız ortak saatlerin toplamı" />
          <Metric label="Toplam üretim farkı" value={signed(difference)} unit="kWh" note="İkinci tahmin − birinci tahmin" />
          <Metric label="Ortak saat" value={number(rows.length, 0)} note={`${timestampLabel(rows[0].forecast_time)} - ${timestampLabel(rows[rows.length - 1].forecast_time)}`} />
        </div>
        <Panel title="Ortak saatlerde üretim" description="Grafik ve toplamlar yalnız iki sürümde de bulunan saatleri içerir.">
          <EnergyChart data={rows} timeKey="forecast_time" series={[
            { key: 'first_energy_kwh', label: `Birinci tahmin #${first.id}`, color: 'var(--color-accent)' },
            { key: 'second_energy_kwh', label: `İkinci tahmin #${second.id}`, color: 'var(--color-energy)' },
          ]} />
          <p className="muted">Saatler santralin yerel saatinde aralık bitişini gösterir. Hava girdileri ve kayıp katsayıları da üretim farkını etkileyebilir.</p>
        </Panel>
        <Panel title="Saatlik senaryo farkı" action={<Button onClick={() => downloadCsv(rows, `scenarios_${first.id}_${second.id}.csv`)}><Download size={16} />CSV indir</Button>}>
          <DataTable key={`${first.id}-${second.id}`} rows={rows} columns={['forecast_time', 'first_energy_kwh', 'second_energy_kwh', 'difference_kwh']} caption="Ortak saatlerde senaryo karşılaştırması" />
          <p className="muted">Pozitif fark ikinci tahminin, negatif fark birinci tahminin daha yüksek üretim hesapladığını gösterir.</p>
        </Panel>
      </>}
    </>}
    <details className="details">
      <summary>Tüm kayıtlı tahminleri incele ({number(available.length, 0)})</summary>
      <DataTable rows={available} columns={[
        { key: 'id', label: 'Tahmin', render: value => `#${value}` },
        { key: 'created_at', label: 'Oluşturulma', render: createdLabel },
        { key: 'source', label: 'Kaynak', render: sourceLabel },
        'panel_count', 'panel_power_wp', 'ac_power_kw', 'tilt', 'azimuth', 'hour_count',
        { key: 'first_time', label: 'İlk saat', render: timestampLabel },
        { key: 'last_time', label: 'Son saat', render: timestampLabel },
      ]} caption="Santralin kayıtlı tahmin sürümleri" />
    </details>
  </>;
}
