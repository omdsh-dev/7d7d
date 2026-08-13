# 7d7d —— 7k7k 风格的 DSH 游戏门户

> 让 DeepSeek Harness 变成一个游戏机：模型生成/上传 HTML5 与 Flash 小游戏，
> 在 DSH Web UI 里直接打开门户游玩。Flash 使用固定版本、摘要校验的同源 Ruffle。

## 这是什么

7d7d 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的外部插件，参考 7k7k/4399 的门户形态：

- **前端原生入口**：会话标签栏 chat / Trajectory 之后出现 **7D7D** 标签，点击即在对话列内打开游戏门户；
- **游戏库托管**：DSH 主服务器 `/7d7d` 前缀同源托管，实时扫描 `games/` 目录生成门户清单——模型或用户往库里丢一个文件夹，门户立刻上架，零注册流程；任何 GUI 访问方式（loopback / LAN / 代理）都能玩；
- **社区游戏**：别人通过 PR 提交到仓库 `community-games/` 的游戏，启动时自动同步进你的门户（也可手动「⇅ 社区同步」），带「社区」徽标；
- **Flash 播放页**：`.swf` 游戏只允许同源自托管的 Ruffle，不在运行时加载第三方脚本；
- **游戏生成**：自带 `skills/7d7d` 技能，模型按规范批量产出单文件 H5 游戏；
- **安全边界**：游戏与 GUI 同源，但跑在**不含 `allow-same-origin` 的 sandbox iframe**（不透明 origin）里——游戏触不到 DSH 的 `/api` 桥接（同源 fetch 被 CORS 拦，带 trust fence 的 `/api` 也拒绝跨站请求）。

## 快速开始

前置：Node ≥ 22、pnpm。开发依赖使用 npm 上与 DSH `next` 通道匹配的精确版本；
运行时仍由宿主提供相同兼容范围内的 peer dependencies。

```sh
# 1. 克隆仓库
git clone https://github.com/omdsh-dev/7d7d.git
cd 7d7d

# 2. 使用临时只读 registry 令牌安装锁定依赖
NPM_TOKEN=<short-lived-read-token> pnpm install --frozen-lockfile --ignore-scripts

# 3. 构建（产出 lib/index.js + lib/client.js）
pnpm build

# 4. （可选）安装固定版本、自托管的 Ruffle（仅 Flash 游戏需要）
pnpm fetch:ruffle
```

仓库不复制 DSH 实现源码，也不依赖固定的本机目录。安装时按包提供方说明，在本机
npm 配置中引用 `${NPM_TOKEN}`，真实令牌只放进进程环境，绝不写入仓库。类型检查
直接使用 npm 的 `next` 包校验真实接口；运行时实现由宿主注入。本项目保留
`private: true`，发布物通过 Git source 安装，不承诺将本插件发布为公共 npm 包。

### 装进 DSH

把 `cordis.patch.yml` 的内容并入你的 profile 层，或使用 `dsh.plugin.json` 清单安装：

```yaml
- insert:
    - id: 7d7d
      name: '@mattheliu/7d7d'
```

重启 `dsh web` 后，打开任意会话，标签栏出现 **7D7D** 标签（chat / Trajectory 之后）。首次运行会把 `seed-games/` 里的 9 款示例游戏拷进 `~/.dsh/7d7d/games/`，并自动从社区目录同步游戏。

## 让模型造游戏

把 [skills/7d7d/SKILL.md](skills/7d7d/SKILL.md) 放进 DSH 的 skills 目录（或按你的技能管理方式启用），然后：

> 用 7d7d 做一款「太空射击」小游戏

模型会按规范写出 `~/.dsh/7d7d/games/<slug>/`（`game.json` + `index.html`），打开门户即可玩。想批量产出（K399 式游戏节），用 DSH 的 workflow/子代理扇出即可——每个子代理写一款，写完即上架。

### 游戏目录规范

```
~/.dsh/7d7d/games/
└── <slug>/            # 目录名 = 稳定标识
    ├── game.json      # 元数据（必填）
    ├── index.html     # html5 游戏入口（缺省）
    ├── game.swf       # flash 游戏（type: "flash" 时）
    ├── cover.png      # 可选封面
    └── …              # 其他资源（相对路径引用）
```

`game.json` 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 显示标题 |
| `description` | string | 否 | 一句话介绍 |
| `category` | string | 否 | 分类（门户筛选 chip），缺省「未分类」 |
| `tags` | string[] | 否 | 标签 |
| `author` | string | 否 | 作者 |
| `type` | `"html5"` \| `"flash"` | 否 | 缺省 `html5` |
| `entry` | string | 否 | html5 入口，缺省 `index.html` |
| `swf` | string | 否 | flash 文件，缺省 `game.swf` |
| `cover` | string | 否 | 封面相对路径；缺省用 `emoji` 色块 |
| `emoji` | string | 否 | 卡片图标，缺省 🎮 |
| `createdAt` | number | 否 | 入库时间（毫秒时间戳） |

## Flash / Ruffle

Adobe 已在 2020 年停更 Flash Player，浏览器里没有原生 Flash 了。7d7d 使用
**Ruffle 0.5.0**（Rust 编写的 Flash 模拟器，编译为 WASM）播放页：

- 播放页只加载当前插件前缀下的同源 Ruffle；
- 未安装本地文件时会显示明确提示，不会在运行时回退到第三方 CDN；
- `pnpm fetch:ruffle` 只访问固定的 npm registry tarball；先验证 registry SHA-512 SRI，
  再验证 5 个运行文件的 SHA-256，全部通过后才原子安装到版本化目录；
- 任一下载、归档或文件摘要不符都会安全失败，不改动现有 `vendor/ruffle/runtime-0.5.0`；
- 兼容性：Ruffle 对 AS1/AS2 支持成熟，AS3 大部分可用。个别老 SWF 可能有渲染/音效差异，属模拟器固有限制。

> ⚠️ 版权：只能上传你自己拥有或已获授权的 SWF。不要扒 7k7k/4399 的商业游戏资产。

## 社区游戏

7d7d 自带一个社区游戏渠道：仓库里的 `community-games/` 目录 + 根目录 `catalog.json`。

**用户侧（零网络）**：插件启动时自动把仓库 `community-games/` 里的游戏同步进
`~/.dsh/7d7d/games/community/<slug>/`（也可在门户右上角点「⇅ 社区同步」手动触发；
已存在的跳过，幂等）。仓库 `git pull` 后再次同步即可拿到新游戏。门户里带「社区」徽标，
与本地游戏同玩同筛。可选配置 `communityCatalogUrl` 可追加远程 catalog 源。

**投稿侧**：把你的游戏目录（`game.json` + `index.html` 等）放进 `community-games/<slug>/`，
运行 `node scripts/update-catalog.mjs` 重新生成 `catalog.json`，一起提 PR。
合并后所有 7d7d 用户同步即可玩到你的游戏。

> 投稿检查：单文件或小体积、零外部依赖、标题/描述/分类齐全、不包含商业游戏资产。

## 安全模型

- 游戏与 GUI **同源**（主服务器 `/7d7d/*`，任何访问路径可用），但游戏跑在
  **不含 `allow-same-origin` 的 sandbox iframe** 里——游戏得到的是**不透明 origin**：
  - 对 `/api` 桥接的同源 fetch 变成跨源请求，被 CORS 拦截；`/api` 的 trust fence 也会拒绝跨站请求；
  - 游戏无法读写 GUI 的 cookie/localStorage；
  - `/7d7d/*` 本身带 `Access-Control-Allow-Origin: *`，只放行游戏自身的子资源读取（Ruffle wasm、封面图等）。
- 这意味着恶意游戏最多只能在自己的不透明 origin 里作妖，碰不到 DSH 的 `/api` 桥接与你的工作区。
- 独立 loopback 端口模式已废弃：它会让远程/代理访问（页面里的 `127.0.0.1:PORT` 指向用户自己的机器）直接失联。

## 配置

插件配置（cordis.yml 中 `7d7d` 条目）：

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `root` | string | `$DSH_HOME/7d7d` | 游戏库根目录（其下 `games/`） |
| `seed` | boolean | `true` | 首次运行是否拷入种子游戏 |
| `syncCommunity` | boolean | `true` | 是否同步仓库 `community-games/` 的社区游戏（零网络） |
| `communityCatalogUrl` | string | 空 | 可选远程 catalog 地址，配置后同步时追加拉取 |

## 架构

```
┌──────────────────────────── DSH Web UI（浏览器）────────────────────────────┐
│  会话标签栏：chat | Trajectory | 🎮 7D7D（conversation.view 槽条目）          │
│  点击 → 门户视图（分类筛选 + 卡片网格 + 播放器 iframe）                       │
│  门户与游戏全部走同源相对路径 /7d7d/*（任何访问方式都可用）                  │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼ 同源请求 / iframe（sandbox 无 allow-same-origin，不透明 origin）
┌────────────────────────── DSH 主 webserver（任意端口）───────────────────────┐
│  /7d7d/api/manifest.json    实时扫描 games/* 与 games/community/*            │
│  /7d7d/api/sync             POST：手动触发社区同步（+ OPTIONS 预检）          │
│  /7d7d/g/<slug>/…           游戏静态资源（目录默认 index.html；本地优先社区） │
│  /7d7d/player/<slug>        Flash 播放页（Ruffle，同源自托管 /ruffle/）         │
│  /7d7d/api/server.json      诊断信息                                         │
│  ~/.dsh/7d7d/games/         游戏库（模型/用户直接写文件，写完即上架）         │
│  ~/.dsh/7d7d/games/community/   社区同步落盘（本地 slug 冲突时本地优先）      │
└──────────────┬────────────────────────────────────────────────────────────────┘
               │ 启动自动同步 + POST /api/sync：本地仓库源拷贝（零网络）
               ▼
   7d7d 插件仓库（community-games/ + catalog.json；git pull 即获更新，
   可选 communityCatalogUrl 追加远程源）
```

仓库结构：

```
src/index.ts          host 插件：注册 /7d7d 前缀路由 + 社区同步开关
src/server.ts         游戏路由核心（createGamesRouter：同源挂载 / 独立服务器测试两用）
src/community.ts      社区同步（本地仓库源拷贝 + 可选远程 catalog 原子落盘）
src/manifest.ts       game.json 解析 + 清单扫描（本地 + 社区）
src/static.ts         越界防护的静态文件服务
src/player.ts         Ruffle 播放页
src/client/           browser 插件：conversation.view 条目（7D7D 标签 + 门户）
seed-games/           9 款示例游戏
community-games/      社区游戏投稿目录（+catalog.json，PR 合并即全网同步）
skills/7d7d/          游戏创作技能（SKILL.md）
scripts/update-catalog.mjs   重新生成 catalog.json（投稿时运行）
scripts/fetch-ruffle.mjs     固定版本、摘要校验、原子安装 Ruffle
vendor/ruffle/        自托管 Ruffle 说明与本地版本化运行目录
```

## 开发

```sh
pnpm typecheck   # tsc 全量类型检查
pnpm test        # vitest（manifest / 静态服务 / 社区同步 / 服务器集成）
pnpm build       # tsdown 双端打包
```

## Roadmap

- [x] 前端原生入口：会话标签栏 7D7D 标签（chat / Trajectory 之后）
- [x] 门户网格 + 分类 + iframe 播放器
- [x] Ruffle Flash 播放（固定 0.5.0 + registry SRI + 逐文件 SHA-256）
- [x] 种子游戏 + 生成技能
- [x] 社区游戏：catalog 同步 + 社区徽标 + 投稿流程
- [ ] 封面自动截图（headless 渲染 canvas 存 cover.png）
- [ ] 分数/存档（游戏库服务端持久化 + 排行榜）
- [ ] 联机小游戏（走 DSH webserver 的 upgrade 路由打 WebSocket）
- [ ] K399 式「游戏节」workflow：一次扇出 N 个子代理批量造游戏

## License

MIT，版权归 mattheliu 所有（见 [LICENSE](LICENSE)）。
