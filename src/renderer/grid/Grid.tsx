import { useGrid } from '../store/gridStore'
import { TwoPane } from './TwoPane'
import { ThreePane } from './ThreePane'
import { QuadPane } from './QuadPane'

export function Grid() {
  const layout = useGrid((s) => s.activeLayout)
  const panes = useGrid((s) => s.panes)
  if (layout === 'two') return <TwoPane panes={panes} />
  if (layout === 'three') return <ThreePane panes={panes} />
  return <QuadPane panes={panes} />
}
