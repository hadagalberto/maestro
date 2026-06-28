export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
export interface GitFile { path: string; status: FileStatus; staged: boolean; added: number; deleted: number }
export interface GitStatus { isRepo: boolean; branch: string | null; ahead: number; behind: number; staged: GitFile[]; unstaged: GitFile[]; hasRemote: boolean }
export interface GitResult { ok: boolean; message?: string }
export interface PrResult { ok: boolean; url?: string; message?: string }
