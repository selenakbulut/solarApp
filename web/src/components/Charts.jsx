import React from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { number, dateLabel } from '../api';

function ChartTooltip({ active, payload, label, timeKey, scaled }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{dateLabel(label, { year: 'numeric' })}{String(label).includes('T') && ` / ${String(label).slice(11, 16)}`}</strong>
    {payload.map(item => <div key={item.dataKey}><span className="legend-line" style={{ background: item.color }} />{item.name}<b>{number(item.value, 2)} {item.dataKey === 'tilted_radiation' ? 'W/m²' : scaled ? 'MWh' : 'kWh'}</b></div>)}
  </div>;
}

export function EnergyChart({ data = [], timeKey = 'forecast_time', series = [{ key: 'predicted_energy_kwh', label: 'Üretim tahmini', color: 'var(--color-energy)' }], radiation = false, height = 300 }) {
  const scaled = Math.max(...data.map(row => Math.max(...series.map(s => Math.abs(row[s.key] || 0)))) , 0) > 10000;
  const frame = scaled ? data.map(row => ({ ...row, ...Object.fromEntries(series.map(s => [s.key, row[s.key] == null ? null : row[s.key] / 1000])) })) : data;
  return <div className="energy-chart" role="img" aria-label="Saatlik veya günlük enerji üretimi grafiği. Sayısal değerler aşağıdaki veri tablosunda da bulunur.">
    <div className="chart-unit">{scaled ? 'MWh' : 'kWh'}{radiation && <span>Işınım W/m²</span>}</div>
    <div style={{ height, width: '100%', minWidth: 0 }}><ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={frame} margin={{ top: 12, right: radiation ? 8 : 18, bottom: 6, left: -8 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--color-grid)" strokeDasharray="3 5" />
        <XAxis dataKey={timeKey} axisLine={false} tickLine={false} minTickGap={56} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickMargin={14} tickFormatter={v => String(v).includes('T') ? `${dateLabel(v)} ${String(v).slice(11, 16)}` : dateLabel(v)} />
        <YAxis yAxisId="energy" axisLine={false} tickLine={false} width={62} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickFormatter={v => number(v, 0)} />
        {radiation && <YAxis yAxisId="radiation" orientation="right" axisLine={false} tickLine={false} width={48} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} />}
        <Tooltip content={<ChartTooltip timeKey={timeKey} scaled={scaled} />} cursor={{ stroke: 'var(--color-rule)', strokeDasharray: '4 4' }} />
        {series.map((s, i) => i === 0 ? <Area key={s.key} yAxisId="energy" type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.11} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 3 }} isAnimationActive={false} /> : <Line key={s.key} yAxisId="energy" type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.2} dot={false} isAnimationActive={false} />)}
        {radiation && <Line yAxisId="radiation" type="monotone" dataKey="tilted_radiation" name="Işınım" stroke="var(--color-accent)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer></div>
    <div className="chart-legend">{series.map(s => <span key={s.key}><i className="legend-line" style={{ background: s.color }} />{s.label}</span>)}{radiation && <span><i className="legend-line legend-radiation" />Işınım</span>}<span className="chart-legend-note">Saatler aralık bitişini gösterir</span></div>
  </div>;
}
