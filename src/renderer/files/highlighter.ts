import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const THEME = 'github-dark'
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', markdown: 'markdown', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp',
  php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql',
  swift: 'swift', lua: 'lua', dockerfile: 'docker', vue: 'vue', svelte: 'svelte', dart: 'dart', scala: 'scala', ex: 'elixir', exs: 'elixir', clj: 'clojure',
}

// Explicit static import map: Vite cannot code-split a fully-dynamic
// import(`@shikijs/langs/${lang}`) — it silently drops it, leaving every file
// unhighlighted. One static import() per target lang lets Rollup code-split
// each grammar into its own lazily-fetched chunk.
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  html: () => import('@shikijs/langs/html'),
  xml: () => import('@shikijs/langs/xml'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  php: () => import('@shikijs/langs/php'),
  bash: () => import('@shikijs/langs/bash'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  lua: () => import('@shikijs/langs/lua'),
  docker: () => import('@shikijs/langs/docker'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  dart: () => import('@shikijs/langs/dart'),
  scala: () => import('@shikijs/langs/scala'),
  elixir: () => import('@shikijs/langs/elixir'),
  clojure: () => import('@shikijs/langs/clojure'),
}

export function extToLang(pathOrExt: string): string {
  const name = pathOrExt.split('/').pop() ?? pathOrExt
  if (name.toLowerCase() === 'dockerfile') return 'docker'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return EXT_TO_LANG[ext] ?? 'text'
}

let hlPromise: Promise<HighlighterCore> | null = null
const loaded = new Set<string>(['text'])
function getHighlighter(): Promise<HighlighterCore> {
  hlPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [import('@shikijs/themes/github-dark')],
    langs: [],
  })
  return hlPromise
}

export async function highlight(code: string, pathOrExt: string): Promise<string> {
  const lang = extToLang(pathOrExt)
  const hl = await getHighlighter()
  if (lang !== 'text' && !loaded.has(lang)) {
    const loader = LANG_LOADERS[lang]
    if (loader) {
      try { await hl.loadLanguage(loader() as Parameters<typeof hl.loadLanguage>[0]); loaded.add(lang) } catch { /* unknown -> text */ }
    }
  }
  const useLang = loaded.has(lang) ? lang : 'text'
  return hl.codeToHtml(code, { lang: useLang, theme: THEME })
}
