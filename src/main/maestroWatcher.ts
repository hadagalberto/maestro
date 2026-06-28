import { watchFile, unwatchFile } from 'node:fs'

// Watches a single file (maestro.yml) via polling — robust on Windows + atomic saves, no native/ESM deps.
export class MaestroWatcher {
  private file: string | null = null
  start(file: string, onChange: () => void): void {
    this.stop()
    this.file = file
    watchFile(file, { interval: 1000 }, () => onChange())
  }
  stop(): void {
    if (this.file) { unwatchFile(this.file); this.file = null }
  }
}
