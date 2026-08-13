window.__ModuleLoader__.load({
	id: "@mattheliu/7d7d",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/PortalView.tsx
		/**
		* 7d7d 门户视图：会话标签栏 7D7D 标签对应的视图本体。
		* 两个子视图：网格（7k7k 式卡片墙 + 分类筛选 + 社区同步）与播放器（iframe）。
		* 全部走主服务器同源路径（/7d7d/*）——任何 GUI 访问方式（loopback/LAN/代理）
		* 都可用；游戏 iframe 用 sandbox 且不含 allow-same-origin（不透明 origin 隔离，
		* 游戏摸不到 /api 桥接）。Flash 走 /7d7d/player/<slug>（Ruffle 播放页）。
		* @module 7d7d/client/portal
		*/
		/** 游戏路由挂载前缀（与 host 端 MOUNT_BASE 一致）。 */
		const BASE = "/7d7d";
		/** 门户清单路径（主服务器同源）。 */
		const MANIFEST_PATH = `${BASE}/api/manifest.json`;
		/** 社区同步路径（主服务器同源）。 */
		const SYNC_PATH = `${BASE}/api/sync`;
		/** 拉取门户清单。 */
		async function fetchManifest() {
			const res = await fetch(MANIFEST_PATH, { cache: "no-store" });
			if (!res.ok) throw new Error(`7d7d: manifest ${res.status}`);
			return await res.json();
		}
		/** 游戏的可播地址（同源相对路径）：flash 走播放页，html5 直接入口页。 */
		function playUrl(game) {
			return game.type === "flash" ? `${BASE}/player/${encodeURIComponent(game.slug)}` : `${BASE}/g/${encodeURIComponent(game.slug)}/${game.entry}`;
		}
		/** 全屏切换（在播放器容器上）。 */
		function toggleFullscreen(element) {
			if (element === null) return;
			if (document.fullscreenElement !== null) document.exitFullscreen().catch(() => {});
			else element.requestFullscreen().catch(() => {});
		}
		/**
		* 门户视图组件：标签栏 7D7D 对应的视图本体。
		* @param _props - 框架标准会话 kit（本视图不使用）。
		* @returns 门户视图。
		*/
		function PortalView(_props) {
			const [manifest, setManifest] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [category, setCategory] = (0, react.useState)("全部");
			const [current, setCurrent] = (0, react.useState)(null);
			const [syncing, setSyncing] = (0, react.useState)(false);
			const [syncNote, setSyncNote] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
				setError(null);
				try {
					setManifest(await fetchManifest());
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const syncCommunity = (0, react.useCallback)(async () => {
				if (syncing) return;
				setSyncing(true);
				setSyncNote(null);
				try {
					const res = await fetch(SYNC_PATH, { method: "POST" });
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const result = await res.json();
					setSyncNote(`社区同步完成：新增 ${result.synced.length}，跳过 ${result.skipped.length}，失败 ${result.failed.length}`);
					await load();
				} catch (err) {
					setSyncNote(`社区同步失败：${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setSyncing(false);
				}
			}, [syncing, load]);
			const games = manifest?.games ?? [];
			const shown = category === "全部" ? games : games.filter((game) => game.category === category);
			const categories = ["全部", ...manifest?.categories ?? []];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "d7d7-view",
				role: "region",
				"aria-label": "7d7d 游戏门户",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "d7d7-header",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "d7d7-title",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "d7d7-logo",
									children: "🎮 7D7D"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "d7d7-subtitle",
									children: "游戏门户 · 本地 + 社区"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "d7d7-categories",
								role: "tablist",
								"aria-label": "游戏分类",
								children: categories.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": category === name,
									className: category === name ? "d7d7-chip d7d7-chip-active" : "d7d7-chip",
									onClick: () => {
										setCategory(name);
									},
									children: name
								}, name))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "d7d7-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "d7d7-sync",
									onClick: () => {
										syncCommunity();
									},
									disabled: syncing,
									title: "从社区目录拉取新的游戏",
									children: syncing ? "同步中…" : "⇅ 社区同步"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "d7d7-refresh",
									onClick: () => {
										load();
									},
									title: "刷新游戏库",
									"aria-label": "刷新游戏库",
									children: "⟳"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
						className: "d7d7-body",
						children: [
							syncNote !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "d7d7-sync-note",
								children: syncNote
							}),
							error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "d7d7-error",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["门户加载失败：", error] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "d7d7-error-hint",
									children: "请确认 7d7d 插件已在 profile 中启用，并刷新页面重试。"
								})]
							}),
							error === null && manifest === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "d7d7-loading",
								children: "正在加载游戏库…"
							}),
							error === null && manifest !== null && shown.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "d7d7-loading",
								children: "这个分类还没有游戏。让模型写一个吧——见 skills/7d7d。"
							}),
							error === null && shown.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "d7d7-grid",
								children: shown.map((game) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "d7d7-card",
									onClick: () => {
										setCurrent(game);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "d7d7-card-cover",
										children: [
											game.cover !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												src: `${BASE}/g/${encodeURIComponent(game.slug)}/${game.cover}`,
												alt: game.title,
												loading: "lazy"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "d7d7-card-emoji",
												children: game.emoji
											}),
											game.type === "flash" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "d7d7-badge",
												children: "Flash"
											}),
											game.source === "community" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "d7d7-badge d7d7-badge-community",
												children: "社区"
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "d7d7-card-meta",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "d7d7-card-title",
											children: game.title
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "d7d7-card-category",
											children: game.category
										})]
									})]
								}, `${game.source}-${game.slug}`))
							})
						]
					}),
					current !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "d7d7-player-panel",
						role: "dialog",
						"aria-label": current.title,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "d7d7-header d7d7-header-player",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "d7d7-back",
									onClick: () => {
										setCurrent(null);
									},
									"aria-label": "返回游戏列表",
									children: "← 返回"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "d7d7-title",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "d7d7-logo",
										children: [
											current.emoji,
											" ",
											current.title
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "d7d7-subtitle",
										children: current.description
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "d7d7-fullscreen",
									onClick: () => {
										toggleFullscreen(document.getElementById("d7d7-player-stage"));
									},
									"aria-label": "全屏",
									children: "⛶"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							id: "d7d7-player-stage",
							className: "d7d7-stage",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
								title: current.title,
								src: playUrl(current),
								sandbox: "allow-scripts allow-forms allow-pointer-lock allow-modals",
								allow: "fullscreen; autoplay"
							})
						})]
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-css:portal.css-fbae325505d2.mjs
		const css = "/* 7d7d 门户视图样式：7k7k 式橙色调，填满会话视图区域，与 DSH shell 布局零耦合。 */\n\n.d7d7-view {\n  position: relative;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  background: #14151f;\n  color: #e8e9f2;\n  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;\n  overflow: hidden;\n}\n\n.d7d7-header {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  background: #1c1e2e;\n  border-bottom: 1px solid #2a2d42;\n  flex: none;\n}\n\n.d7d7-title {\n  display: flex;\n  align-items: baseline;\n  gap: 10px;\n  min-width: 0;\n  flex: 0 1 auto;\n}\n\n.d7d7-logo {\n  font-size: 17px;\n  font-weight: 800;\n  color: #ff7f27;\n  letter-spacing: 1px;\n  white-space: nowrap;\n}\n\n.d7d7-subtitle {\n  font-size: 12px;\n  color: #8b90a8;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.d7d7-categories {\n  display: flex;\n  gap: 8px;\n  overflow-x: auto;\n  flex: 1;\n  padding: 2px 0;\n  scrollbar-width: none;\n}\n\n.d7d7-categories::-webkit-scrollbar {\n  display: none;\n}\n\n.d7d7-chip {\n  flex: none;\n  padding: 5px 13px;\n  border: 1px solid #2a2d42;\n  border-radius: 999px;\n  background: transparent;\n  color: #b9bdd6;\n  font-size: 12.5px;\n  cursor: pointer;\n  transition: background 0.15s ease, color 0.15s ease;\n}\n\n.d7d7-chip:hover {\n  background: #262a40;\n}\n\n.d7d7-chip-active {\n  background: #ff7f27;\n  border-color: #ff7f27;\n  color: #fff;\n  font-weight: 600;\n}\n\n.d7d7-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex: none;\n  margin-left: auto;\n}\n\n.d7d7-sync,\n.d7d7-refresh,\n.d7d7-back,\n.d7d7-fullscreen {\n  border: none;\n  border-radius: 8px;\n  background: #2a2d42;\n  color: #b9bdd6;\n  cursor: pointer;\n  transition: background 0.15s ease, color 0.15s ease;\n}\n\n.d7d7-sync {\n  padding: 6px 12px;\n  font-size: 12.5px;\n}\n\n.d7d7-sync:hover:not(:disabled),\n.d7d7-refresh:hover,\n.d7d7-back:hover,\n.d7d7-fullscreen:hover {\n  background: #3a3e58;\n  color: #fff;\n}\n\n.d7d7-sync:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.d7d7-refresh,\n.d7d7-fullscreen {\n  width: 30px;\n  height: 30px;\n  font-size: 14px;\n}\n\n.d7d7-back {\n  padding: 6px 13px;\n  font-size: 13px;\n}\n\n.d7d7-body {\n  flex: 1;\n  overflow-y: auto;\n  padding: 14px 16px 20px;\n}\n\n.d7d7-sync-note {\n  margin-bottom: 10px;\n  padding: 7px 12px;\n  border-radius: 8px;\n  background: #1e2436;\n  border: 1px solid #2a2d42;\n  color: #9fb3d8;\n  font-size: 12.5px;\n}\n\n.d7d7-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));\n  gap: 14px;\n}\n\n.d7d7-card {\n  display: flex;\n  flex-direction: column;\n  padding: 0;\n  border: 1px solid #2a2d42;\n  border-radius: 12px;\n  overflow: hidden;\n  background: #1c1e2e;\n  cursor: pointer;\n  text-align: left;\n  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;\n}\n\n.d7d7-card:hover {\n  transform: translateY(-3px);\n  border-color: #ff7f27;\n  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);\n}\n\n.d7d7-card-cover {\n  position: relative;\n  aspect-ratio: 4 / 3;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: linear-gradient(135deg, #23263b, #181a29);\n  overflow: hidden;\n}\n\n.d7d7-card-cover img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.d7d7-card-emoji {\n  font-size: 48px;\n  filter: saturate(0.9);\n}\n\n.d7d7-badge {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  padding: 2px 7px;\n  border-radius: 999px;\n  background: rgba(20, 21, 31, 0.85);\n  border: 1px solid #ff7f27;\n  color: #ff7f27;\n  font-size: 10.5px;\n  font-weight: 700;\n}\n\n.d7d7-badge-community {\n  right: auto;\n  left: 8px;\n  border-color: #40c4ff;\n  color: #40c4ff;\n}\n\n.d7d7-card-meta {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 9px 11px;\n}\n\n.d7d7-card-title {\n  font-size: 13.5px;\n  font-weight: 600;\n  color: #e8e9f2;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.d7d7-card-category {\n  flex: none;\n  font-size: 11px;\n  color: #8b90a8;\n}\n\n.d7d7-loading,\n.d7d7-error {\n  padding: 50px 20px;\n  text-align: center;\n  color: #8b90a8;\n  font-size: 14px;\n}\n\n.d7d7-error {\n  color: #ff8a80;\n}\n\n.d7d7-error-hint {\n  margin-top: 8px;\n  font-size: 12px;\n  color: #8b90a8;\n}\n\n/* 播放器：绝对定位盖住整个视图，返回后回到网格。 */\n.d7d7-player-panel {\n  position: absolute;\n  inset: 0;\n  z-index: 10;\n  display: flex;\n  flex-direction: column;\n  background: #14151f;\n}\n\n.d7d7-header-player {\n  gap: 10px;\n}\n\n.d7d7-stage {\n  flex: 1;\n  position: relative;\n  background: #000;\n}\n\n.d7d7-stage iframe {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  border: none;\n  background: #000;\n}\n";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@mattheliu/7d7d/portal.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@mattheliu/7d7d";
			tag.dataset.pluginCss = "@mattheliu/7d7d/portal.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/index.tsx
		/** 稳定插件名。 */
		const name = "7d7d-client";
		/** 所需服务：槽注册表（conversation.view 由 ui-conversation 声明，我们只注条目）。 */
		const inject = ["slots"];
		/**
		* 插件主体：注册 7D7D 视图标签。
		* @param ctx - 客户端根上下文。
		*/
		function apply(ctx) {
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "7d7d",
				order: 20,
				label: "7D7D",
				inject: (_sessionId) => ({})
			}, PortalView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
