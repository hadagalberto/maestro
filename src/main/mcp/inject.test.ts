import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliKind, flagEnvFor, mergeGemini, mergeAmp, mergeAntigravity, applyMcp } from './inject'

const Q = { url: 'http://127.0.0.1:54321/mcp', token: 'tok_abc' }

describe('cliKind', () => {
  it('extrai basename sem extensão', () => {
    expect(cliKind('C:\\bin\\claude.exe')).toBe('claude')
    expect(cliKind('/usr/local/bin/codex')).toBe('codex')
    expect(cliKind('agy')).toBe('agy')
    expect(cliKind('powershell.exe')).toBe('powershell')
  })
})

describe('flagEnvFor', () => {
  it('claude → --mcp-config quando há path', () => {
    expect(flagEnvFor('claude', Q, '/u/mcp.json')).toEqual({ args: ['--mcp-config', '/u/mcp.json'], env: {} })
    expect(flagEnvFor('claude', Q, null)).toEqual({ args: [], env: {} })
  })
  it('codex → -c url + bearer_token_env_var', () => {
    const r = flagEnvFor('codex', Q, null)
    expect(r.args).toEqual(['-c', `mcp_servers.maestro.url="${Q.url}"`, '-c', 'mcp_servers.maestro.bearer_token_env_var="MAESTRO_MCP_TOKEN"'])
    expect(r.env).toEqual({})
  })
  it('opencode → env OPENCODE_CONFIG_CONTENT com {env:VAR}', () => {
    const r = flagEnvFor('opencode', Q, null)
    expect(r.args).toEqual([])
    const cfg = JSON.parse(r.env.OPENCODE_CONFIG_CONTENT)
    expect(cfg.mcp.maestro.url).toBe(Q.url)
    expect(cfg.mcp.maestro.headers.Authorization).toBe('Bearer {env:MAESTRO_MCP_TOKEN}')
  })
  it('CLI baseado em arquivo (gemini) → sem flag/env aqui', () => {
    expect(flagEnvFor('gemini', Q, null)).toEqual({ args: [], env: {} })
  })
})

describe('merges (não destrutivos)', () => {
  it('gemini adiciona maestro e preserva chaves existentes', () => {
    const out = mergeGemini('{"theme":"dark","mcpServers":{"outro":{"httpUrl":"x"}}}')
    const c = JSON.parse(out!)
    expect(c.theme).toBe('dark')
    expect(c.mcpServers.outro).toEqual({ httpUrl: 'x' })
    expect(c.mcpServers.maestro.httpUrl).toBe('${MAESTRO_MCP_URL}')
    expect(c.mcpServers.maestro.headers.Authorization).toBe('Bearer ${MAESTRO_MCP_TOKEN}')
  })
  it('amp usa a chave amp.mcpServers', () => {
    const c = JSON.parse(mergeAmp('')!)
    expect(c['amp.mcpServers'].maestro.url).toBe('${MAESTRO_MCP_URL}')
  })
  it('antigravity escreve serverUrl + token literal (sem env)', () => {
    const c = JSON.parse(mergeAntigravity('', Q)!)
    expect(c.mcpServers.maestro.serverUrl).toBe(Q.url)
    expect(c.mcpServers.maestro.headers.Authorization).toBe(`Bearer ${Q.token}`)
  })
  it('conteúdo inválido → null (não corromper)', () => {
    expect(mergeGemini('{bad json')).toBeNull()
    expect(mergeAmp('[]')).toBeNull()
  })
})

describe('applyMcp', () => {
  it('queen ausente → vazio', () => {
    expect(applyMcp('claude', '.', null, '/u/mcp.json')).toEqual({ args: [], env: {} })
  })
  it('claude → flag, sem escrever arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-claude-'))
    expect(applyMcp('claude', dir, Q, '/u/mcp.json')).toEqual({ args: ['--mcp-config', '/u/mcp.json'], env: {} })
    expect(existsSync(join(dir, '.gemini'))).toBe(false)
  })
  it('gemini → escreve .gemini/settings.json + gitignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-gem-'))
    const r = applyMcp('gemini', dir, Q, null)
    expect(r).toEqual({ args: [], env: {} })
    const cfg = JSON.parse(readFileSync(join(dir, '.gemini/settings.json'), 'utf8'))
    expect(cfg.mcpServers.maestro.httpUrl).toBe('${MAESTRO_MCP_URL}')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.gemini/')
  })
  it('gemini com config existente inválido → NÃO sobrescreve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-gembad-'))
    mkdirSync(join(dir, '.gemini'), { recursive: true })
    const bad = '{ this is not json'
    writeFileSync(join(dir, '.gemini/settings.json'), bad)
    applyMcp('gemini', dir, Q, null)
    expect(readFileSync(join(dir, '.gemini/settings.json'), 'utf8')).toBe(bad)
  })
})
