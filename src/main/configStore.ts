import ElectronStore from 'electron-store'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/types'

// electron-store v11 is ESM; under the CJS main build the externalized `require`
// yields the module namespace, so unwrap `.default` to get the real constructor.
// Works for the real package and the test mock alike.
const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

const CURRENT_SCHEMA = 1

export class ConfigStore {
  private store = new Store<{ config: AppConfig }>({ name: 'hiveterm' })

  get(): AppConfig {
    const saved = this.store.get('config')
    if (!saved) return DEFAULT_CONFIG
    return this.migrate(saved)
  }

  set(patch: Partial<AppConfig>): void {
    const next: AppConfig = {
      ...this.get(),
      ...patch,
      settings: { ...this.get().settings, ...(patch.settings ?? {}) },
    }
    this.store.set('config', next)
  }

  private migrate(cfg: AppConfig): AppConfig {
    if (cfg.schemaVersion === CURRENT_SCHEMA) return cfg
    // migrações futuras aqui; por ora normaliza para o default + dados conhecidos
    return { ...DEFAULT_CONFIG, ...cfg, schemaVersion: CURRENT_SCHEMA }
  }
}
