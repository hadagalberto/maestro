import type { Layout, LayoutStorage } from 'react-resizable-panels'
import type { AppConfig } from '@shared/types'

// react-resizable-panels serializa um `Layout` ({ [panelId: string]: number })
// para a string passada em storage.setItem. Mantemos o blob cru por chave de
// storage ("react-resizable-panels:<id>") para um round-trip fiel em getItem.
let cache: Record<string, string> = {}

// `AppConfig.layoutSizes` é Record<string, number[]>, então persistimos apenas
// o vetor numérico (Object.values do Layout) — type-honest, sem cast/any.
function toSizes(blob: string): number[] {
  try {
    const layout = JSON.parse(blob) as Layout
    return Object.values(layout)
  } catch {
    return []
  }
}

function serializeAll(): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [key, blob] of Object.entries(cache)) out[key] = toSizes(blob)
  return out
}

export async function hydrateLayoutSizes(): Promise<void> {
  const cfg: AppConfig = await window.term.invoke('config:get', undefined)
  const sizes = cfg.layoutSizes ?? {}
  cache = {}
  // Reconstrói um Layout posicional a partir do vetor numérico salvo. As chaves
  // de painel só são restauradas dentro da sessão (setItem grava o blob fiel);
  // entre reloads o react-resizable-panels degrada graciosamente se as chaves
  // não baterem, sem lançar erro.
  for (const [key, vec] of Object.entries(sizes)) {
    const layout: Layout = {}
    vec.forEach((n, i) => { layout[String(i)] = n })
    cache[key] = JSON.stringify(layout)
  }
}

export const layoutStorage: LayoutStorage = {
  getItem: (key) => cache[key] ?? null,
  setItem: (key, value) => {
    cache[key] = value
    void window.term.invoke('config:set', { patch: { layoutSizes: serializeAll() } })
  },
}
