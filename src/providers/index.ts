/**
 * providers 层 barrel：重新导出各模块公共函数，保持 v1 在 providers.ts 中的全部导出名不变。
 * 调用方（App.tsx / pages.tsx 等）继续 `import ... from './providers'` 即可零改动。
 *
 * 依赖方向：lib → providers → 上层。
 */

// 通用基础设施（v1 在 providers.ts 亦导出）
export { mapLimit } from '../lib/mapLimit'

// 共享状态 setter（App 注入环境用）
export {
  setCustomSources,
  setResourceSites,
  setProxyEnv,
  setMetaSource
} from './state'

// 苹果CMS 解析 / 媒体地址解析 / 类型
export {
  capFetchText,
  fetchAppleCmsItems,
  parseAppleCms,
  parseAppleCmsXml,
  resolveMediaUrl
} from './appleCms'
export type { ResolvedMedia } from './appleCms'

// 测速 / 清晰度识别
export {
  measureSpeed,
  speedTestAll,
  sortSourcesByLatency,
  classifySources
} from './speed'

// 元数据补全
export { fetchMeta, enrichMeta, postProcess, DEFAULT_META_SOURCE } from './meta'

// 资源站 / 自定义源 / 健康探活
export {
  customProvider,
  DEFAULT_RESOURCE_SITES,
  allProviders,
  checkResourceSite,
  checkAllResourceSites,
  probeResourceSite,
  getResourceSites
} from './resource'
export type { SiteCheck, ProbeResult } from './resource'

// 首页聚合
export {
  getHomeFeed,
  buildHomeFeed,
  HOME_CATEGORIES,
  recentUpdated,
  mergeResults,
  mergeById
} from './home'
export type { HomeFeed } from '../types'

// 分类页 / 筛选排序
export {
  fetchCategoryPage,
  fetchCategoryPool,
  fetchCategoryPageAll,
  getCategoryList,
  applyFilters,
  applySort,
  classifyCategory,
  mapCategoryText
} from './category'

// 跨源搜索聚合 / 常量
export {
  aggregateSearch,
  AUDIO_MODES,
  AUDIO_LABEL,
  SORT_OPTIONS,
  getLastSearchDiag
} from './search'
export type { SearchDiag } from './search'

// 猜你喜欢推荐
export { buildRecommendations } from './recommend'
export { mulberry32 } from './recommend'
