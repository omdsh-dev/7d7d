/** 让 tsc 认识 .css 副作用导入（打包时由 tsdown 的 css-inline 插件处理）。 */
declare module '*.css' {
  const css: string
  export default css
}
