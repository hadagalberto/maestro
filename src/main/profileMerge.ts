import type { Profile, ProfileEntry } from '@shared/types'

type EntryMap = Record<string, ProfileEntry>

function toProfile(id: string, e: ProfileEntry, source: Profile['source']): Profile {
  return {
    id,
    name: e.name ?? id,
    command: e.command,
    args: e.args ?? [],
    cwd: e.cwd,
    env: e.env,
    autoStart: e.autoStart ?? false,
    color: e.color,
    disabled: e.disabled,
    autoRestart: e.autoRestart,
    source,
  }
}

export function mergeProfiles(presets: EntryMap, global: EntryMap, project: EntryMap): Profile[] {
  const byId = new Map<string, Profile>()
  for (const [id, e] of Object.entries(presets)) byId.set(id, toProfile(id, e, 'preset'))
  for (const [id, e] of Object.entries(global)) byId.set(id, toProfile(id, e, 'global'))
  for (const [id, e] of Object.entries(project)) byId.set(id, toProfile(id, e, 'project'))
  return [...byId.values()].filter((p) => !p.disabled)
}
