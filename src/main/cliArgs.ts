import { statSync } from 'node:fs'
import { resolve } from 'node:path'

const dirExists = (p: string): boolean => {
  try { return statSync(p).isDirectory() } catch { return false }
}

// Dado os argumentos de usuário (já sem o argv[0]/app-dir do Electron), retorna o
// primeiro que resolve para uma pasta existente — o projeto a abrir. Flags (-x) são
// ignoradas. `maestro .` abre o cwd; `maestro C:\proj` abre essa pasta; nenhum → null.
export function projectPathFromArgs(args: string[], cwd: string, isDir: (p: string) => boolean = dirExists): string | null {
  for (const a of args) {
    if (!a || a.startsWith('-')) continue
    const abs = resolve(cwd, a)
    if (isDir(abs)) return abs
  }
  return null
}

// Recorta o argv conforme empacotado (argv[0]=exe) ou dev (argv[0]=electron, argv[1]=appDir).
export function userArgs(argv: string[], isPackaged: boolean): string[] {
  return argv.slice(isPackaged ? 1 : 2)
}
