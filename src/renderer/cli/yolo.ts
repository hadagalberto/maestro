// Inicia o CLI pulando TODAS as permissões/aprovações. Flags/envs verificados nas docs
// oficiais de cada CLI (perigoso: o CLI executa comandos sem perguntar — opt-in por-perfil).
const kind = (cmd: string): string => (cmd.split(/[\\/]/).pop() ?? cmd).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()

export interface YoloInject { args: string[]; env: Record<string, string> }

export function yoloInject(command: string, yolo: boolean | undefined): YoloInject {
  if (!yolo) return { args: [], env: {} }
  switch (kind(command)) {
    case 'claude': return { args: ['--dangerously-skip-permissions'], env: {} }
    case 'codex': return { args: ['--dangerously-bypass-approvals-and-sandbox'], env: {} }
    case 'gemini': return { args: ['--approval-mode=yolo'], env: {} }
    case 'amp': return { args: ['--dangerously-allow-all'], env: {} }
    case 'antigravity': case 'agy': return { args: ['--yolo'], env: {} }
    case 'opencode': return { args: [], env: { OPENCODE_PERMISSION: '{"*":"allow"}' } } // opencode não tem flag
    default: return { args: [], env: {} }
  }
}
