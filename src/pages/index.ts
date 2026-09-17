/**
 * 页面层 barrel：集中导出所有页面组件，保持 v1 导出命名不变。
 * App.tsx 等调用方以 `import { Home, SearchPage, ... } from './pages'` 使用（解析到本文件）。
 */
export { Home } from './Home'
export { SearchPage } from './SearchPage'
export { LibraryPage } from './LibraryPage'
export { PlaylistPage } from './PlaylistPage'
export { ResourceCenterPage } from './ResourceCenterPage'
export { SettingsPage } from './SettingsPage'
export { DetailPage } from './DetailPage'
export { CategoryPage } from './CategoryPage'
export { DiscoverPage } from './DiscoverPage'
export { VipPage } from './VipPage'
export { MePage } from './MePage'
