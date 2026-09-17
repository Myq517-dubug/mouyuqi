/**
 * 会员页（VipPage）— 竖屏版（参照 Ardot 设计稿底部 Tab「会员」）。
 * M快播 v2 暂无会员/支付体系：本页为占位（VIP 特权展示 + 兑换码/赞助入口），
 * 后续接入支付时在此扩展。所有交互仅本地提示，不发起任何扣费。
 */

import { useState } from 'react'

const PRIVILEGES = [
  { icon: '⛓', title: '全网聚合', desc: '聚合多资源站，一个入口看全网' },
  { icon: '🚀', title: '极速解析', desc: '智能线路切换，卡顿一键优化' },
  { icon: '📥', title: '批量下载', desc: '队列下载，后台持续进行' },
  { icon: '🎬', title: '小窗播放', desc: '画中画，边看边做其他事' }
]

export function VipPage({ onToast }: { onToast: (t: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <div className="vip-page">
      <div className="vip-hero">
        <div className="vip-badge">M快播 · 会员中心</div>
        <div className="vip-title">解锁全部能力</div>
        <div className="vip-sub">会员体系建设中，敬请期待</div>
      </div>

      <div className="vip-privileges">
        {PRIVILEGES.map((p) => (
          <div key={p.title} className="vip-card">
            <div className="vip-card-icon">{p.icon}</div>
            <div className="vip-card-body">
              <div className="vip-card-title">{p.title}</div>
              <div className="vip-card-desc">{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="vip-cta">
        <div className="vip-code-row">
          <input
            className="vip-input"
            placeholder="兑换码（预留）"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => onToast(code.trim() ? '兑换功能建设中，敬请期待' : '请输入兑换码')}
          >
            兑换
          </button>
        </div>
        <button
          className="btn ghost"
          style={{ marginTop: 10, width: '100%' }}
          onClick={() => onToast('感谢支持！赞助功能建设中')}
        >
          ☕ 支持一下开发者
        </button>
        <p className="hint" style={{ marginTop: 12, textAlign: 'center' }}>
          M快播为开源本地聚合工具，无会员、无广告、无数据收集
        </p>
      </div>
    </div>
  )
}
