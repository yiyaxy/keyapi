// ============================================================
// Console UI Kit — App shell
// ============================================================

function App() {
  const [view, setView] = React.useState(() => localStorage.getItem('kit-view') || 'dash');
  const [openCreate, setOpenCreate] = React.useState(false);
  React.useEffect(() => { localStorage.setItem('kit-view', view); }, [view]);

  const titles = {
    dash: 'Dashboard',
    keys: 'API keys',
    play: 'Playground',
    logs: 'Logs',
    bill: 'Top up · invoices',
  };

  return (
    <div className="kit-app">
      <Sidebar view={view} setView={setView} />
      <main className="kit-main">
        <Topbar
          title={titles[view]}
          action={
            view === 'dash' ? <button className="kit-btn kit-btn-secondary kit-btn-sm"><Icon name="refresh" size={13} /> Refresh</button>
            : view === 'keys' ? <button className="kit-btn kit-btn-primary kit-btn-sm" onClick={() => setOpenCreate(true)}><Icon name="plus" size={13} /> New key</button>
            : null
          }
        />
        <div className="kit-content">
          {view === 'dash' && <Dashboard setView={setView} />}
          {view === 'keys' && <Keys openCreate={openCreate} setOpenCreate={setOpenCreate} />}
          {view === 'play' && <Playground />}
          {view === 'bill' && <Billing />}
          {view === 'logs' && (
            <div className="kit-view"><div className="kit-card kit-empty">
              <div className="kit-eyebrow">Logs</div>
              <div className="kit-card-title">Streaming logs view</div>
              <p className="muted">Live request log with filter chips and trace drill-down. Out of scope for this kit pass.</p>
            </div></div>
          )}
        </div>
      </main>
    </div>
  );
}

window.App = App;
