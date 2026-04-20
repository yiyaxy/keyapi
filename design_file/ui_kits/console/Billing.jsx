// ============================================================
// Console UI Kit — Billing / Top up view
// ============================================================

const PRESETS = [10, 50, 100, 500, 1000];
const INVOICES = [
  { date: 'Apr 12 · 2026', amount: 50.00, method: 'Card · 4242', status: 'Paid', id: 'INV-0428' },
  { date: 'Mar 28 · 2026', amount: 100.00, method: 'Card · 4242', status: 'Paid', id: 'INV-0421' },
  { date: 'Mar 02 · 2026', amount: 50.00, method: 'Apple Pay',   status: 'Paid', id: 'INV-0410' },
  { date: 'Feb 18 · 2026', amount: 200.00, method: 'Card · 4242', status: 'Paid', id: 'INV-0399' },
];

function Billing() {
  const [amount, setAmount] = React.useState(50);
  const [custom, setCustom] = React.useState('');
  const value = custom ? Number(custom) || 0 : amount;
  return (
    <div className="kit-view">
      <div className="kit-grid-2">
        <div className="kit-card">
          <div className="kit-eyebrow">Top up</div>
          <div className="kit-card-title">Add funds</div>
          <div className="kit-presets">
            {PRESETS.map(p => (
              <button key={p} className={`kit-preset ${!custom && amount === p ? 'on' : ''}`}
                      onClick={() => { setAmount(p); setCustom(''); }}>
                <span className="kit-num kit-num-md"><span className="kit-num-prefix">$</span>{p}</span>
              </button>
            ))}
          </div>
          <div className="kit-field">
            <label>Or custom amount</label>
            <div className="kit-input-affix">
              <span className="kit-affix">$</span>
              <input className="kit-input" placeholder="0.00" value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
          </div>
          <div className="kit-pay-summary">
            <div className="kit-pay-row"><span className="muted">Subtotal</span><span className="mono">${value.toFixed(2)}</span></div>
            <div className="kit-pay-row"><span className="muted">Tax (est.)</span><span className="mono">$0.00</span></div>
            <div className="kit-pay-row total"><span>Total</span><span className="kit-num kit-num-md"><span className="kit-num-prefix">$</span>{value.toFixed(2)}</span></div>
          </div>
          <div className="kit-pay-methods">
            <button className="kit-pay-method on">
              <span className="kit-pay-mark">VISA</span><span>•••• 4242</span><span className="kit-pay-spacer" /><Icon name="check" size={14} />
            </button>
            <button className="kit-pay-method"><span className="kit-pay-mark">⌥</span><span>Apple Pay</span></button>
            <button className="kit-pay-method"><span className="kit-pay-mark">G</span><span>Google Pay</span></button>
          </div>
          <button className="kit-btn kit-btn-primary kit-btn-block">Pay ${value.toFixed(2)}</button>
        </div>

        <div className="kit-flex-col">
          <div className="kit-card">
            <div className="kit-eyebrow">Current plan</div>
            <div className="kit-plan-row">
              <div>
                <div className="kit-plan-name">Pro</div>
                <div className="muted">$20 / mo · auto top-up at $20.00 balance</div>
              </div>
              <button className="kit-btn kit-btn-secondary kit-btn-sm">Change</button>
            </div>
            <div className="kit-plan-meter">
              <div className="kit-plan-meter-row">
                <span>Spend this month</span>
                <span className="mono">$284.12 / $1,000.00</span>
              </div>
              <div className="kit-quota-bar"><div style={{ width: '28%' }} /></div>
            </div>
          </div>

          <div className="kit-card">
            <div className="kit-card-head">
              <div>
                <div className="kit-eyebrow">Invoices</div>
                <div className="kit-card-title">Recent</div>
              </div>
              <a className="kit-link">All →</a>
            </div>
            <table className="kit-table">
              <thead><tr><th>Date</th><th>ID</th><th>Method</th><th className="num">Amount</th><th></th></tr></thead>
              <tbody>
                {INVOICES.map(i => (
                  <tr key={i.id}>
                    <td className="muted">{i.date}</td>
                    <td className="mono">{i.id}</td>
                    <td>{i.method}</td>
                    <td className="num">${i.amount.toFixed(2)}</td>
                    <td className="kit-row-end"><a className="kit-link">PDF</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Billing = Billing;
