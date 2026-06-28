import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { PaneConfig } from '@shared/types'
import { darkTheme } from './xtermTheme'
import { canEnableWebgl, releaseWebgl } from './webglPool'

export function TerminalPane({ pane }: { pane: PaneConfig }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
      scrollback: 5000, allowProposedApi: true, theme: darkTheme,
    })
    const fit = new FitAddon()
    const serialize = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11' // ANTES de escrever
    term.loadAddon(new SearchAddon())
    term.loadAddon(serialize)
    term.loadAddon(new WebLinksAddon((_e, uri) => { void window.term.invoke('shell:openExternal', { url: uri }) }))

    let cleanupData = () => {}
    let cleanupExit = () => {}
    let webgl: WebglAddon | null = null

    async function start() {
      const saved = await window.term.invoke('scrollback:load', { id: pane.id })
      if (disposed) return
      if (typeof saved === 'string' && saved) term.write(saved)
      term.open(el!)
      fit.fit()
      term.focus()

      // pula WebGL sob automação (Playwright seta navigator.webdriver): o renderer DOM
      // deixa o texto do terminal inspecionável no E2E. Sem efeito pro usuário real.
      if (!navigator.webdriver && canEnableWebgl(pane.id)) {
        try {
          const addon = new WebglAddon()
          addon.onContextLoss(() => { addon.dispose(); webgl = null; releaseWebgl(pane.id) })
          term.loadAddon(addon)
          webgl = addon
        } catch {
          releaseWebgl(pane.id) // sem WebGL2: cai pro DOM renderer
        }
      }

      cleanupData = window.term.onPtyData(pane.id, ({ data }) => term.write(data))
      cleanupExit = window.term.onPtyExit(pane.id, ({ code, reason }) => {
        term.writeln(`\r\n\x1b[31m[processo terminou code=${code}${reason ? ' ' + reason : ''}]\x1b[0m`)
      })
      term.onData((d) => { void window.term.invoke('pty:write', { id: pane.id, data: d }) })

      await window.term.invoke('pty:create', {
        id: pane.id, command: pane.command, args: pane.args, cwd: pane.cwd,
        env: pane.env, cols: term.cols, rows: term.rows,
      })
    }
    void start()

    const ro = new ResizeObserver(() => {
      fit.fit()
      void window.term.invoke('pty:resize', { id: pane.id, cols: term.cols, rows: term.rows })
    })
    ro.observe(el)

    const focusOnDown = () => term.focus()
    el.addEventListener('mousedown', focusOnDown)

    return () => {
      disposed = true
      ro.disconnect()
      el.removeEventListener('mousedown', focusOnDown)
      void window.term.invoke('scrollback:save', { id: pane.id, data: serialize.serialize() })
      cleanupData(); cleanupExit()
      webgl?.dispose(); releaseWebgl(pane.id)
      term.dispose()
    }
    // só pane.id: command/cwd/args/env são imutáveis por terminal; evita matar/respawnar o PTY
  }, [pane.id])

  return <div ref={host} className="h-full w-full" />
}
