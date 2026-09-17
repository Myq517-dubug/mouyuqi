/**
 * providers 层共享可变状态（模块级单例）与 setter。
 *
 * 原 providers.ts 中的 proxyBase / proxyEnabled / metaSource / resourceSites / customList
 * 这些跨多个子模块（appleCms / speed / resource / search / home）共享的变量集中于此，
 * 以 getter 形式暴露给各子模块读取，避免子模块之间的循环依赖。
 *
 * 注意：仅做"文件级搬家 + 接口澄清"，变量语义与默认值与 v1 完全一致。
 */

import type { ResourceSite, SearchResult } from '../types'

/** 本地代理基地址（由设置注入）。 */
let proxyBase = ''

/** 本地代理是否启用。 */
let proxyEnabled = false

/** 元数据补全 API 模板（含 {title} 占位）。 */
let metaSource = ''

/** 资源站列表（搜索源），由设置注入。 */
let resourceSites: ResourceSite[] = []

/** 自定义源列表（"我的自定义源"），由 App 注入。 */
let customList: SearchResult[] = []

// ---------- 写入方（保持 v1 在 providers.ts 的导出名）----------

export function setCustomSources(list: SearchResult[]): void {
  customList = list
}

export function setResourceSites(sites: ResourceSite[]): void {
  resourceSites = sites || []
}

export function setProxyEnv(base: string, enabled: boolean): void {
  proxyBase = base
  proxyEnabled = enabled
}

export function setMetaSource(v: string): void {
  metaSource = v || ''
}

// ---------- 读取方（供子模块内部访问，不对外导出到 barrel）----------

export function getProxyBase(): string {
  return proxyBase
}

export function getProxyEnabled(): boolean {
  return proxyEnabled
}

export function getMetaSource(): string {
  return metaSource
}

export function getResourceSites(): ResourceSite[] {
  return resourceSites
}

export function getCustomSources(): SearchResult[] {
  return customList
}

/** 统一的代理转发封装：启用时代理基地址 + /proxy?url= 编码目标 URL。 */
export function proxifyUrl(url: string): string {
  return proxyEnabled && proxyBase ? `${proxyBase}/proxy?url=${encodeURIComponent(url)}` : url
}
