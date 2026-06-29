export interface SearchMatch { line: number; text: string }
export interface SearchFileResult { path: string; matches: SearchMatch[] }
export interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean }
export interface FileContent { path: string; content: string; truncated: boolean; binary: boolean }
