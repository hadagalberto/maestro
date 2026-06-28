import Store, { type Options } from 'electron-store'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/types'

const CURRENT_SCHEMA = 1

type Schema = { config: AppConfig }

// electron-store v11 exporta uma classe (default export) que exige `new`.
// Em teste ela é mockada por uma factory (`vi.fn(() => mockStore)`) cuja
// implementação é arrow function — não construível via `new`. Este helper
// usa `new` em produção e cai para chamada simples quando o alvo não é
// construível, preservando a tipagem do generic em ambos os casos.
function createStore(options: Options<Schema>): Store<Schema> {
  try {
    return new Store<Schema>(options)
  } catch (err) {
    if (err instanceof TypeError && /not a constructor/.test(err.message)) {
      return (Store as unknown as (o: Options<Schema>) => Store<Schema>)(options)
    }
    throw err
  }
}

export class ConfigStore {
  private store = createStore({ name: 'hiveterm' })

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
