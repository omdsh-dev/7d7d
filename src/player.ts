/**
 * Flash 播放页：加载 Ruffle（WASM 版 Flash 模拟器）跑 SWF。
 * Ruffle 只从同源 /ruffle/ 加载经过摘要校验的自托管文件，
 * 不在运行时加载第三方 CDN 资源。
 * @module 7d7d/player
 */

import type { GameMeta } from './types.ts'

/** SWF URL 前等待 Ruffle 就绪的最长时间（毫秒）。 */
const BOOT_TIMEOUT_MS = 15_000

/** 转义进 HTML 文本节点的字符串（本页只把 slug/title/swf 放进去）。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * 渲染 Flash 播放页。
 * @param game - 游戏元数据（type 应为 flash）。
 * @param baseUrl - 该游戏静态资源的基地址（`<origin>/g/<slug>`）。
 * @returns 完整 HTML 页面。
 */
export function renderPlayerPage(game: GameMeta, baseUrl: string, ruffleUrl: string): string {
  const swfUrl = `${baseUrl}/${game.swf}`
  const title = escapeHtml(game.title)
  const swfJson = JSON.stringify(swfUrl)
  const ruffleJson = JSON.stringify(ruffleUrl)
  const timeout = BOOT_TIMEOUT_MS
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 7d7d</title>
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
  var SWF = ${swfJson};
  var hint = document.getElementById('hint');
  var deadline = Date.now() + ${timeout};
  var timer = null;
  var ruffleLoadFailed = false;

  // 只加载同源、自托管的 Ruffle，避免运行时引入远程脚本。
  (function () {
    var s = document.createElement('script');
    s.src = ${ruffleJson};
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
</script>
</body>
</html>
`
}
