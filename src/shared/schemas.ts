import { z } from 'zod'

export const ptyCreate = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  origin: z.enum(['user', 'project']).default('user'),
  projectRoot: z.string().optional(),
  name: z.string().optional(),
  parentId: z.string().optional(),
}).refine((v) => v.origin !== 'project' || (v.projectRoot != null && v.projectRoot.length > 0), {
  message: 'projectRoot is required when origin is "project"',
  path: ['projectRoot'],
})
export const ptyWrite = z.object({ id: z.string().min(1), data: z.string() })
export const ptyResize = z.object({ id: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() })
export const ptyKill = z.object({ id: z.string().min(1) })
const layoutKindSchema = z.enum(['two', 'three', 'quad'])
const paneConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string(),
  env: z.record(z.string(), z.string()).optional(),
  color: z.string().optional(),
  profileId: z.string().optional(),
  origin: z.enum(['user', 'project']).optional(),
  projectRoot: z.string().optional(),
  parentId: z.string().optional(),
})
const settingsPatchSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  scrollback: z.number(),
  theme: z.enum(['system', 'light', 'dark']),
}).partial()
export const configSet = z.object({
  patch: z.object({
    panes: z.array(paneConfigSchema).optional(),
    activeLayout: layoutKindSchema.optional(),
    layoutSizes: z.record(z.string(), z.array(z.number())).optional(),
    settings: settingsPatchSchema.optional(),
  }),
})
export const scrollbackSave = z.object({ id: z.string().min(1), data: z.string() })
export const scrollbackLoad = z.object({ id: z.string().min(1) })
export const shellOpen = z.object({ url: z.url() })

export const profileEntrySchema = z.object({
  name: z.string().optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  autoStart: z.boolean().default(false),
  color: z.string().optional(),
  disabled: z.boolean().optional(),
  discuss: z.object({
    argsTemplate: z.array(z.string()),
    stdin: z.boolean().optional(),
    captureMode: z.enum(['pipe', 'pty']).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }).optional(),
})
export const maestroConfigSchema = z.object({
  version: z.literal(1),
  defaultProfile: z.string().optional(),
  profiles: z.record(z.string(), profileEntrySchema),
})

export const openPath = z.object({ path: z.string().min(1) })
export const setGlobalProfiles = z.object({ profiles: z.record(z.string(), profileEntrySchema) })
export const trustPath = z.object({ path: z.string().min(1) })

export const summaryCardSchema = z.object({
  kind: z.enum(['decision', 'ideas', 'verdict', 'plan', 'status', 'note']),
  title: z.string(),
  body: z.string(),
  dissents: z.array(z.string()).optional(),
  actions: z.array(z.object({ owner: z.string().optional(), task: z.string() })).optional(),
})

export const discussionInput = z.object({
  topic: z.string().min(1),
  templateKind: z.enum(['decision', 'brainstorm', 'review', 'plan', 'dev-squad', 'custom']),
  orchestratorProfileId: z.string().min(1),
  participantProfileIds: z.array(z.string().min(1)).min(2),
  autonomous: z.boolean(),
})

export const discussionId = z.object({ id: z.string().min(1) })
export const discussionApprove = z.object({ id: z.string().min(1), approve: z.boolean() })

export const gitDiffArgs = z.object({ file: z.string().min(1), staged: z.boolean() })
export const gitFileArg = z.object({ file: z.string().min(1) })
export const gitCommitArgs = z.object({ message: z.string().min(1) })
export const gitPrArgs = z.object({ title: z.string().min(1), body: z.string() })

export const schemaByChannel = {
  'pty:create': ptyCreate,
  'pty:write': ptyWrite,
  'pty:resize': ptyResize,
  'pty:kill': ptyKill,
  'config:set': configSet,
  'scrollback:save': scrollbackSave,
  'scrollback:load': scrollbackLoad,
  'shell:openExternal': shellOpen,
  'project:openPath': openPath,
  'profiles:setGlobal': setGlobalProfiles,
  'maestro:scaffold': trustPath,
  'trust:get': trustPath,
  'trust:grant': trustPath,
  'trust:grantParent': trustPath,
  'trust:revoke': trustPath,
  'discussion:start': discussionInput,
  'discussion:get': discussionId,
  'discussion:abort': discussionId,
  'discussion:delete': discussionId,
  'discussion:approve': discussionApprove,
  'git:diff': gitDiffArgs,
  'git:stage': gitFileArg,
  'git:unstage': gitFileArg,
  'git:commit': gitCommitArgs,
  'git:createPR': gitPrArgs,
} as const
