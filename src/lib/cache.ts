/**
 * 轻量两层缓存（原生 localStorage + 内存 Map，无第三方依赖）。
 * 用于首页聚合 / 分类列表等可重放的网络结果，降低重复拉取与首屏抖动。
 *
 * 设计要点：
 * - L1：内存 Map（进程内最快）；L2：localStorage（跨会话，key 前缀 `mkp:`）。
 * - TTL 默认 10min；LRU 上限 4MB（近似估算，超界淘汰最旧条目）。
 * - 读写全部 try/catch 包裹：localStorage 不可用（隐私模式 / 配额满）时静默降级为仅内存。
 */

export const CACHE_PREFIX = 'mkp:'
export const DEFAULT_TTL = 10 * 60 * 1000 // 10 分钟
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 // 4MB

/** 缓存条目（含写入时间戳与 TTL，便于过期与估算体积）。 */
interface CacheEntry<T> {
  v: T
  t: number // 写入时间（performance.now 基线不适用跨会话，统一用 Date.now）
  ttl: number
}

/** 缓存契约：get 同步返回（命中且未过期），set 同步写入，size 用于 LRU 估算。 */
export interface CacheStore {
  get<T>(key: string): T | null
  set<T>(key: string, value: T, ttl?: number): void
  has(key: string): boolean
  delete(key: string): void
  clear(): void
}

/**
 * 两层缓存实现：内存 Map 一级 + localStorage 二级（TTL + LRU 体积上限）。
 * 不抛出任何异常（localStorage 异常 → 仅内存生效）。
 */
export class LocalStorageCache implements CacheStore {
  private mem = new Map<string, CacheEntry<any>>()
  private prefix: string
  private ttl: number
  private maxBytes: number

  constructor(opts?: { prefix?: string; ttl?: number; maxBytes?: number }) {
    this.prefix = opts?.prefix ?? CACHE_PREFIX
    this.ttl = opts?.ttl ?? DEFAULT_TTL
    this.maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  }

  /** 同步读取：命中且未过期返回（并刷新 LRU 顺序）；过期/未命中返回 null。 */
  get<T>(key: string): T | null {
    const full = this.prefix + key
    // L1
    const hit = this.mem.get(full)
    if (hit && !this.isExpired(hit)) {
      this.touch(full, hit)
      return hit.v as T
    }
    // L2
    try {
      const raw = localStorage.getItem(full)
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry<T>
        if (!this.isExpired(entry)) {
          this.mem.set(full, entry) // 回灌 L1
          this.touch(full, entry)
          return entry.v as T
        }
        localStorage.removeItem(full) // 过期即清
      }
    } catch {
      /* localStorage 不可用 → 忽略 */
    }
    if (hit) this.mem.delete(full) // L1 过期残留清理
    return null
  }

  /** 同步写入：先写 L1，再写 L2，并触发 LRU 体积淘汰。 */
  set<T>(key: string, value: T, ttl?: number): void {
    const full = this.prefix + key
    const entry: CacheEntry<T> = { v: value, t: Date.now(), ttl: ttl ?? this.ttl }
    this.mem.set(full, entry)
    try {
      const raw = JSON.stringify(entry)
      localStorage.setItem(full, raw)
      this.evictIfNeeded(raw.length)
    } catch {
      /* 配额满 / 不可写 → 仅内存命中 */
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): void {
    const full = this.prefix + key
    this.mem.delete(full)
    try {
      localStorage.removeItem(full)
    } catch {
      /* ignore */
    }
  }

  clear(): void {
    // 仅清理本前缀下的条目，避免误删其它 localStorage 数据
    this.mem.clear()
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(this.prefix)) keys.push(k)
      }
      keys.forEach((k) => localStorage.removeItem(k))
    } catch {
      /* ignore */
    }
  }

  // ---------- 内部 ----------

  private isExpired(e: CacheEntry<any>): boolean {
    return Date.now() - e.t > e.ttl
  }

  /** 刷新 LRU 顺序：删除后重新 set（Map 遍历顺序即插入顺序，末位为最新）。 */
  private touch(full: string, entry: CacheEntry<any>): void {
    this.mem.delete(full)
    this.mem.set(full, entry)
  }

  /** LRU 体积估算：累加 L1 条目序列化长度，超 maxBytes 淘汰最旧（Map 首部）。 */
  private evictIfNeeded(addedBytes: number): void {
    let total = addedBytes
    for (const e of this.mem.values()) {
      total += JSON.stringify(e).length
    }
    if (total <= this.maxBytes) return
    // 从最旧（Map 首部）开始淘汰，直到回到上限内
    for (const full of this.mem.keys()) {
      this.mem.delete(full)
      try {
        localStorage.removeItem(full)
      } catch {
        /* ignore */
      }
      // 粗略回算剩余：直接重新累加
      let remaining = 0
      for (const e of this.mem.values()) remaining += JSON.stringify(e).length
      if (remaining + addedBytes <= this.maxBytes) break
    }
  }
}

// ---------- 业务实例 ----------

/** 首页聚合缓存（key = 启用站点签名 + meta 配置）。 */
export const homeCache = new LocalStorageCache({ prefix: CACHE_PREFIX + 'home:' })

/** 分类列表缓存（key = 启用站点签名 + 分类 + 页号）。 */
export const categoryCache = new LocalStorageCache({ prefix: CACHE_PREFIX + 'cat:' })

/**
 * 生成首页缓存 key：以「启用资源站 id 列表 + 自定义源条数 + meta 配置」指纹，
 * 任一变化即视为不同结果（保证首次/过期走真实拉取，不缓存脏数据）。
 */
export function homeCacheKey(
  sites: { id: string; enabled: boolean }[],
  opts: { metaEnabled: boolean; metaSource: string; customCount: number }
): string {
  const enabledIds = (sites || [])
    .filter((s) => s && s.enabled)
    .map((s) => s.id)
    .sort()
    .join(',')
  return `${enabledIds}#custom=${opts.customCount}#meta=${opts.metaEnabled ? opts.metaSource || '1' : '0'}`
}

/**
 * 生成分类缓存 key：站点指纹 + 分类名 + 页号。
 */
export function categoryCacheKey(
  sites: { id: string; enabled: boolean }[],
  category: string,
  page: number
): string {
  const enabledIds = (sites || [])
    .filter((s) => s && s.enabled)
    .map((s) => s.id)
    .sort()
    .join(',')
  return `${enabledIds}#cat=${category}#pg=${page}`
}
