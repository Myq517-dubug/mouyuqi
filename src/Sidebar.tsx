export default function Sidebar({
  view,
  setView
}: {
  view: string
  setView: (v: string) => void
}) {
  const items = [
    { k: 'home', label: '🏠 首页' },
    { k: 'search', label: '🔍 搜索' },
    { k: 'playlist', label: '📺 片单' },
    { k: 'library', label: '⭐ 收藏' },
    { k: 'resource', label: '🌐 资源' },
    { k: 'settings', label: '⚙️ 设置' }
  ]
  return (
    <aside className="sidebar">
      <div className="brand">M快播</div>
      {items.map((i) => (
        <button
          key={i.k}
          className={'nav-item' + (view === i.k ? ' active' : '')}
          onClick={() => setView(i.k)}
        >
          {i.label}
        </button>
      ))}
      <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--text-dim)', padding: '10px' }}>
        多源切换 · 跨源搜索 · 本地续播
      </div>
    </aside>
  )
}
