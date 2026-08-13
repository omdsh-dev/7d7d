/**
 * 7d7d 共享类型：一个游戏的元数据（game.json 解析结果）与门户清单。
 * @module 7d7d/types
 */

/** 游戏类型：html5 直接跑 entry 页面；flash 由播放页加载 Ruffle 跑 SWF。 */
export type GameType = 'html5' | 'flash'

/** 游戏来源：本地（用户/模型直接写入）或社区（从仓库 catalog 同步而来）。 */
export type GameSource = 'local' | 'community'

/** 一个游戏的元数据。slug 来自游戏目录名，其余字段来自 game.json。 */
export interface GameMeta {
  /** 游戏目录名，同时是 URL 里的稳定标识。 */
  slug: string
  /** 显示标题（game.json.title，缺省回退 slug）。 */
  title: string
  description: string
  /** 分类（门户里的筛选 chip，缺省「未分类」）。 */
  category: string
  tags: string[]
  author: string
  type: GameType
  /** 游戏来源：本地写入或社区同步。 */
  source: GameSource
  /** html5 游戏的入口文件，相对游戏目录（缺省 index.html）。 */
  entry: string
  /** flash 游戏的 SWF 文件，相对游戏目录（缺省 game.swf）。 */
  swf: string
  /** 封面图，相对游戏目录；null 时门户用 emoji 色块代替。 */
  cover: string | null
  /** 门户卡片缺省图标。 */
  emoji: string
  /** 入库时间（game.json.createdAt，毫秒时间戳）；缺省 null。 */
  createdAt: number | null
}

/** 门户清单：全部游戏 + 去重排序后的分类。 */
export interface Manifest {
  games: GameMeta[]
  categories: string[]
}
