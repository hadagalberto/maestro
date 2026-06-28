import { join } from 'node:path'
import { loadMaestroConfig } from './maestroConfig'
import { MaestroWatcher } from './maestroWatcher'
import { mergeProfiles } from './profileMerge'
import { isTrusted } from './trust'
import { PROFILE_PRESETS } from '@shared/presets'
import type { ConfigStore } from './configStore'
import type { ProjectState } from '@shared/ipc'
import type { ProfileEntry } from '@shared/types'

const MAESTRO_FILE = 'maestro.yml'

export class ProjectManager {
  private watcher = new MaestroWatcher()
  private projectEntries: Record<string, ProfileEntry> = {}
  constructor(private config: ConfigStore, private onChanged: (s: ProjectState) => void) {}

  maestroPath(root: string): string { return join(root, MAESTRO_FILE) }

  async open(root: string): Promise<ProjectState> {
    this.config.pushRecentProject(root)
    this.watcher.start(this.maestroPath(root), () => { void this.emit() })
    return this.state()
  }

  private async emit(): Promise<void> { this.onChanged(await this.state()) }

  async state(): Promise<ProjectState> {
    const cfg = this.config.get()
    const root = cfg.currentProject
    const global = cfg.globalProfiles as Record<string, ProfileEntry>
    let projectEntries: Record<string, ProfileEntry> = {}
    let problems: ProjectState['problems'] = []
    let hasMaestroFile = false

    if (root) {
      const res = await loadMaestroConfig(this.maestroPath(root))
      if (res.ok === true) { projectEntries = res.profiles; hasMaestroFile = true }
      else if (res.ok === false) { problems = res.problems; hasMaestroFile = true }
    }
    this.projectEntries = projectEntries
    const profiles = mergeProfiles(PROFILE_PRESETS, global, projectEntries)
    const trusted = root ? isTrusted(root, cfg.trust) : true
    return { currentProject: root, recentProjects: cfg.recentProjects, trusted, profiles, problems, hasMaestroFile }
  }

  effectiveEntries(): Record<string, ProfileEntry> {
    return { ...PROFILE_PRESETS, ...this.config.get().globalProfiles, ...this.projectEntries }
  }

  stop(): void { this.watcher.stop() }
}
