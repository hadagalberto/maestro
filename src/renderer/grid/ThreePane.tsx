import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { PaneConfig } from '@shared/types'
import { TerminalPane } from '../term/TerminalPane'
import { layoutStorage } from './layoutStorage'

const vsep = 'w-1 bg-zinc-700 hover:bg-sky-600'

export function ThreePane({ panes }: { panes: PaneConfig[] }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'grid-three', storage: layoutStorage })
  return (
    <Group orientation="horizontal" id="grid-three" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} className="h-full w-full">
      <Panel minSize="15%">{panes[0] && <TerminalPane key={panes[0].id} pane={panes[0]} />}</Panel>
      <Separator className={vsep} />
      <Panel minSize="15%">{panes[1] && <TerminalPane key={panes[1].id} pane={panes[1]} />}</Panel>
      <Separator className={vsep} />
      <Panel minSize="15%">{panes[2] && <TerminalPane key={panes[2].id} pane={panes[2]} />}</Panel>
    </Group>
  )
}
