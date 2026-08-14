import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
//#region src/manifest.ts
/**
* 游戏库清单：扫描 games/ 下每个子目录的 game.json，解析为门户清单。
* 社区同步的游戏落在 games/community/<slug>（见 community.ts），同样被扫描，
* 但本地游戏（games/<slug>）slug 相同时优先。
* 服务端每次请求都重新扫描（游戏库由模型/用户直接写文件，无需注册流程）——
* 目录规模是百级以内，扫描开销可忽略；这是「写完即上架」的关键设计。
* @module 7d7d/manifest
*/
/** 每个游戏目录内的元数据文件名。 */
const GAME_JSON = "game.json";
/** 社区游戏落盘目录（games/ 下）。 */
const COMMUNITY_DIR = "community";
const DEFAULT_ENTRY = "index.html";
const DEFAULT_SWF = "game.swf";
const DEFAULT_CATEGORY = "未分类";
const DEFAULT_EMOJI = "🎮";
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function stringField(raw, key, fallback) {
	const value = raw[key];
	return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}
function stringArrayField(raw, key) {
	const value = raw[key];
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) if (typeof item === "string" && item.trim() !== "") out.push(item.trim());
	return out;
}
/** 解析一份 game.json；字段缺失/类型错误时回退默认值，绝不抛错。 */
function parseGameJson(slug, raw) {
	if (!isRecord(raw)) return null;
	const type = raw.type === "flash" ? "flash" : "html5";
	const createdAtRaw = raw.createdAt;
	return {
		slug,
		title: stringField(raw, "title", slug),
		description: stringField(raw, "description", ""),
		category: stringField(raw, "category", DEFAULT_CATEGORY),
		tags: stringArrayField(raw, "tags"),
		author: stringField(raw, "author", ""),
		type,
		source: "local",
		entry: stringField(raw, "entry", DEFAULT_ENTRY),
		swf: stringField(raw, "swf", DEFAULT_SWF),
		cover: typeof raw.cover === "string" && raw.cover.trim() !== "" ? raw.cover.trim() : null,
		emoji: stringField(raw, "emoji", DEFAULT_EMOJI),
		createdAt: typeof createdAtRaw === "number" && Number.isFinite(createdAtRaw) ? createdAtRaw : null
	};
}
/** 列出目录下的子目录名（目录不存在时返回空数组）。 */
async function listDirs(dir) {
	try {
		return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return [];
	}
}
/** 从某个游戏基目录读取一个游戏；目录不存在或 game.json 无效时返回 null。 */
async function readGameFrom(baseDir, slug, source) {
	let raw;
	try {
		raw = JSON.parse(await readFile(join(baseDir, slug, GAME_JSON), "utf8"));
	} catch {
		return null;
	}
	const game = parseGameJson(slug, raw);
	return game === null ? null : {
		...game,
		source
	};
}
/** 读取一个游戏的元数据：本地优先，其次社区目录；都无则 null。 */
async function readGame(gamesDir, slug) {
	const local = await readGameFrom(gamesDir, slug, "local");
	if (local !== null) return local;
	return await readGameFrom(join(gamesDir, COMMUNITY_DIR), slug, "community");
}
/** 扫描整个游戏库（本地 + 社区），产出门户清单。gamesDir 不存在时视为空库。 */
async function readManifest(gamesDir) {
	const games = [];
	const localSlugs = /* @__PURE__ */ new Set();
	for (const name of await listDirs(gamesDir)) {
		const game = await readGameFrom(gamesDir, name, "local");
		if (game !== null) {
			games.push(game);
			localSlugs.add(name);
		}
	}
	for (const name of await listDirs(join(gamesDir, COMMUNITY_DIR))) {
		if (localSlugs.has(name)) continue;
		const game = await readGameFrom(join(gamesDir, COMMUNITY_DIR), name, "community");
		if (game !== null) games.push(game);
	}
	games.sort((a, b) => a.title.localeCompare(b.title, "zh"));
	return {
		games,
		categories: [...new Set(games.map((game) => game.category).filter((c) => c !== ""))].sort((a, b) => a.localeCompare(b, "zh"))
	};
}
//#endregion
//#region src/community.ts
/**
* 社区游戏同步：从仓库 catalog.json 拉取社区游戏清单，把本地缺失的游戏
* 下载到 games/community/<slug>。写入是「先全部拉进内存、再一次性落盘」——
* 单个游戏任一文件失败则该游戏整体跳过，绝不留下残缺条目。
* 别人通过 PR 把游戏目录提交到仓库 community-games/（scripts/update-catalog.mjs
* 重新生成 catalog.json），所有安装了 7d7d 的用户的门户就能同步到它。
* @module 7d7d/community
*/
/** 社区游戏在仓库里的目录名（URL 路径用；区别于本地落盘的 COMMUNITY_DIR）。 */
const REMOTE_GAMES_DIR = "community-games";
/** raw.githubusercontent.com URL 的匹配（owner/repo/ref/…路径）。 */
const RAW_GITHUB_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//;
/**
* 把 raw.githubusercontent.com URL 映射为 GitHub Contents API URL。
* 受限网络（raw 域名被墙/代理拦截）时用 API 兜底；非 raw URL 返回 null。
*/
function contentsApiUrlOf(rawUrl) {
	const match = RAW_GITHUB_RE.exec(rawUrl);
	if (match === null) return null;
	const [, owner, repo, ref] = match;
	return `https://api.github.com/repos/${owner}/${repo}/contents/${rawUrl.slice(match[0].length)}?ref=${ref}`;
}
/**
* 抓取一个社区文件：优先 raw URL，失败时若命中 GitHub raw 模式则回退
* Contents API（返回 base64 JSON 信封，1MB 限制对单文件小游戏绰绰有余）。
*/
async function fetchCommunityFile(fetcher, url) {
	const raw = await fetcher(url);
	if (raw.ok) return raw;
	const api = contentsApiUrlOf(url);
	if (api === null) return raw;
	const res = await fetcher(api);
	if (!res.ok) return raw;
	const data = await res.json();
	if (typeof data.content !== "string") return raw;
	return new Response(Buffer.from(data.content, "base64"), { status: 200 });
}
/** slug 安全字符检查：拒绝路径穿越与盘符逃逸。 */
function isSafeSlug(slug) {
	return slug !== "" && !slug.includes("/") && !slug.includes("\\") && !slug.includes("..");
}
/** 解析并校验 catalog.json；无效行直接丢弃。 */
async function parseCatalog(url, fetcher) {
	const res = await fetchCommunityFile(fetcher, url);
	if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
	const raw = await res.json();
	if (raw === null || typeof raw !== "object" || !Array.isArray(raw.games)) throw new Error("catalog.json 无效：缺少 games[]");
	const games = [];
	for (const game of raw.games) {
		if (game === null || typeof game !== "object") continue;
		const slug = game.slug;
		const files = game.files;
		if (typeof slug !== "string" || !isSafeSlug(slug)) continue;
		if (!Array.isArray(files)) continue;
		const clean = [];
		for (const file of files) if (typeof file === "string" && file !== "" && !file.includes("..")) clean.push(file);
		if (!clean.includes("game.json")) continue;
		games.push({
			slug,
			title: typeof game.title === "string" && game.title !== "" ? game.title : slug,
			files: clean
		});
	}
	return { games };
}
/** catalog.json 所在目录 = 仓库根；游戏文件在 <根>/community-games/<slug>/<file>。 */
function catalogBaseUrl(catalogUrl) {
	return new URL(".", catalogUrl).toString();
}
/**
* 执行一次社区同步：拉取 catalog → 逐个下载缺失游戏 → 原子落盘。
* @param options - 见 {@link CommunitySyncOptions}。
* @returns 同步结果（永不抛错：所有失败都折叠进结果与日志）。
*/
async function syncCommunity(options) {
	const fetcher = options.fetcher ?? ((url) => fetch(url));
	const log = options.log ?? (() => {});
	const result = {
		synced: [],
		skipped: [],
		failed: []
	};
	let catalog;
	try {
		catalog = await parseCatalog(options.catalogUrl, fetcher);
	} catch (error) {
		log(`7d7d 社区目录拉取失败：${error instanceof Error ? error.message : String(error)}`);
		return result;
	}
	const base = catalogBaseUrl(options.catalogUrl);
	const communityDir = join(options.gamesDir, COMMUNITY_DIR);
	for (const game of catalog.games) {
		const target = join(communityDir, game.slug);
		try {
			await readFile(join(target, GAME_JSON), "utf8");
			result.skipped.push(game.slug);
			continue;
		} catch {}
		const files = [];
		let failed = false;
		for (const file of game.files) try {
			const res = await fetchCommunityFile(fetcher, `${base}${REMOTE_GAMES_DIR}/${game.slug}/${file}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			files.push({
				name: file,
				body: Buffer.from(await res.arrayBuffer())
			});
		} catch (error) {
			failed = true;
			log(`7d7d 社区游戏 ${game.slug} 下载 ${file} 失败：${error instanceof Error ? error.message : String(error)}`);
			break;
		}
		if (failed) {
			result.failed.push(game.slug);
			continue;
		}
		try {
			await mkdir(target, { recursive: true });
			for (const file of files) await writeFile(join(target, file.name), file.body);
			result.synced.push(game.slug);
		} catch (error) {
			log(`7d7d 社区游戏 ${game.slug} 落盘失败：${error instanceof Error ? error.message : String(error)}`);
			result.failed.push(game.slug);
		}
	}
	return result;
}
/**
* 本地社区同步：把插件仓库 community-games/ 里的游戏拷进 games/community/。
* 零网络、零认证——7d7d 用户按 README 克隆仓库安装，仓库本身就是社区源；
* `git pull` 拉取更新后，门户同步即拿到新游戏。已存在的游戏跳过（幂等）。
*/
async function syncCommunityLocal(options) {
	const log = options.log ?? (() => {});
	const result = {
		synced: [],
		skipped: [],
		failed: []
	};
	let entries;
	try {
		entries = await readdir(options.sourceDir, { withFileTypes: true });
	} catch {
		log(`7d7d 社区游戏源目录不存在：${options.sourceDir}`);
		return result;
	}
	const communityDir = join(options.gamesDir, COMMUNITY_DIR);
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const slug = entry.name;
		if (!isSafeSlug(slug)) continue;
		const source = join(options.sourceDir, slug);
		const target = join(communityDir, slug);
		try {
			await readFile(join(source, GAME_JSON), "utf8");
		} catch {
			continue;
		}
		try {
			await readFile(join(target, GAME_JSON), "utf8");
			result.skipped.push(slug);
			continue;
		} catch {}
		try {
			await cp(source, target, {
				recursive: true,
				force: true
			});
			result.synced.push(slug);
		} catch (error) {
			log(`7d7d 社区游戏 ${slug} 拷贝失败：${error instanceof Error ? error.message : String(error)}`);
			result.failed.push(slug);
		}
	}
	return result;
}
//#endregion
//#region src/player.ts
/** SWF URL 前等待 Ruffle 就绪的最长时间（毫秒）。 */
const BOOT_TIMEOUT_MS = 15e3;
/** 转义进 HTML 文本节点的字符串（本页只把 slug/title/swf 放进去）。 */
function escapeHtml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
/**
* 渲染 Flash 播放页。
* @param game - 游戏元数据（type 应为 flash）。
* @param baseUrl - 该游戏静态资源的基地址（`<origin>/g/<slug>`）。
* @returns 完整 HTML 页面。
*/
function renderPlayerPage(game, baseUrl, ruffleUrl) {
	const swfUrl = `${baseUrl}/${game.swf}`;
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(game.title)} · 7d7d</title>
<style>
  html, body { margin: 0; height: 100%; background: #14151f; overflow: hidden; }
  #stage { position: fixed; inset: 0; }
  #hint {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #8b90a8; font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: center; padding: 24px; box-sizing: border-box; pointer-events: none;
  }
</style>
</head>
<body>
<div id="stage"></div>
<div id="hint">正在启动 Flash 模拟器（Ruffle）…</div>
<script>
  // Ruffle 配置必须在 ruffle.js 加载前就位。
  window.RufflePlayer = window.RufflePlayer || {};
  window.RufflePlayer.config = {
    autoPlay: 'on',
    letterbox: 'on',
    contextMenu: 'off',
    unmuteOverlay: 'hidden',
  };
  var SWF = ${JSON.stringify(swfUrl)};
  var hint = document.getElementById('hint');
  var deadline = Date.now() + ${BOOT_TIMEOUT_MS};
  var timer = null;
  var ruffleLoadFailed = false;

  // 只加载同源、自托管的 Ruffle，避免运行时引入远程脚本。
  (function () {
    var s = document.createElement('script');
    s.src = ${JSON.stringify(ruffleUrl)};
    s.onerror = function () {
      ruffleLoadFailed = true;
      if (timer) clearTimeout(timer);
      if (hint) hint.textContent = 'Flash 模拟器不可用：请先运行 pnpm fetch:ruffle 安装经过摘要校验的本地 Ruffle。';
    };
    document.head.appendChild(s);
  })();

  function boot() {
    if (ruffleLoadFailed) return;
    if (window.RufflePlayer && window.RufflePlayer.newest) {
      var ruffle = window.RufflePlayer.newest();
      var player = ruffle.createPlayer();
      player.style.width = '100%';
      player.style.height = '100%';
      var stage = document.getElementById('stage');
      stage.appendChild(player);
      player.load(SWF);
      if (hint) hint.remove();
      return;
    }
    if (Date.now() > deadline) {
      if (hint) hint.textContent = 'Flash 模拟器加载超时：请确认已经运行 pnpm fetch:ruffle。';
      return;
    }
    timer = setTimeout(boot, 120);
  }
  boot();
  window.addEventListener('beforeunload', function () { if (timer) clearTimeout(timer); });
<\/script>
</body>
</html>
`;
}
//#endregion
//#region src/static.ts
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".swf": "application/x-shockwave-flash",
	".wasm": "application/wasm",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8"
};
/** URL 路径名安全解码：坏转义返回 null（调用方回 400）。 */
function safeDecode(pathname) {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return null;
	}
}
/**
* 服务一个 GET/HEAD 静态请求。
* @param pathname - 已按 URL 解析出的 pathname（未解码）。
* @param res - node:http 响应。
* @param root - 物理根目录（绝对路径）。
* @param head - HEAD 请求：只写头不写体。
* @returns 是否命中（false = 404/400/403，调用方无需再回 404）。
*/
async function serveStatic(pathname, res, root, head = false) {
	const decoded = safeDecode(pathname);
	if (decoded === null) {
		res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
		res.end("bad request");
		return true;
	}
	const target = resolve(normalize(join(root, decoded)));
	if (target !== root && !target.startsWith(root + sep)) {
		res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
		res.end("forbidden");
		return true;
	}
	let file = target;
	try {
		if ((await stat(target)).isDirectory()) file = join(target, "index.html");
	} catch {}
	let body;
	try {
		body = await readFile(file);
	} catch {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		if (!head) res.end("not found");
		else res.end();
		return true;
	}
	const type = MIME[extname(file)] ?? "application/octet-stream";
	res.writeHead(200, {
		"content-type": type,
		"cache-control": "no-store"
	});
	if (!head) res.end(body);
	else res.end();
	return true;
}
//#endregion
//#region src/server.ts
/** 游戏库子目录名。 */
const GAMES = "games";
function sendJson(res, status, payload) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8"
	});
	res.end(JSON.stringify(payload));
}
function sendText(res, status, text) {
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	res.end(text);
}
/** games/ 为空且 seedDir 存在时，把种子游戏拷入（只执行一次）。 */
async function seedIfNeeded(gamesDir, seedDir) {
	if (seedDir === void 0) return;
	let seedEntries;
	try {
		seedEntries = await readdir(seedDir, { withFileTypes: true });
	} catch {
		return;
	}
	let existing;
	try {
		existing = await readdir(gamesDir);
	} catch {
		return;
	}
	if (existing.length > 0) return;
	for (const entry of seedEntries) {
		if (!entry.isDirectory()) continue;
		try {
			await cp(join(seedDir, entry.name), join(gamesDir, entry.name), { recursive: true });
		} catch {}
	}
}
/** 在游戏库里找一个游戏（读其 game.json；本地优先，其次社区）。 */
async function findGame(gamesDir, slug) {
	if (slug === "" || slug.includes("/") || slug.includes("\\") || slug.includes("..")) return null;
	return await readGame(gamesDir, slug);
}
/** 解析游戏静态目录：games/<slug> 优先，其次 games/community/<slug>。 */
async function resolveGameDir(gamesDir, slug) {
	if (slug === "" || slug.includes("/") || slug.includes("\\") || slug.includes("..")) return null;
	for (const base of [gamesDir, join(gamesDir, COMMUNITY_DIR)]) try {
		if ((await stat(join(base, slug))).isDirectory()) return join(base, slug);
	} catch {}
	return null;
}
/** 请求路径相对挂载基址裁剪：不在 base 下返回 null。 */
function stripBase(pathname, base) {
	if (base === "") return pathname;
	if (pathname === base) return "/";
	if (pathname.startsWith(base + "/")) return pathname.slice(base.length);
	return null;
}
/**
* 创建可挂载的游戏路由核心。
* @param options - 见 {@link GamesRouteOptions}。
* @param base - 挂载前缀（'' = 根挂载，'/7d7d' = 主服务器前缀）。
* @returns 路由句柄；sync() 与 handler 共享互斥串行队列。
*/
function createGamesRouter(options, base = "") {
	const log = options.log ?? ((message) => {
		console.warn(`[7d7d] ${message}`);
	});
	const gamesDir = join(options.root, GAMES);
	const ready = (async () => {
		await mkdir(gamesDir, { recursive: true });
		await seedIfNeeded(gamesDir, options.seedDir);
	})().catch((error) => {
		log(`游戏库准备失败：${error instanceof Error ? error.message : String(error)}`);
	});
	const localSync = options.communitySourceDir === void 0 ? null : () => syncCommunityLocal({
		gamesDir,
		sourceDir: options.communitySourceDir,
		log
	});
	const remoteSync = options.communityCatalogUrl === void 0 ? null : () => syncCommunity({
		gamesDir,
		catalogUrl: options.communityCatalogUrl,
		fetcher: options.fetcher,
		log
	});
	let syncTail = Promise.resolve();
	const sync = () => {
		if (localSync === null && remoteSync === null) return Promise.resolve({
			synced: [],
			skipped: [],
			failed: []
		});
		const run = syncTail.then(async () => {
			const merged = {
				synced: [],
				skipped: [],
				failed: []
			};
			if (localSync !== null) {
				const local = await localSync();
				merged.synced.push(...local.synced);
				merged.skipped.push(...local.skipped);
				merged.failed.push(...local.failed);
			}
			if (remoteSync !== null) {
				const remote = await remoteSync();
				merged.synced.push(...remote.synced);
				merged.skipped.push(...remote.skipped);
				merged.failed.push(...remote.failed);
			}
			if (merged.synced.length > 0) log(`社区游戏同步完成：+${merged.synced.length}（跳过 ${merged.skipped.length}，失败 ${merged.failed.length}）`);
			return merged;
		});
		syncTail = run.catch(() => {});
		return run;
	};
	const handler = async (req, res) => {
		await ready;
		res.setHeader("access-control-allow-origin", "*");
		const path = stripBase(new URL(req.url ?? "/", "http://localhost").pathname, base);
		if (path === null) {
			sendText(res, 404, "not found");
			return;
		}
		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"access-control-allow-origin": "*",
				"access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
				"access-control-allow-headers": "content-type",
				"access-control-max-age": "600"
			});
			res.end();
			return;
		}
		if (path === "/api/sync") {
			if (req.method !== "POST") {
				res.writeHead(405, { allow: "POST, OPTIONS" });
				res.end();
				return;
			}
			sendJson(res, 200, await sync());
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { allow: "GET, HEAD, OPTIONS" });
			res.end();
			return;
		}
		const head = req.method === "HEAD";
		if (path === "/api/manifest.json") {
			const manifest = await readManifest(gamesDir);
			if (head) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end();
				return;
			}
			sendJson(res, 200, manifest);
			return;
		}
		if (path === "/") {
			const manifest = await readManifest(gamesDir);
			if (head) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end();
				return;
			}
			sendJson(res, 200, {
				name: "7d7d",
				base,
				manifest: `${base}/api/manifest.json`,
				games: manifest.games.length
			});
			return;
		}
		const playerMatch = /^\/player\/([^/]+)$/.exec(path);
		if (playerMatch !== null) {
			let slug;
			try {
				slug = decodeURIComponent(playerMatch[1] ?? "");
			} catch {
				sendText(res, 400, "bad request");
				return;
			}
			const game = await findGame(gamesDir, slug);
			if (game === null || game.type !== "flash") {
				sendText(res, 404, "not found");
				return;
			}
			if (head) {
				res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
				res.end();
				return;
			}
			const page = renderPlayerPage(game, `${base}/g/${slug}`, `${base}/ruffle/ruffle.js`);
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(page);
			return;
		}
		if (path.startsWith("/g/")) {
			const rest = path.slice(2);
			const firstSlash = rest.indexOf("/", 1);
			const slugPart = firstSlash === -1 ? rest.slice(1) : rest.slice(1, firstSlash);
			const tail = firstSlash === -1 ? "" : rest.slice(firstSlash + 1);
			let slug;
			try {
				slug = decodeURIComponent(slugPart);
			} catch {
				sendText(res, 400, "bad request");
				return;
			}
			const gameDir = await resolveGameDir(gamesDir, slug);
			if (gameDir === null) {
				sendText(res, 404, "not found");
				return;
			}
			await serveStatic(`/${tail}`, res, gameDir, head);
			return;
		}
		if (path.startsWith("/ruffle/") && options.ruffleDir !== void 0) {
			await serveStatic(path.slice(7), res, options.ruffleDir, head);
			return;
		}
		sendText(res, 404, "not found");
	};
	return {
		handler,
		sync
	};
}
//#endregion
//#region src/index.ts
/** 稳定插件名。 */
const name = "7d7d";
/** 所需服务：web 形态 HTTP 载体（register 游戏前缀路由）。 */
const inject = ["webServer"];
const Config = z.object({
	root: z.string().default(""),
	seed: z.boolean().default(true),
	syncCommunity: z.boolean().default(true),
	communityCatalogUrl: z.string().default("")
});
/** 游戏路由挂载前缀（主服务器同源路径）。 */
const MOUNT_BASE = "/7d7d";
/** 服务信息路由（诊断用；客户端直接使用同源相对路径，不做端口发现）。 */
const SERVER_INFO_PATH = `${MOUNT_BASE}/api/server.json`;
/** Workshop Harness observes this only when it provides an isolated probe directory. */
const HARNESS_CAPABILITY = "7d7d-routes-registered";
function writeHarnessProbe(file, payload) {
	const root = process.env.OMDSH_HARNESS_PROBE_DIR;
	if (root === void 0 || root === "") return;
	writeFileSync(join(root, file), `${JSON.stringify(payload)}\n`, "utf8");
}
/**
* 插件主体。
* @param ctx - cordis 上下文。
* @param config - 见 {@link Config}。
*/
function apply(ctx, config) {
	const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const root = config.root !== void 0 && config.root !== "" ? config.root : join(dshHome, "7d7d");
	const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
	const router = createGamesRouter({
		root,
		seedDir: config.seed === false ? void 0 : join(pluginRoot, "seed-games"),
		ruffleDir: join(pluginRoot, "vendor", "ruffle", "runtime-0.5.0"),
		communitySourceDir: config.syncCommunity === false ? void 0 : join(pluginRoot, "community-games"),
		communityCatalogUrl: config.communityCatalogUrl !== "" ? config.communityCatalogUrl : void 0
	}, MOUNT_BASE);
	const serverInfoRoute = {
		kind: "exact",
		path: SERVER_INFO_PATH,
		handler: async (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405, { allow: "GET, HEAD" });
				res.end();
				return;
			}
			if (req.method === "HEAD") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end();
				return;
			}
			res.writeHead(200, {
				"cache-control": "no-store",
				"content-type": "application/json; charset=utf-8"
			});
			res.end(JSON.stringify({
				name: "7d7d",
				base: MOUNT_BASE,
				manifest: `${MOUNT_BASE}/api/manifest.json`
			}));
		}
	};
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "prefix",
			path: MOUNT_BASE,
			handler: router.handler
		});
		const disposeInfo = ctx.webServer.register(serverInfoRoute);
		router.sync();
		writeHarnessProbe("ready.json", {
			capability: HARNESS_CAPABILITY,
			version: "0.4.0-rc.2",
			routes: [MOUNT_BASE, SERVER_INFO_PATH],
			pid: process.pid
		});
		ctx.logger.info?.(`[7d7d] games portal mounted at ${MOUNT_BASE} (library: ${root})`);
		return () => {
			dispose();
			disposeInfo();
			writeHarnessProbe("disposed.json", {
				capability: HARNESS_CAPABILITY,
				version: "0.4.0-rc.2",
				pid: process.pid
			});
		};
	}, "7d7d: games routes");
}
//#endregion
export { Config, HARNESS_CAPABILITY, MOUNT_BASE, SERVER_INFO_PATH, apply, inject, name };
