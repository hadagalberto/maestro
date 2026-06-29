export interface QueenInfo { running: boolean; url: string | null; port: number | null; token: string | null; mcpConfigPath: string | null }
export type TerminalOp = 'terminals.list' | 'terminals.spawn' | 'terminals.kill' | 'terminals.read' | 'terminals.write'
export interface QueenRequest { reqId: string; op: TerminalOp; args: Record<string, unknown> }
export interface QueenResponse { reqId: string; ok: boolean; result?: unknown; error?: string }
export interface MailMessage { id: string; from: string; to: string; text: string; ts: number; read: boolean }
