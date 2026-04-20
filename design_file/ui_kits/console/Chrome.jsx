// ============================================================
// Console UI Kit — Sidebar + Topbar
// ============================================================

function Logo() {
  return (
    <div className="kit-logo">
      <img src="../../assets/logo.png" alt="" />
      <span>new<span className="dot">·</span>api</span>
    </div>
  );
}

function Icon({ name, size = 16 }) {
  const s = size;
  const p = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'dash':    return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>;
    case 'key':     return <svg {...p}><path d="M21 2l-2 2"/><circle cx="7.5" cy="15.5" r="5.5"/><path d="m11.5 11.5 7-7 3 3-7 7m-3-3 3 3"/></svg>;
    case 'play':    return <svg {...p}><polygon points="6 3 20 12 6 21 6 3"/></svg>;
    case 'log':     return <svg {...p}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
    case 'money':   return <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case 'plus':    return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
    case 'search':  return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>;
    case 'check':   return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'copy':    return <svg {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
    case 'eye':     return <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'send':    return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
    case 'invoice': return <svg {...p}><path d="M3 3h18v4H3zM3 11h18v10H3zM7 15h6"/></svg>;
    case 'chev':    return <svg {...p}><polyline points="6 9 12 15 18 9"/></svg>;
    case 'menu':    return <svg {...p}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
    case 'refresh': return <svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>;
    case 'cmd':     return <svg {...p}><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>;
    default: return null;
  }
}

function Sidebar({ view, setView }) {
  const items = [
    { group: 'Build', items: [
      { id: 'dash', label: 'Dashboard', icon: 'dash' },
      { id: 'keys', label: 'API keys', icon: 'key' },
      { id: 'play', label: 'Playground', icon: 'play' },
      { id: 'logs', label: 'Logs', icon: 'log' },
    ]},
    { group: 'Billing', items: [
      { id: 'bill', label: 'Top up · invoices', icon: 'money' },
    ]},
  ];
  return (
    <aside className="kit-sb">
      <Logo />
      <nav>
        {items.map(g => (
          <div key={g.group} className="kit-sb-group">
            <div className="kit-sb-grouplabel">{g.group}</div>
            {g.items.map(it => (
              <a key={it.id} className={`kit-sb-item ${view === it.id ? 'active' : ''}`} onClick={() => setView(it.id)}>
                <Icon name={it.icon} />
                <span>{it.label}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="kit-sb-bottom">
        <div className="kit-sb-user">
          <div className="kit-avatar">SY</div>
          <div className="kit-sb-userinfo">
            <div className="kit-sb-name">su.yang</div>
            <div className="kit-sb-org">Acme Inc · Pro</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, action }) {
  return (
    <header className="kit-tb">
      <div className="kit-tb-title">{title}</div>
      <div className="kit-tb-right">
        <button className="kit-cmd">
          <Icon name="search" size={14} />
          <span>Find anything</span>
          <kbd>⌘K</kbd>
        </button>
        {action}
      </div>
    </header>
  );
}

window.Logo = Logo;
window.Icon = Icon;
window.Sidebar = Sidebar;
window.Topbar = Topbar;
