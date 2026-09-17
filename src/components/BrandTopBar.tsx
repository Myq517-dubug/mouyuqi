/**
 * 顶部品牌区（参照 Ardot 设计稿）。
 * 左：M快播 logo（红 M + 白"快播"）；右：金色搜索/铃铛入口 → 点击进发现页。
 */
export default function BrandTopBar({
  onSearch
}: {
  onSearch: () => void
}) {
  return (
    <header className="brand-topbar">
      <div className="brand-logo">
        <span className="brand-mark">M</span>
        <span className="brand-name">快播</span>
      </div>
      <button className="brand-search" onClick={onSearch} aria-label="搜索">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.8-3.8" />
        </svg>
        <span className="brand-search-text">MyQuiet</span>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
      </button>
    </header>
  )
}
