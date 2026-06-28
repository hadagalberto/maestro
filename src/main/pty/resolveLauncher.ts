import which from 'which'

export interface Launcher { file: string; args: string[] }

export function resolveLauncher(
  command: string,
  args: string[] = [],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Launcher {
  if (platform === 'win32') {
    const found = (which.sync(command, { all: true, nothrow: true }) as string[] | null) ?? []
    const shim = found.find((p) => !/\.[^/\\]+$/.test(p))
    const cmd = found.find((p) => p.toLowerCase().endsWith('.cmd'))
      ?? found.find((p) => p.toLowerCase().endsWith('.exe'))
      ?? (shim ? `${shim}.cmd` : `${command}.cmd`)
    const comspec = env.ComSpec ?? 'cmd.exe'
    return { file: comspec, args: ['/d', '/s', '/c', cmd, ...args] }
  }
  const shell = env.SHELL ?? '/bin/bash'
  const line = [command, ...args].join(' ')
  return { file: shell, args: ['-lc', line] }
}
