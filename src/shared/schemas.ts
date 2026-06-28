import { z } from 'zod'

export const ptyCreate = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})
export const ptyWrite = z.object({ id: z.string().min(1), data: z.string() })
export const ptyResize = z.object({ id: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() })
export const ptyKill = z.object({ id: z.string().min(1) })
export const configSet = z.object({ patch: z.record(z.string(), z.unknown()) })
export const scrollbackSave = z.object({ id: z.string().min(1), data: z.string() })
export const scrollbackLoad = z.object({ id: z.string().min(1) })
export const shellOpen = z.object({ url: z.string().url() })

export const schemaByChannel = {
  'pty:create': ptyCreate,
  'pty:write': ptyWrite,
  'pty:resize': ptyResize,
  'pty:kill': ptyKill,
  'config:set': configSet,
  'scrollback:save': scrollbackSave,
  'scrollback:load': scrollbackLoad,
  'shell:openExternal': shellOpen,
} as const
