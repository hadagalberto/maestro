import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument, stringify, type YAMLParseError } from 'yaml'
import { maestroConfigSchema } from '@shared/schemas'
import type { ConfigProblem, ProfileEntry } from '@shared/types'

export type LoadResult =
  | { ok: 'absent' }
  | { ok: true; profiles: Record<string, Required<Pick<ProfileEntry,'command'>> & ProfileEntry>; defaultProfile?: string }
  | { ok: false; problems: ConfigProblem[] }

export async function loadMaestroConfig(file: string): Promise<LoadResult> {
  let text: string
  try { text = await readFile(file, 'utf8') }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: 'absent' }; throw e }

  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true, strict: true })
  if (doc.errors.length) {
    return { ok: false, problems: doc.errors.map((e: YAMLParseError): ConfigProblem => ({
      kind: 'syntax', line: e.linePos?.[0]?.line ?? 0, col: e.linePos?.[0]?.col ?? 0, message: e.message,
    })) }
  }
  const data = doc.toJS()
  if (data == null) return { ok: false, problems: [{ kind: 'syntax', line: 1, col: 1, message: 'maestro.yml está vazio' }] }

  const parsed = maestroConfigSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i): ConfigProblem => ({
      kind: 'schema', path: i.path.join('.') || '(root)', message: i.message,
    })) }
  }
  return { ok: true, profiles: parsed.data.profiles, defaultProfile: parsed.data.defaultProfile }
}

export async function scaffoldMaestroConfig(file: string): Promise<void> {
  const starter = {
    version: 1,
    defaultProfile: 'claude',
    profiles: {
      claude: { command: 'claude', args: [] },
      codex: { command: 'codex', args: [] },
    },
  }
  const header = '# maestro.yml — perfis de CLI por projeto (config as code). Edite à mão.\n'
  await writeFile(file, header + stringify(starter), 'utf8')
}
