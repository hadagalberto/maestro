import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

// Auto-conecta cada CLI aberto ao servidor MCP da Queen, com a estratégia que cada um
// suporta de forma não-interativa (verificado nas docs oficiais):
//   claude     → flag --mcp-config <arquivo> (arquivo estático com ${VAR})
//   codex      → flags -c mcp_servers.maestro.* (url + bearer_token_env_var)
//   opencode   → env OPENCODE_CONFIG_CONTENT (JSON inline, {env:VAR})
//   gemini     → arquivo .gemini/settings.json (httpUrl + headers, ${VAR})
//   amp        → arquivo .amp/settings.json (amp.mcpServers, ${VAR})
//   antigravity→ arquivo .agents/mcp_config.json (serverUrl + token literal; sem ${VAR})
// O token nunca vai no argv: vem do env do painel (MAESTRO_MCP_TOKEN), exceto no
// antigravity, que não expande env e por isso recebe o token escrito no arquivo (gitignored).

export interface QueenLive { url: string; token: string }
export interface SpawnAug { args: string[]; env: Record<string, string> }

const NAME = 'maestro'
const URL_ENV = 'MAESTRO_MCP_URL'
const TOKEN_ENV = 'MAESTRO_MCP_TOKEN'

export function cliKind(command: string): string {
  return (command.split(/[\\/]/).pop() ?? command).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

// --- flag/env (puro) ---
export function flagEnvFor(command: string, queen: QueenLive, claudeConfigPath: string | null): SpawnAug {
  switch (cliKind(command)) {
    case 'claude':
      return claudeConfigPath ? { args: ['--mcp-config', claudeConfigPath], env: {} } : { args: [], env: {} }
    case 'codex':
      return { args: ['-c', `mcp_servers.${NAME}.url="${queen.url}"`, '-c', `mcp_servers.${NAME}.bearer_token_env_var="${TOKEN_ENV}"`], env: {} }
    case 'opencode':
      return { args: [], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { [NAME]: { type: 'remote', url: queen.url, enabled: true, headers: { Authorization: `Bearer {env:${TOKEN_ENV}}` } } } }) } }
    default:
      return { args: [], env: {} }
  }
}

// --- merges de arquivo (puros): null = não mexer (conteúdo existente inválido) ---
function parseObj(s: string | null): Record<string, unknown> | null {
  if (s == null || s.trim() === '') return {}
  try { const v: unknown = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null }
  catch { return null }
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function mergeGemini(existing: string | null): string | null {
  const cfg = parseObj(existing); if (!cfg) return null
  cfg.mcpServers = { ...obj(cfg.mcpServers), [NAME]: { httpUrl: `\${${URL_ENV}}`, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } } }
  return JSON.stringify(cfg, null, 2)
}
export function mergeAmp(existing: string | null): string | null {
  const cfg = parseObj(existing); if (!cfg) return null
  cfg['amp.mcpServers'] = { ...obj(cfg['amp.mcpServers']), [NAME]: { url: `\${${URL_ENV}}`, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } } }
  return JSON.stringify(cfg, null, 2)
}
export function mergeAntigravity(existing: string | null, queen: QueenLive): string | null {
  const cfg = parseObj(existing); if (!cfg) return null
  cfg.mcpServers = { ...obj(cfg.mcpServers), [NAME]: { serverUrl: queen.url, headers: { Authorization: `Bearer ${queen.token}` } } }
  return JSON.stringify(cfg, null, 2)
}

interface FileTarget { rel: string; ignore: string; merge: (existing: string | null) => string | null }
export function fileTargetsFor(command: string, queen: QueenLive): FileTarget[] {
  switch (cliKind(command)) {
    case 'gemini': return [{ rel: '.gemini/settings.json', ignore: '.gemini/', merge: mergeGemini }]
    case 'amp': return [{ rel: '.amp/settings.json', ignore: '.amp/', merge: mergeAmp }]
    case 'antigravity': case 'agy': return [{ rel: '.agents/mcp_config.json', ignore: '.agents/', merge: (e) => mergeAntigravity(e, queen) }]
    default: return []
  }
}

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

function ensureGitignore(cwd: string, line: string): void {
  try {
    const gi = join(cwd, '.gitignore')
    const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
    if (cur.split(/\r?\n/).some((l) => l.trim() === line.trim())) return
    writeFileSync(gi, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n')
  } catch { /* ignore */ }
}

// Aplica a injeção: devolve args/env p/ o spawn e escreve os arquivos de config necessários.
export function applyMcp(command: string, cwd: string, queen: QueenLive | null, claudeConfigPath: string | null): SpawnAug {
  if (!queen) return { args: [], env: {} }
  const aug = flagEnvFor(command, queen, claudeConfigPath)
  const targets = fileTargetsFor(command, queen)
  if (targets.length && isDir(cwd)) {
    for (const t of targets) {
      try {
        const abs = join(cwd, t.rel)
        const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null
        const next = t.merge(existing)
        if (next == null) continue // não corromper config existente inválido
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, next)
        ensureGitignore(cwd, t.ignore)
      } catch { /* best-effort por CLI */ }
    }
  }
  return aug
}
