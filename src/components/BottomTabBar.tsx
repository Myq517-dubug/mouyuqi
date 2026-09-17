/**
 * 底部 TabBar（移动端竖屏导航）。
 * 参照 Ardot 设计稿：深色底 + 红色高亮当前项。
 * v2.1.1：按用户反馈移除「会员」Tab，保留 3 项：首页 / 发现 / 我的。
 * 桌面端（≥1025px）由 CSS 隐藏，保留左侧 Sidebar。
 */
export type AppRoute = 'home' | 'discover' | 'me'

const ICONS: Record<AppRoute, React.ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.2 12 3l9 7.2" />
      <path d="M5.5 8.6V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8.6" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  ),
  discover: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4.5 20.5c.6-4 3.9-6 7.5-6s6.9 2 7.5 6" />
    </svg>
  )
}

export default function BottomTabBar({
  route,
  onChange
}: {
  route: AppRoute
  onChange: (r: AppRoute) => void
}) {
  const tabs: { id: AppRoute; label: string }[] = [
    { id: 'home', label: '首页' },
    { id: 'discover', label: '发现' },
    { id: 'me', label: '我的' }
  ]
  return (
    <nav className="bottom-tab-bar">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={'bt-tab' + (route === t.id ? ' active' : '')}
          onClick={() => onChange(t.id)}
          aria-label={t.label}
        >
          {ICONS[t.id]}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
