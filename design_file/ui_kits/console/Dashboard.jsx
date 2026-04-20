// ============================================================
// Console UI Kit — Dashboard view
// ============================================================

function StatCard({ eyebrow, value, sub, accent, sparkline, prefix }) {
  return (
    <div className="kit-card kit-stat">
      <div className="kit-eyebrow">{eyebrow}</div>
      <div className={`kit-num ${accent ? 'is-accent' : ''}`}>
        {prefix && <span className="kit-num-prefix">{prefix}</span>}
        {value}
      </div>
      {sub && <div className="kit-stat-sub">{sub}</div>}
      {sparkline && (
        <svg className="kit-spark" viewBox="0 0 120 32" preserveAspectRatio="none">
          <polyline points={sparkline} fill="none" stroke="currentColor" strokeWidth="1.25" />
          <polyline points={`0,32 ${sparkline} 120,32`} fill="currentColor" opacity="0.08" stroke="none" />
        </svg>
      )}
    </div>
  );
}

function SpendChart() {
  const data = [22,28,24,32,30,38,42,40,48,52,46,58,62,55,68,72,78,70,82,88,80,94,98,90,108,116,120,112,124,132];
  const max = Math.max(...data);
  return (
    <div className="kit-card kit-chart">
      <div className="kit-card-head">
        <div>
          <div className="kit-eyebrow">Spend · last 30 days</div>
          <div className="kit-num kit-num-md"><span className="kit-num-prefix">$</span>284<span className="kit-num-prefix">.12</span></div>
        </div>
        <div className="kit-tabs">
          <button className="kit-tab active">30d</button>
          <button className="kit-tab">7d</button>
          <button className="kit-tab">24h</button>
        </div>
      </div>
      <div className="kit-bars">
        {data.map((d, i) => (
          <div key={i} className="kit-bar" style={{ height: `${(d/max)*100}%` }} title={`Day ${i+1}: $${d/10}`} />
        ))}
      </div>
      <div className="kit-axis">
        <span>Mar 19</span><span>Apr 3</span><span>Apr 17</span>
      </div>
    </div>
  );
}

function ChannelStatus() {
  const ch = [
    { name: 'OpenAI · primary',     ok: true,  ms: 412, share: 64 },
    { name: 'Anthropic · primary',  ok: true,  ms: 389, share: 22 },
    { name: 'Google AI · fallback', ok: true,  ms: 612, share: 11 },
    { name: 'Azure · backup',       ok: false, ms: 0,   share: 3,  err: 'Quota exceeded' },
  ];
  return (
    <div className="kit-card">
      <div className="kit-card-head">
        <div className="kit-eyebrow">Upstream channels</div>
        <a className="kit-link">All →</a>
      </div>
      <div className="kit-channels">
        {ch.map(c => (
          <div key={c.name} className="kit-ch-row">
            <span className={`kit-dot ${c.ok ? 'ok' : 'err'}`} />
            <div className="kit-ch-name">{c.name}</div>
            <div className="kit-ch-bar"><div style={{ width: `${c.share}%` }} /></div>
            <div className="kit-ch-share">{c.share}%</div>
            <div className="kit-ch-ms">{c.ok ? `${c.ms} ms` : c.err}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentLogs() {
  const rows = [
    { t: '12:42:08', method: 'POST', model: 'gpt-4o',          status: 200, in: 1240, out: 480, ms: 1820 },
    { t: '12:41:51', method: 'POST', model: 'claude-sonnet-4', status: 200, in: 880,  out: 1240, ms: 2410 },
    { t: '12:41:34', method: 'POST', model: 'gpt-4o-mini',     status: 200, in: 320,  out: 80,  ms: 412 },
    { t: '12:41:22', method: 'POST', model: 'gpt-4o',          status: 401, in: 0,    out: 0,   ms: 88 },
    { t: '12:40:59', method: 'POST', model: 'gemini-2.5-pro',  status: 200, in: 2100, out: 980, ms: 3120 },
    { t: '12:40:41', method: 'POST', model: 'claude-sonnet-4', status: 200, in: 412,  out: 220, ms: 1180 },
  ];
  return (
    <div className="kit-card">
      <div className="kit-card-head">
        <div className="kit-eyebrow">Recent requests</div>
        <a className="kit-link">Open logs →</a>
      </div>
      <table className="kit-table">
        <thead><tr><th>Time</th><th>Model</th><th className="num">In</th><th className="num">Out</th><th className="num">Lat</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.t}</td>
              <td>{r.model}</td>
              <td className="num">{r.in.toLocaleString()}</td>
              <td className="num">{r.out.toLocaleString()}</td>
              <td className="num">{r.ms} ms</td>
              <td>{r.status === 200 ? <span className="kit-pill ok">200</span> : <span className="kit-pill err">{r.status}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ setView }) {
  return (
    <div className="kit-view">
      <div className="kit-hero">
        <div>
          <div className="kit-eyebrow">Balance</div>
          <div className="kit-num kit-num-xl">
            <span className="kit-num-prefix">$</span>1,284<span className="kit-num-prefix">.50</span>
          </div>
          <div className="kit-stat-sub">Renews · top-up triggers when below $20.00</div>
        </div>
        <div className="kit-hero-actions">
          <button className="kit-btn kit-btn-secondary" onClick={() => setView('keys')}>Manage keys</button>
          <button className="kit-btn kit-btn-primary" onClick={() => setView('bill')}>Top up</button>
        </div>
      </div>

      <div className="kit-grid-3">
        <StatCard eyebrow="This month" prefix="$" value="284.12" sub={<span className="kit-up">↑ $42.10 vs last month</span>}
          sparkline="0,28 12,24 24,30 36,18 48,22 60,12 72,16 84,8 96,14 108,6 120,10" />
        <StatCard eyebrow="Tokens · 30d" value="9,432,108" sub={<span className="kit-down">↓ 4.2% vs prev</span>}
          sparkline="0,16 12,20 24,18 36,22 48,14 60,18 72,10 84,14 96,8 108,12 120,6" />
        <StatCard eyebrow="Requests · 24h" value="14,082" accent sub={<span className="muted">42 errors · 0.3%</span>}
          sparkline="0,24 12,18 24,22 36,12 48,16 60,8 72,14 84,6 96,10 108,4 120,8" />
      </div>

      <SpendChart />

      <div className="kit-grid-2">
        <ChannelStatus />
        <RecentLogs />
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
