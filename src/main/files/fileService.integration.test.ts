import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import which from 'which'
import { FileService } from './fileService'

const git = which.sync('git', { nothrow: true })
const run = (cwd: string, ...a: string[]) => execFileSync(git!, a, { cwd })

describe.skipIf(!git)('FileService (real repo)', () => {
  let root: string
  const svc = new FileService()
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'maestro-files-'))
    run(root, 'init', '-q'); run(root, 'config', 'user.email', 't@t'); run(root, 'config', 'user.name', 'T')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'app.ts'), 'const greet = "hello"\n')
    writeFileSync(join(root, 'keep.md'), '# hello world\n')
    writeFileSync(join(root, 'ignored.txt'), 'hello secret\n')
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
  })
  it('listFiles respeita .gitignore', async () => {
    const files = await svc.listFiles(root)
    expect(files).toContain('src/app.ts'); expect(files).toContain('keep.md'); expect(files).toContain('.gitignore')
    expect(files).not.toContain('ignored.txt')
  })
  it('search acha em arquivos versionados e ignora o .gitignore-ado', async () => {
    const r = await svc.search(root, 'hello', { regex: false, caseSensitive: false, wholeWord: false })
    const paths = r.map((x) => x.path)
    expect(paths).toContain('src/app.ts'); expect(paths).toContain('keep.md')
    expect(paths).not.toContain('ignored.txt')
  })
  it('read devolve conteúdo', async () => {
    const c = await svc.read(root, 'src/app.ts')
    expect(c.content).toContain('greet'); expect(c.binary).toBe(false)
  })
})
