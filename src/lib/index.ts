/**
 * lib 层 barrel：集中导出通用基础设施工具。
 * 依赖方向：上层（providers / player / pages / App）可依赖 lib，但 lib 不反向依赖上层。
 */

export { mapLimit } from './mapLimit'
export { mulberry32 } from './random'
export { SAFE_AREA, SUPPORTS_SAFE_AREA } from './safeArea'
export { dataRef, persist, saveTimerRef } from './persist'
export { pinyinInitials, correctQuery, TYPO_DICT, COMMON_TITLES } from './correct'
export type { CorrectResult } from './correct'
export {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory
} from './searchHistory'
export {
  QueueManager,
  type DownloadTask,
  type DownloadStatus,
  type QueueManagerOptions,
  type DownloadFn,
  type PlatformDownloadFn
} from './downloadQueue'
