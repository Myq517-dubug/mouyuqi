export interface VideoSource {
  name: string
  url: string
  type?: 'hls' | 'mp4' | 'other'
  /** 测速结果（毫秒）；-1 表示不可达/超时；undefined 表示尚未测速 */
  speed?: number
  /** 清晰度档位（新增）：1080P / 720P / 480P / 360P / 2160P / 未知。HLS 来自 level.height，MP4 由源名/URL 关键词推断。 */
  quality?: string
  /** HLS level.height 像素值，或 MP4 推断高度。 */
  height?: number
}

export interface SearchResult {
  id: string
  title: string
  provider: string
  poster?: string
  year?: string
  description?: string
  /** 豆瓣/IMDb 等元数据补全的评分（字符串，如 "8.7"） */
  rating?: string
  sources?: VideoSource[]
  /** 分类（首页固定分类）：综艺 / 电影 / 电视剧 / 动漫 / 短剧 / 其他。来自苹果CMS 分类字段或标题关键词映射，兜底「其他」。 */
  category?: string
  /** 更新时间（vod_time），列表页「更新时间」排序用；缺失置尾 */
  time?: string
  /** 热度（vod_hits），列表页「热度」排序用；缺失置尾 */
  hits?: number
  /** 类型标签（type_name/vod_type 等），列表页「类型」筛选用 */
  typeName?: string
}

/** 元数据补全结果（可选功能，失败/未启用时为 null） */
export interface Meta {
  poster?: string
  year?: string
  rating?: string
  summary?: string
}

/** 画质增强档位（从 Player 内联上提，作为 Settings/PlaybackPrefs 共享类型） */
export type EnhanceLevel = 'off' | 'light' | 'medium' | 'strong'

/** 音频档位（Web Audio 等效实现，非真杜比解码）：杜比环绕 / 空间音频 / 低音增强 / 原声 */
export type AudioMode = 'dolby' | 'spatial' | 'bass' | 'original'

/** 播放偏好（倍速 + 增强档 + 上次源索引 + 代理默认勾选 + 音频档位），写入 Settings.playback 持久化 */
export interface PlaybackPrefs {
  speed: number
  enhance: EnhanceLevel
  lastSourceIdx?: number
  /** 播放器「播放走代理」勾选默认值（缺省视为 true，含历史用户）；与全局 proxyEnabled 解耦 */
  proxyByDefault?: boolean
  /** 音频档位（缺省 'original'，不改变既有听感） */
  audioMode?: AudioMode
}

/** 卡顿切源状态机（Player 内部使用，不持久化） */
export interface StutterGuardState {
  buffering: boolean
  /** 已尝试过的源索引（去重，避免无限切换） */
  triedSources: number[]
  /** 上次切源时间戳（performance.now），用于冷却判断 */
  lastSwitchAt: number
  /** 当前卡顿事件起始时间戳，0 表示未在卡顿 */
  stallSince: number
}

/** 源分组（按 清晰度 × 格式 二维折叠），Player 内部使用 */
export interface SourceGroup {
  key: string
  quality: string
  format: string
  sources: VideoSource[]
  collapsed: boolean
}

/** 首页三段式聚合结果 */
export interface HomeFeed {
  /** 按分类聚合的推荐列表 */
  byCategory: Record<string, SearchResult[]>
  /** 排行榜：score = rating * (1 + log(1 + 有效源数))，无 rating 置尾 */
  ranking: SearchResult[]
  /** 评分榜：rating 降序，无 rating 置尾 */
  topRated: SearchResult[]
}

/** 分类列表页细分类筛选条件（任一即可叠加） */
export interface CategoryFilters {
  year?: string
  typeName?: string
  provider?: string
  quality?: string
}

/** 分类列表页排序（本地兜底） */
export type CategorySort = 'default' | 'time' | 'rating' | 'hits'

/** 分类列表页查询契约 */
export interface CategoryListQuery {
  category: string
  page: number
  perPage?: number
  filters?: CategoryFilters
  sort?: CategorySort
}

/** 分类列表页结果（total 为本地聚合去重计数，非权威全量） */
export interface CategoryListResult {
  items: SearchResult[]
  page: number
  hasMore: boolean
  total: number
}

/** 首页深化区块数据（猜你喜欢/最近更新/高评分） */
export interface RecommendBlock {
  title: string
  items: SearchResult[]
  seed?: number
  action?: 'more' | 'refresh'
}

export interface Settings {
  proxyEnabled: boolean
  /** 出口/上游代理（可选）。填写后本地代理转发请求会经此代理出网，可解锁海外源。
   *  支持 http:// / https://（HTTP 代理）/ socks:// / socks5://（SOCKS 代理） */
  upstreamProxy?: string
  downloadDir: string
  theme: 'dark' | 'light'
  /** 资源站（搜索源）配置：消费苹果CMS 等开放 API，按关键词返回国内可播源 */
  resourceSites: ResourceSite[]
  /** 播放源自动测速优选（默认开启）：搜索结果对每个源做 HEAD 测速，播放默认可达最快源 */
  speedTest: boolean
  /** 元数据补全（可选）：填入 {title} 占位模板的 API，搜索时补全海报/年份/评分/简介 */
  metaSource?: string
  /** 是否启用元数据补全 */
  metaEnabled: boolean
  /** 播放偏好（新增）：倍速 / 增强档 / 上次源索引 */
  playback?: PlaybackPrefs
}

/** 资源站配置：一个开放 API 端点即一个搜索源。请仅添加你有权使用的来源。 */
export interface ResourceSite {
  id: string
  name: string
  /** API 基地址，如 https://example.com/api.php/provide/vod/ */
  api: string
  enabled: boolean
}

export interface HistoryEntry {
  item: SearchResult
  progress: number
  duration: number
  updatedAt: number
}

export interface AppData {
  favorites: SearchResult[]
  history: Record<string, HistoryEntry>
  customSources: SearchResult[]
  /** 片单：一键加入的可观看列表，点击即播放 */
  playlist: SearchResult[]
  settings: Settings
}

export interface Provider {
  id: string
  name: string
  enabled: boolean
  search: (q: string) => Promise<SearchResult[]>
  getSources: (item: SearchResult) => Promise<VideoSource[]>
}
