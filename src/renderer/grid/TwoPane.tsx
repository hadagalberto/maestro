import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { PaneConfig } from '@shared/types'
import { TerminalPane } from '../term/TerminalPane'
import { layoutStorage } from './layoutStorage'

const vsep = 'w-1 bg-zinc-700 hover:bg-sky-600'

export function TwoPane({ panes }: { panes: PaneConfig[] }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'grid-two', storage: layoutStorage })
  return (
    <Group orientation="horizontal" id="grid-two" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} className="h-full w-full">
      <Panel minSize="15%">{panes[0] && <TerminalPane key={panes[0].id} pane={panes[0]} />}</Panel>
      <Separator className={vsep} />
      <Panel minSize="15%">{panes[1] && <TerminalPane key={panes[1].id} pane={panes[1]} />}</Panel>
    </Group>
  )
}
