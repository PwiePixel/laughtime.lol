'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/fetchCache';
import AdminBetaTile from '../beta/AdminBetaTile';
import Icon from '../Icon';
import { useApp } from '../Providers';
import { ChartTable, HBars, Legend, LineChart, SERIES, StackedColumns, StatTile, timeFormatter } from './Charts';

const RANGES = ['24h', '7d', '30d'];
const MODES = ['classic', 'hunt', 'swap'];

/** Numbers and charts of the admin start tab (loaded on demand by ./Dashboard.jsx). */
export default function DashboardView() {
  const { t, lang } = useApp();
  const [range, setRange] = useState('24h');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // switching the range quickly: only the answer to the latest question counts
  const latest = useRef(0);
  const load = useCallback(() => {
    const ticket = ++latest.current;
    setLoading(true);
    api(`/api/admin/stats?range=${range}`)
      .then((d) => ticket === latest.current && setData(d))
      .catch(() => {})
      .finally(() => ticket === latest.current && setLoading(false));
  }, [range]);

  useEffect(() => load(), [load]);
  // live numbers: refreshed while somebody is looking, not in a background tab
  usePolling(load, 30_000);

  if (!data) return <div className="spinner" aria-hidden="true" />;
  const nf = new Intl.NumberFormat(lang);
  const fmtT = timeFormatter(lang, data.step);
  const fmtS = timeFormatter(lang, range === '24h' ? 600_000 : data.step);
  const live = data.live;
  const modeSeries = MODES.map((m) => ({ key: m, label: t(`games.${m}`), color: SERIES[m] }));
  const tableLabel = t('admin.showTable');

  return (
    <div className={`admin-dashboard ${loading ? 'is-loading' : ''}`}>
      <section className="kpi-row" aria-label={t('admin.liveNow')}>
        <StatTile icon={<Icon name="users" size={22} />} value={nf.format(live.players)} label={t('admin.kpi.online')} tone="yellow" />
        <StatTile
          icon={<Icon name="gamepad" size={22} />}
          value={nf.format(live.playing)}
          label={t('admin.kpi.playing')}
          sub={t('admin.kpi.roomsTotal', { n: live.rooms, pub: live.publicRooms, dc: live.discordRooms ?? 0 })}
          tone="pink"
        />
        <StatTile icon={<Icon name="radar" size={22} />} value={nf.format(live.queue)} label={t('admin.kpi.queue')} tone="cyan" />
        <StatTile icon={<Icon name="flag" size={22} />} value={nf.format(live.openReports)} label={t('admin.kpi.reports')} tone={live.openReports ? 'alert' : ''} />
        <StatTile icon={<Icon name="lock" size={22} />} value={nf.format(live.activeSanctions)} label={t('admin.kpi.sanctions')} />
        <StatTile icon={<Icon name="package" size={22} />} value={nf.format(live.pendingPacks)} label={t('admin.kpi.packs')} />
        <StatTile icon={<Icon name="user" size={22} />} value={nf.format(live.users)} label={t('admin.kpi.users')} />
        <AdminBetaTile />
      </section>

      <div className="range-row" role="radiogroup" aria-label={t('admin.range')}>
        <span className="muted-on-dark">{t('admin.range')}</span>
        <div className="tabs">
          {RANGES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {t(`admin.range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      <section className="kpi-row small">
        <StatTile value={nf.format(data.totals.peakPlayers)} label={t('admin.tot.peak')} />
        <StatTile value={nf.format(data.totals.rounds)} label={t('admin.tot.rounds')} />
        <StatTile value={nf.format(data.totals.games)} label={t('admin.tot.games')} />
        <StatTile value={nf.format(data.totals.matches)} label={t('admin.tot.matches')} />
        <StatTile value={nf.format(data.totals.uploads)} label={t('admin.tot.uploads')} />
        <StatTile value={nf.format(data.totals.discord ?? 0)} label={t('admin.tot.discord')} />
        <StatTile value={nf.format(data.totals.signups)} label={t('admin.tot.signups')} />
        <StatTile value={nf.format(data.totals.reports)} label={t('admin.tot.reports')} />
      </section>

      <div className="chart-grid">
        <section className="card chart-card wide">
          <h3>{t('admin.chart.online')}</h3>
          <p className="muted small">{t('admin.chart.onlineSub')}</p>
          <LineChart
            data={data.online}
            series={[{ key: 'players', label: t('admin.kpi.online'), color: SERIES.single }]}
            area
            lang={lang}
            step={range === '24h' ? 600_000 : data.step}
            ariaLabel={t('admin.chart.online')}
          />
          <ChartTable
            label={tableLabel}
            caption={t('admin.chart.online')}
            columns={[t('admin.col.time'), t('admin.kpi.online'), t('admin.col.peak'), t('admin.kpi.playing')]}
            rows={data.online.filter((p) => p.players !== null).map((p) => [fmtS(p.t), p.players, p.peak, p.playing])}
          />
        </section>

        <section className="card chart-card wide">
          <h3>{t('admin.chart.rounds')}</h3>
          <Legend series={modeSeries} />
          <StackedColumns data={data.rounds} series={modeSeries} lang={lang} step={data.step} ariaLabel={t('admin.chart.rounds')} />
          <ChartTable
            label={tableLabel}
            caption={t('admin.chart.rounds')}
            columns={[t('admin.col.time'), ...modeSeries.map((s) => s.label)]}
            rows={data.rounds.map((b) => [fmtT(b.t), b.classic, b.hunt, b.swap])}
          />
        </section>

        <section className="card chart-card">
          <h3>{t('admin.chart.running')}</h3>
          <p className="muted small">{t('admin.chart.runningSub')}</p>
          <LineChart
            data={data.online}
            series={[{ key: 'playing', label: t('admin.kpi.playing'), color: SERIES.hunt }]}
            lang={lang}
            height={170}
            step={range === '24h' ? 600_000 : data.step}
            ariaLabel={t('admin.chart.running')}
          />
        </section>

        <section className="card chart-card">
          <h3>{t('admin.chart.modes')}</h3>
          <p className="muted small">{t('admin.chart.modesSub')}</p>
          <HBars items={MODES.map((m) => ({ key: m, label: t(`games.${m}`), value: data.modes[m].rounds, color: SERIES[m] }))} lang={lang} />
          <ChartTable
            label={tableLabel}
            caption={t('admin.chart.modes')}
            columns={[t('lobby.game'), t('admin.tot.rounds'), t('admin.tot.games')]}
            rows={MODES.map((m) => [t(`games.${m}`), data.modes[m].rounds, data.modes[m].games])}
          />
        </section>

        <section className="card chart-card">
          <h3>{t('admin.chart.signups')}</h3>
          <StackedColumns
            data={data.signups}
            series={[{ key: 'n', label: t('admin.tot.signups'), color: SERIES.single }]}
            lang={lang}
            height={170}
            step={data.step}
            ariaLabel={t('admin.chart.signups')}
          />
        </section>

        <section className="card chart-card">
          <h3>{t('admin.chart.reports')}</h3>
          <StackedColumns
            data={data.reports}
            series={[{ key: 'n', label: t('admin.tot.reports'), color: SERIES.swap }]}
            lang={lang}
            height={170}
            step={data.step}
            ariaLabel={t('admin.chart.reports')}
          />
        </section>
      </div>
      <p className="muted-on-dark small center-text chart-note">{t('admin.chartNote')}</p>
    </div>
  );
}
