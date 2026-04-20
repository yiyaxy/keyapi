// ============================================================
// Console UI Kit — Playground view
// ============================================================

const MOCK_REPLY = `A LLM gateway sits between your app and one or more model providers. It proxies requests, normalizes auth, and centralizes quota / billing / logging.

For new-api specifically:
  • single API key works across providers (OpenAI, Anthropic, Gemini, …)
  • per-key quota caps so a leaked key can't drain your wallet
  • token-level cost accounting in one currency
  • SmartCache deduplicates identical requests in a 60s window

Useful when you want vendor flexibility without rewriting client code.`;

function Playground() {
  const [model, setModel] = React.useState('gpt-4o');
  const [prompt, setPrompt] = React.useState('Explain LLM gateways in plain English.');
  const [reply, setReply] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [usage, setUsage] = React.useState(null);

  const run = () => {
    setReply('');
    setUsage(null);
    setRunning(true);
    let i = 0;
    const id = setInterval(() => {
      i += 4;
      if (i >= MOCK_REPLY.length) {
        clearInterval(id);
        setReply(MOCK_REPLY);
        setRunning(false);
        setUsage({ in: prompt.length / 4 | 0, out: MOCK_REPLY.length / 4 | 0, ms: 1820, cost: 0.0042 });
      } else {
        setReply(MOCK_REPLY.slice(0, i));
      }
    }, 22);
  };

  return (
    <div className="kit-view kit-pg">
      <div className="kit-pg-left">
        <div className="kit-card">
          <div className="kit-card-title">Run</div>
          <div className="kit-field">
            <label>Model</label>
            <div className="kit-select">
              <span>{model}</span>
              <Icon name="chev" size={14} />
            </div>
          </div>
          <div className="kit-pg-models">
            {['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4', 'claude-opus-4', 'gemini-2.5-pro', 'deepseek-v3'].map(m => (
              <button key={m} className={`kit-chip ${model === m ? 'on' : ''}`} onClick={() => setModel(m)}>{m}</button>
            ))}
          </div>
          <div className="kit-field">
            <label>Temperature</label>
            <div className="kit-slider"><div className="kit-slider-track"><div style={{ width: '40%' }} /></div><span className="mono">0.4</span></div>
          </div>
          <div className="kit-field">
            <label>Max tokens</label>
            <input className="kit-input" defaultValue="2048" />
          </div>
          <div className="kit-field">
            <label>System prompt</label>
            <textarea className="kit-input" rows="3" defaultValue="You are a precise technical assistant. Avoid filler." />
          </div>
        </div>
      </div>

      <div className="kit-pg-right">
        <div className="kit-card kit-pg-chat">
          <div className="kit-pg-msg user">
            <div className="kit-pg-role">USER</div>
            <textarea className="kit-pg-input" value={prompt} onChange={e => setPrompt(e.target.value)} rows="2" />
          </div>
          {(reply || running) && (
            <div className="kit-pg-msg asst">
              <div className="kit-pg-role">ASSISTANT · {model}</div>
              <pre className="kit-pg-reply">{reply}{running && <span className="kit-cursor">▌</span>}</pre>
            </div>
          )}
          {usage && (
            <div className="kit-pg-usage">
              <span><span className="muted">in</span> <b className="mono">{usage.in}</b></span>
              <span><span className="muted">out</span> <b className="mono">{usage.out}</b></span>
              <span><span className="muted">latency</span> <b className="mono">{usage.ms} ms</b></span>
              <span><span className="muted">cost</span> <b className="mono accent">${usage.cost.toFixed(4)}</b></span>
            </div>
          )}
        </div>
        <div className="kit-pg-actions">
          <button className="kit-btn kit-btn-ghost">Clear</button>
          <button className="kit-btn kit-btn-primary" onClick={run} disabled={running}>
            {running ? 'Running…' : <><Icon name="send" size={14} /> Run · ⌘↵</>}
          </button>
        </div>
      </div>
    </div>
  );
}

window.Playground = Playground;
