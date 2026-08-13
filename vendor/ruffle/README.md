# 自托管 Ruffle

运行 `pnpm fetch:ruffle` 安装 Ruffle 0.5.0。安装器只访问固定地址：

```text
https://registry.npmjs.org/@ruffle-rs/ruffle/-/ruffle-0.5.0.tgz
```

供应链门禁分两层：

1. npm tarball 必须匹配 registry SHA-512 SRI：
   `sha512-BBlfXsOkUXtB1wMUC5y27v6SRdDsuVYdPzGq80MzmF1QWryHkWYZh4I7I22uura07TFNzBeb5RKsyjct3JTjLA==`；
2. `ruffle.js`、两个 core chunk 和两个 WASM 文件必须逐一匹配
   `scripts/fetch-ruffle.mjs` 中审查过的 SHA-256 清单。

下载先落在系统临时目录。所有校验通过后，运行文件与上游 MIT/Apache-2.0 许可文本
才会通过同文件系统 rename 原子安装到 `runtime-0.5.0/`。任一差异都会安全失败，
不会覆盖或部分写入现有运行目录。版本化运行目录不入 Git，也不会进入 npm pack。

Flash 播放页只加载插件前缀下的同源 `/ruffle/*` 文件，不会在运行时回退到第三方 CDN。
