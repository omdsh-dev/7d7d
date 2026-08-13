/**
 * 7d7d 门户视图：会话标签栏 7D7D 标签对应的视图本体。
 * 两个子视图：网格（7k7k 式卡片墙 + 分类筛选 + 社区同步）与播放器（iframe）。
 * 全部走主服务器同源路径（/7d7d/*）——任何 GUI 访问方式（loopback/LAN/代理）
 * 都可用；游戏 iframe 用 sandbox 且不含 allow-same-origin（不透明 origin 隔离，
 * 游戏摸不到 /api 桥接）。Flash 走 /7d7d/player/<slug>（Ruffle 播放页）。
 * @module 7d7d/client/portal
 */

import { useCallback, useEffect, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { GameMeta, Manifest } from '../types.ts'

/** 游戏路由挂载前缀（与 host 端 MOUNT_BASE 一致）。 */
const BASE = '/7d7d'

/** 门户清单路径（主服务器同源）。 */
const MANIFEST_PATH = `${BASE}/api/manifest.json`

/** 社区同步路径（主服务器同源）。 */
const SYNC_PATH = `${BASE}/api/sync`

/** 本视图的注入面：门户不依赖任何会话服务，空即可。 */
export interface PortalViewInjected {}

/** 拉取门户清单。 */
async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_PATH, { cache: 'no-store' })
  if (!res.ok) throw new Error(`7d7d: manifest ${res.status}`)
  return await res.json() as Manifest
}

/** 游戏的可播地址（同源相对路径）：flash 走播放页，html5 直接入口页。 */
function playUrl(game: GameMeta): string {
  return game.type === 'flash'
    ? `${BASE}/player/${encodeURIComponent(game.slug)}`
    : `${BASE}/g/${encodeURIComponent(game.slug)}/${game.entry}`
}

/** 全屏切换（在播放器容器上）。 */
function toggleFullscreen(element: HTMLElement | null): void {
  if (element === null) return
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().catch(() => {})
  } else {
    void element.requestFullscreen().catch(() => {})
  }
}

/** 一次社区同步的结果（与 host 端 CommunitySyncResult 对齐）。 */
interface SyncResult {
  synced: string[]
  skipped: string[]
  failed: string[]
}

/**
 * 门户视图组件：标签栏 7D7D 对应的视图本体。
 * @param _props - 框架标准会话 kit（本视图不使用）。
 * @returns 门户视图。
 */
export function PortalView(_props: ConvViewProps & InjectFace<PortalViewInjected>): JSX.Element {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState('全部')
  const [current, setCurrent] = useState<GameMeta | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  // 挂载即加载清单。
  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setManifest(await fetchManifest())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 手动触发社区同步：POST /api/sync，完成后刷新清单。
  const syncCommunity = useCallback(async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    setSyncNote(null)
    try {
      const res = await fetch(SYNC_PATH, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json() as SyncResult
      setSyncNote(`社区同步完成：新增 ${result.synced.length}，跳过 ${result.skipped.length}，失败 ${result.failed.length}`)
      await load()
    } catch (err) {
      setSyncNote(`社区同步失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(false)
    }
  }, [syncing, load])

  const games = manifest?.games ?? []
  const shown = category === '全部' ? games : games.filter((game) => game.category === category)
  const categories = ['全部', ...(manifest?.categories ?? [])]

  return (
    <div className="d7d7-view" role="region" aria-label="7d7d 游戏门户">
      <header className="d7d7-header">
        <div className="d7d7-title">
          <span className="d7d7-logo">🎮 7D7D</span>
          <span className="d7d7-subtitle">游戏门户 · 本地 + 社区</span>
        </div>
        <div className="d7d7-categories" role="tablist" aria-label="游戏分类">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={category === name}
              className={category === name ? 'd7d7-chip d7d7-chip-active' : 'd7d7-chip'}
              onClick={() => { setCategory(name) }}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="d7d7-actions">
          <button
            type="button"
            className="d7d7-sync"
            onClick={() => { void syncCommunity() }}
            disabled={syncing}
            title="从社区目录拉取新的游戏"
          >
            {syncing ? '同步中…' : '⇅ 社区同步'}
          </button>
          <button
            type="button"
            className="d7d7-refresh"
            onClick={() => { void load() }}
            title="刷新游戏库"
            aria-label="刷新游戏库"
          >
            ⟳
          </button>
        </div>
      </header>

      <main className="d7d7-body">
        {syncNote !== null && <div className="d7d7-sync-note">{syncNote}</div>}
        {error !== null && (
          <div className="d7d7-error">
            <p>门户加载失败：{error}</p>
            <p className="d7d7-error-hint">请确认 7d7d 插件已在 profile 中启用，并刷新页面重试。</p>
          </div>
        )}
        {error === null && manifest === null && <div className="d7d7-loading">正在加载游戏库…</div>}
        {error === null && manifest !== null && shown.length === 0 && (
          <div className="d7d7-loading">这个分类还没有游戏。让模型写一个吧——见 skills/7d7d。</div>
        )}
        {error === null && shown.length > 0 && (
          <div className="d7d7-grid">
            {shown.map((game) => (
              <button key={`${game.source}-${game.slug}`} type="button" className="d7d7-card" onClick={() => { setCurrent(game) }}>
                <div className="d7d7-card-cover">
                  {game.cover !== null
                    ? <img src={`${BASE}/g/${encodeURIComponent(game.slug)}/${game.cover}`} alt={game.title} loading="lazy" />
                    : <span className="d7d7-card-emoji">{game.emoji}</span>}
                  {game.type === 'flash' && <span className="d7d7-badge">Flash</span>}
                  {game.source === 'community' && <span className="d7d7-badge d7d7-badge-community">社区</span>}
                </div>
                <div className="d7d7-card-meta">
                  <span className="d7d7-card-title">{game.title}</span>
                  <span className="d7d7-card-category">{game.category}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {current !== null && (
        <div className="d7d7-player-panel" role="dialog" aria-label={current.title}>
          <header className="d7d7-header d7d7-header-player">
            <button type="button" className="d7d7-back" onClick={() => { setCurrent(null) }} aria-label="返回游戏列表">← 返回</button>
            <div className="d7d7-title">
              <span className="d7d7-logo">{current.emoji} {current.title}</span>
              <span className="d7d7-subtitle">{current.description}</span>
            </div>
            <button type="button" className="d7d7-fullscreen" onClick={() => { toggleFullscreen(document.getElementById('d7d7-player-stage')) }} aria-label="全屏">⛶</button>
          </header>
          <div id="d7d7-player-stage" className="d7d7-stage">
            <iframe
              title={current.title}
              src={playUrl(current)}
              // 无 allow-same-origin：游戏运行在**不透明 origin**，无法触达
              // DSH 的 /api 桥接（同源 fetch 被 CORS 拦、带 fence 的 /api 也拒绝跨站）。
              sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
              allow="fullscreen; autoplay"
            />
          </div>
        </div>
      )}
    </div>
  )
}
