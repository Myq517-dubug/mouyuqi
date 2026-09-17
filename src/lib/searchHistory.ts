/**
 * 搜索历史（本地持久化，localStorage + 内存镜像，无第三方依赖）。
 * 用于搜索页「历史 chips」：最多保留 10 条、去重、可点选重搜、可单独删除 / 清空。
 * 与 App.settings 解耦，独立存储于 localStorage 键 `mkp:searchHistory`。
 */

const KEY = 'mkp:searchHistory'
const MAX = 10

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* 配额满 / 不可写 → 忽略 */
  }
}

/** 读取搜索历史（最多 10 条，最新在前）。 */
export function getSearchHistory(): string[] {
  return read()
}

/** 追加一条历史（去重并置顶，超出截断为 10 条）；返回最新列表。 */
export function addSearchHistory(q: string): string[] {
  const t = (q || '').trim()
  if (!t) return read()
  const next = [t, ...read().filter((x) => x !== t)].slice(0, MAX)
  write(next)
  return next
}

/** 删除单条历史；返回最新列表。 */
export function removeSearchHistory(q: string): string[] {
  const next = read().filter((x) => x !== q)
  write(next)
  return next
}

/** 清空全部历史。 */
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
