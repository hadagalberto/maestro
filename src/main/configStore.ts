import ElectronStore from 'electron-store'
import { DEFAULT_CONFIG, type AppConfig, type ProfileEntry, type TrustConfig } from '@shared/types'

// electron-store v11 is ESM; under the CJS main build the externalized `require`
// yields the module namespace, so unwrap `.default` to get the real constructor.
// Works for the real package and the test mock alike.
const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore
const CURRENT_SCHEMA = 2

export class ConfigStore {
  private store = new Store<{ config: AppConfig }>({ name: 'maestro' })

  get(): AppConfig {
    const saved = this.store.get('config')
    if (!saved) return DEFAULT_CONFIG
    return this.migrate(saved)
  }

  set(patch: Partial<AppConfig>): void {
    const cur = this.get()
    const next: AppConfig = {
      ...cur,
      ...patch,
      settings: { ...cur.settings, ...(patch.settings ?? {}) },
      trust: { ...cur.trust, ...(patch.trust ?? {}) },
    }
    this.store.set('config', next)
  }

  setGlobalProfiles(profiles: Record<string, ProfileEntry>): void { this.set({ globalProfiles: profiles }) }

  pushRecentProject(p: string): void {
    const cur = this.get()
    const recent = [p, ...cur.recentProjects.filter((x) => x !== p)].slice(0, 10)
    this.set({ recentProjects: recent, currentProject: p })
  }

  grantTrust(p: string): TrustConfig {
    const t = this.get().trust
    const next: TrustConfig = { trustedFolders: [...new Set([...t.trustedFolders, p])], deniedFolders: t.deniedFolders.filter((d) => d !== p) }
    this.set({ trust: next }); return next
  }
  revokeTrust(p: string): TrustConfig {
    const t = this.get().trust
    const next: TrustConfig = { trustedFolders: t.trustedFolders.filter((x) => x !== p), deniedFolders: t.deniedFolders }
    this.set({ trust: next }); return next
  }

  private migrate(cfg: AppConfig): AppConfig {
    if (cfg.schemaVersion === CURRENT_SCHEMA) return cfg
    return {
      ...DEFAULT_CONFIG,
      ...cfg,
      schemaVersion: CURRENT_SCHEMA,
      settings: { ...DEFAULT_CONFIG.settings, ...(cfg.settings ?? {}) },
      globalProfiles: cfg.globalProfiles ?? {},
      recentProjects: cfg.recentProjects ?? [],
      currentProject: cfg.currentProject ?? null,
      trust: cfg.trust ?? { trustedFolders: [], deniedFolders: [] },
    }
  }
}
