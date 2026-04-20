// ============================================================
// Console UI Kit — API Keys view
// ============================================================

const KEY_ROWS = [
  { id: 1, name: 'prod-backend',   key: 'sk-newapi-V8jR2fLp9qK3tN7m', created: 'Mar 12', spent: 124.18, quota: 500,  status: 'active' },
  { id: 2, name: 'local-dev',      key: 'sk-newapi-r4L9zXcVbNmKjHgF', created: 'Apr 02', spent:  12.97, quota: 100,  status: 'active' },
  { id: 3, name: 'edge-worker',    key: 'sk-newapi-m71xQwErTyUiOpAs', created: 'Mar 28', spent:  88.04, quota:  95,  status: 'warn'   },
  { id: 4, name: 'analytics-cron', key: 'sk-newapi-q0PaSdFgHjKlZxCv', created: 'Apr 11', spent:   3.42, quota: 50,   status: 'active' },
  { id: 5, name: 'old-test',       key: 'sk-newapi-w2EeRrTyUiPpAaSs', created: 'Feb 17', spent:   0.00, quota: 10,   status: 'revoked' },
];

function fmt(n) { return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function Keys({ openCreate, setOpenCreate }) {
  const [revealed, setRevealed] = React.useState({});
  const [copied, setCopied] = React.useState(null);
  const onCopy = (id, key) => {
    navigator.clipboard?.writeText(key);
    setCopied(id);
    setTimeout(() => setCopied(null), 1400);
  };
  return (
    <div className="kit-view">
      <div className="kit-card">
        <div className="kit-card-head">
          <div>
            <div className="kit-eyebrow">5 keys · 1 revoked</div>
            <div className="kit-card-title">API keys</div>
          </div>
          <div className="kit-card-actions">
            <input className="kit-input kit-input-sm" placeholder="Search keys…" />
            <button className="kit-btn kit-btn-primary" onClick={() => setOpenCreate(true)}>
              <Icon name="plus" size={14} /> New key
            </button>
          </div>
        </div>
        <table className="kit-table kit-table-lg">
          <thead><tr>
            <th>Name</th><th>Key</th><th>Created</th>
            <th className="num">Spent</th><th>Quota</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {KEY_ROWS.map(r => (
              <tr key={r.id} className={r.status === 'revoked' ? 'is-muted' : ''}>
                <td><div className="kit-key-name">{r.name}</div></td>
                <td className="mono kit-key-cell">
                  <span>{revealed[r.id] ? r.key : `${r.key.slice(0,11)}…${r.key.slice(-4)}`}</span>
                  <button className="kit-iconbtn" onClick={() => setRevealed(s => ({ ...s, [r.id]: !s[r.id] }))} title="Reveal"><Icon name="eye" size={13} /></button>
                  <button className="kit-iconbtn" onClick={() => onCopy(r.id, r.key)} title="Copy">
                    {copied === r.id ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
                  </button>
                </td>
                <td className="muted">{r.created}</td>
                <td className="num">${fmt(r.spent)}</td>
                <td>
                  <div className="kit-quota">
                    <div className={`kit-quota-bar ${r.status === 'warn' ? 'warn' : ''}`}>
                      <div style={{ width: `${Math.min(100, (r.spent / r.quota) * 100)}%` }} />
                    </div>
                    <span className="kit-quota-num">${fmt(r.quota)}</span>
                  </div>
                </td>
                <td>
                  {r.status === 'active'  && <span className="kit-pill ok"><span className="kit-dot ok" />Active</span>}
                  {r.status === 'warn'    && <span className="kit-pill warn"><span className="kit-dot warn" />Quota 92%</span>}
                  {r.status === 'revoked' && <span className="kit-pill neutral"><span className="kit-dot off" />Revoked</span>}
                </td>
                <td className="kit-row-end">
                  <button className="kit-iconbtn kit-iconbtn-danger" title="Revoke">⋯</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openCreate && (
        <>
          <div className="kit-scrim" onClick={() => setOpenCreate(false)} />
          <aside className="kit-sheet">
            <div className="kit-sheet-head">
              <div>
                <div className="kit-eyebrow">New API key</div>
                <h3 className="kit-sheet-title">Create a key</h3>
              </div>
              <button className="kit-iconbtn" onClick={() => setOpenCreate(false)}>✕</button>
            </div>
            <div className="kit-sheet-body">
              <div className="kit-field">
                <label>Name</label>
                <input className="kit-input" defaultValue="staging-edge" />
                <span className="kit-help">Shown in logs and billing exports.</span>
              </div>
              <div className="kit-field">
                <label>Quota cap</label>
                <div className="kit-input-affix">
                  <span className="kit-affix">$</span>
                  <input className="kit-input" defaultValue="100.00" />
                </div>
                <span className="kit-help">Set to 0 for no cap.</span>
              </div>
              <div className="kit-field">
                <label>Allowed models</label>
                <div className="kit-chips">
                  <span className="kit-chip on">gpt-4o</span>
                  <span className="kit-chip on">gpt-4o-mini</span>
                  <span className="kit-chip on">claude-sonnet-4</span>
                  <span className="kit-chip">claude-opus-4</span>
                  <span className="kit-chip">gemini-2.5-pro</span>
                  <span className="kit-chip">+ 12 more</span>
                </div>
              </div>
            </div>
            <div className="kit-sheet-foot">
              <button className="kit-btn kit-btn-ghost" onClick={() => setOpenCreate(false)}>Cancel</button>
              <button className="kit-btn kit-btn-primary" onClick={() => setOpenCreate(false)}>Create key</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

window.Keys = Keys;
