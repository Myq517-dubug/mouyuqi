/**
 * 我的页（MePage）— 竖屏版（参照 Ardot 设计稿底部 Tab「我的」）。
 * 顶部用户区 + 内 Tab：收藏/历史 → LibraryPage、我的片单 → PlaylistPage、
 * 资源中心 → ResourceCenterPage、设置 → SettingsPage（复用现有页面组件）。
 */

import { useState } from 'react'
import type { AppData, ResourceSite, SearchResult } from '../types'
import { LibraryPage } from './LibraryPage'
import { PlaylistPage } from './PlaylistPage'
import { ResourceCenterPage } from './ResourceCenterPage'
import { SettingsPage } from './SettingsPage'

export function MePage({
  data,
  onOpen,
  onRemoveFav,
  onRemoveHistory,
  onRemovePlaylist,
  onAddCustom,
  onRemoveCustom,
  onUpdateSites,
  onImport,
  onExport,
  onUpdate,
  onPickDir,
  onClear
}: {
  data: AppData
  onOpen: (i: SearchResult) => void
  onRemoveFav: (i: SearchResult) => void
  onRemoveHistory: (id: string) => void
  onRemovePlaylist: (id: string) => void
  onAddCustom: (i: SearchResult) => void
  onRemoveCustom: (id: string) => void
  onUpdateSites: (s: ResourceSite[]) => void
  onImport: () => void
  onExport: () => void
  onUpdate: (patch: Partial<AppData['settings']>) => void
  onPickDir: () => void
  onClear: () => void
}) {
  const [tab, setTab] = useState('library')
  const tabs = [
    { id: 'library', label: '收藏/历史' },
    { id: 'playlist', label: '我的片单' },
    { id: 'resource', label: '资源中心' },
    { id: 'settings', label: '设置' }
  ]
  return (
    <div className="me-page">
      <div className="me-header">
        <div className="me-avatar">M</div>
        <div className="me-info">
          <div className="me-nick">M快播用户</div>
          <div className="me-sub">
            收藏 {data.favorites.length} · 片单 {data.playlist.length} · 资源站{' '}
            {data.settings.resourceSites.filter((s) => s.enabled).length}
          </div>
        </div>
      </div>

      <div className="me-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={'me-tab' + (tab === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="me-content">
        {tab === 'library' && (
          <LibraryPage
            data={data}
            onOpen={onOpen}
            onRemoveFav={onRemoveFav}
            onRemoveHistory={onRemoveHistory}
          />
        )}
        {tab === 'playlist' && (
          <PlaylistPage items={data.playlist} onOpen={onOpen} onRemove={onRemovePlaylist} />
        )}
        {tab === 'resource' && (
          <ResourceCenterPage
            data={data}
            onAdd={onAddCustom}
            onRemove={onRemoveCustom}
            onUpdateSites={onUpdateSites}
            onImport={onImport}
            onExport={onExport}
          />
        )}
        {tab === 'settings' && (
          <SettingsPage data={data} onUpdate={onUpdate} onPickDir={onPickDir} onClear={onClear} />
        )}
      </div>
    </div>
  )
}
