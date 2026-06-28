let cache: { url: string; token: string } | null = null
export async function loadQueenEnv(): Promise<void> {
  const i = await window.term.invoke('queen:info', undefined)
  if (i.running && i.url && i.token) cache = { url: i.url, token: i.token }
}
export function queenEnv(): Record<string, string> {
  return cache ? { MAESTRO_MCP_URL: cache.url, MAESTRO_MCP_TOKEN: cache.token } : {}
}
