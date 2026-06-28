# Git Panel — Design (sub-projeto #6)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA
**Base:** #1 grid + #2 perfis/trust + #3 discussões + #4 Queen + #5 sub-agent trees — no `main`.
**Escopo:** painel git do projeto aberto — status (arquivos alterados, +/-), diff inline (linhas coloridas), stage/unstage, commit, push, criar PR (gh), e "Ask AI" que gera a mensagem de commit a partir do diff.

---

## 1. Objetivo

Recriar o git inline do HiveTerm: ver o estado do repositório do projeto aberto sem sair do Maestro — arquivos alterados com contagem +/-, diff por arquivo, stage/unstage, commit (com mensagem sugerida por IA), push e criação de PR.

### Critérios de sucesso

1. Painel Git (toggle na toolbar) mostra a branch atual + arquivos staged e não-staged, cada um com +/- (numstat).
2. Clicar num arquivo mostra o diff (linhas adicionadas em verde, removidas em vermelho).
3. Stage/unstage por arquivo; commit (só do que está staged) com mensagem; push.
4. "Ask AI" gera a mensagem de commit a partir do diff staged (via uma CLI configurada, ex. `claude -p`).
5. Criar PR via `gh pr create` (título + corpo); erro claro se `gh` ausente ou sem remote.
6. Projeto não-git → painel diz "não é um repositório git"; sem projeto aberto → "abra um projeto".
7. git/gh rodam no **main** (não no renderer), no cwd da raiz do projeto.

### Fora de escopo (futuro)

Syntax highlight por token (Shiki) — v1 só colore linhas +/- ; vem no #7. Staging por hunk/linha (v1 = por arquivo). Trocar/criar branch, merge, resolver conflitos, stash. Histórico de commits. Git via Queen (agentes commitando) — risco; fica fora.

---

## 2. Arquitetura

```
┌─ Main ───────────────────────────────────────────────┐
│  GitService (cwd = projeto atual)                      │
│   runGit(args) / runGh(args) via captureOnce (#3)     │
│     binário resolvido por which (cache)               │
│   status / diff / stage / unstage / commit / push /   │
│   branch / isRepo / createPR / suggestCommit          │
│  parsers puros: parseStatus / parseNumstat            │
└───────────────┬───────────────────────────────────────┘
                │ IPC git:* (projeto atual via config.currentProject)
┌───────────────┴───────────────────────────────────────┐
│ Renderer: gitStore (status/diff/busy) + GitPanel       │
│  branch · arquivos staged/unstaged (+/-) · diff colorido│
│  commit box + Ask AI · Commit · Push · Create PR        │
└────────────────────────────────────────────────────────┘
```

**git é ação do usuário** (clica commit/push/PR) → **não** passa pelo workspace-trust gate (#2) (que protege execução por agente, não ação do usuário no próprio repo). `suggestCommit` roda uma CLI de IA no diff — o usuário opta clicando.

---

## 3. Modelo de dados

```ts
// shared/git.ts
type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
interface GitFile { path: string; status: FileStatus; staged: boolean; added: number; deleted: number }
interface GitStatus { isRepo: boolean; branch: string | null; ahead: number; behind: number; staged: GitFile[]; unstaged: GitFile[]; hasRemote: boolean }
interface GitResult { ok: boolean; message?: string }   // p/ commit/push/PR
interface PrResult { ok: boolean; url?: string; message?: string }
```

---

## 4. Unidades e interfaces

### 4.1 parsers — `src/main/git/parse.ts` (puros, testáveis)
```ts
parsePorcelain(z: string): { path; x; y; status: FileStatus; staged: boolean; unstaged: boolean }[]   // de `git status --porcelain=v1 -b -z`
parseBranchLine(line: string): { branch: string|null; ahead: number; behind: number }                 // da linha "## main...origin/main [ahead N, behind M]"
parseNumstat(s: string): Record<string, { added: number; deleted: number }>                            // de `git diff --numstat` (-, - = binário → 0)
```
Combina porcelain + numstat(unstaged) + numstat(--cached) → `GitStatus.staged/unstaged` com +/-. Untracked (`??`) → status 'untracked', unstaged, added/deleted via contagem de linhas? v1: untracked added=linhas do arquivo (do numstat não vem; usar `git diff --numstat --no-index /dev/null <file>`? complexo) → v1 untracked added/deleted = 0 (só lista). Renamed (`R`) → path "new" (porcelain dá "orig -> new"; pegar new).

### 4.2 `GitService` — `src/main/git/gitService.ts`
**Depende de:** `captureOnce` (#3), `which`.
```ts
class GitService {
  constructor(captureOnce?, whichSync?)   // injetáveis p/ teste
  async isRepo(root): Promise<boolean>
  async status(root): Promise<GitStatus>
  async diff(root, file, staged): Promise<string>     // git diff [--cached] -- <file>
  async stage(root, file): Promise<GitResult>          // git add -- <file>
  async unstage(root, file): Promise<GitResult>        // git restore --staged -- <file>
  async commit(root, message): Promise<GitResult>      // git commit -m <message>
  async push(root): Promise<GitResult>                 // git push
  async createPR(root, title, body): Promise<PrResult> // gh pr create --title --body --fill-first? (push antes)
  async suggestCommit(root, aiCommand, aiArgs): Promise<string>  // git diff --cached | <ai> -p "<prompt>"
}
```
`runGit(root, args)`: resolve git via `which.sync('git')` (cache; erro claro se ausente) → `captureOnce(gitPath, args, { cwd: root, stripEscapes: true })`. Não-zero exit → `{ok:false, message: stderr}`. `runGh` análogo (gh ausente → message clara).
`suggestCommit`: `git diff --cached` (texto); se vazio → "(nada staged)"; senão `captureOnce(aiCmd, [...aiArgs-com-{{prompt}}-substituído], {cwd:root})` onde o prompt = instrução + diff (truncado a ~12k linhas). Retorna stdout trim (primeira linha = subject).

### 4.3 IPC (estende ipcRouter) + schemas
Canais (todos resolvem o root via `deps.currentProject()`): `git:status`, `git:diff {file,staged}`, `git:stage {file}`, `git:unstage {file}`, `git:commit {message}`, `git:push`, `git:createPR {title,body}`, `git:suggestCommit`. (suggestCommit usa o profile `claude` de `effectiveEntries` por default, ou um setting; v1: usa `effectiveEntries().claude` se existir, senão o primeiro profile com `discuss`.) Sem projeto → retorna `{isRepo:false}` / erro claro. zod valida os args.

### 4.4 Renderer
- `gitStore` (zustand): `status: GitStatus|null`, `selectedFile`, `diff`, `busy`, ações refresh()/select(file,staged)/stage/unstage/commit/push/createPR/suggest.
- `GitPanel`: cabeçalho (branch + ahead/behind + Refresh). Duas seções: **Staged** e **Mudanças** (cada arquivo: status badge, path, +verde/-vermelho, botão stage/unstage). Clicar arquivo → área de diff (monospace, linhas `+`/`-` coloridas, `@@` em ciano). Caixa de mensagem de commit + botão **Ask AI** (preenche). Botões **Commit** (desabilita sem staged/sem msg), **Push**, **Create PR** (abre mini-form título/corpo). Erros em banner.
- Toggle "Git" na toolbar (ao lado de Queen/Discussões), abre o painel (como os outros modais/rails — painel à direita ou overlay; usar overlay/painel lateral direito).

### 4.5 Diff coloring (sem Shiki)
Render linha-a-linha: prefixo `+` → verde, `-` → vermelho, `@@` → ciano/borda, contexto → cinza. CSS/Tailwind. (Shiki token-highlight fica pro #7.)

## 5. Fluxo

Abrir Git panel → `git:status` → gitStore.status → render. Clicar arquivo → `git:diff` → render colorido. Stage → `git:stage` → refresh. Ask AI → `git:suggestCommit` → preenche caixa. Commit → `git:commit` → refresh. Push → `git:push`. Create PR → form → `git:createPR` → mostra URL (ou erro).

## 6. Tratamento de erros

- git/gh ausente no PATH → `which` falha → message "git/gh não encontrado".
- Não é repo (`isRepo` false) → painel mostra estado vazio amigável + (futuro) botão "git init".
- Sem projeto aberto → "abra um projeto".
- Comando git não-zero → `{ok:false, message: stderr}` → banner no painel (ex.: commit sem nada staged, push sem upstream → mensagem do git).
- createPR sem `gh`/sem remote/sem auth → message do gh (não cria nada).
- suggestCommit sem nada staged → texto curto; CLI de IA ausente/timeout → message; nunca trava (captureOnce tem timeout/abort).
- diff/status de arquivos com espaço/acentos → `-z` (null-terminated) no porcelain; `--` antes de paths nos comandos.

## 7. Testes

- **Unit (node) — parsers**: parsePorcelain (modified/added/deleted/untracked/renamed/conflicted; staged vs unstaged; -z split), parseBranchLine (ahead/behind, sem upstream), parseNumstat (números, binário `-`).
- **Unit — GitService** (captureOnce + which mockados): status combina porcelain+numstat; commit/push montam args certos; não-zero → {ok:false}; createPR monta `gh pr create`.
- **Integration (node, repo git real temporário)**: `git init` + config user + escreve arquivo → `GitService.status` lista untracked; `stage` + `commit` → status limpo + `git log` tem o commit; edita arquivo → diff contém a mudança. (Usa git real — disponível no dev/CI.)
- **Component (Browser Mode)**: GitPanel renderiza branch + arquivos + diff colorido a partir de gitStore mockado; Commit desabilitado sem msg.
- **E2E (Playwright)**: cria projeto git temp com 1 arquivo modificado, abre Git panel, vê o arquivo + branch. (Commit/push real fora do e2e.)

## 8. Arquivos (novos/alterados)

```
+ src/shared/git.ts             GitFile/GitStatus/GitResult/PrResult/FileStatus
+ src/main/git/parse.ts         parsePorcelain/parseBranchLine/parseNumstat (+test)
+ src/main/git/gitService.ts    GitService (+test) (+integration test repo real)
~ src/shared/ipc.ts             git:* channels + GitStatus result
~ src/shared/schemas.ts         git:* arg schemas
~ src/main/ipcRouter.ts         git:* handlers (root = currentProject; suggest usa effectiveEntries)
~ src/main/index.ts             constrói GitService; passa às deps do router
+ src/renderer/store/gitStore.ts
+ src/renderer/ui/GitPanel.tsx
+ src/renderer/ui/GitDiffView.tsx   render do diff colorido
~ src/renderer/App.tsx          botão "Git" + painel
+ e2e/git.spec.ts
```

## Apêndice — decisões/armadilhas

- **Reusar captureOnce (#3)** pra rodar git/gh (one-shot, com timeout/abort/strip). Resolver o binário via `which` (spawn shell:false não aplica PATHEXT → 'git' sem extensão pode dar ENOENT no Windows; usar caminho absoluto).
- **`-z` (null-terminated)** no `git status --porcelain=v1 -b -z` p/ paths com espaço/acento; `--` antes de paths nos comandos.
- **numstat** separado p/ +/- (staged via `--cached`, unstaged via `git diff --numstat`); binário vem como `-`→0.
- **Sem trust gate** no git (ação do usuário, repo do usuário). `suggestCommit` manda o diff pra IA → opt-in do usuário ao clicar.
- **createPR**: `gh pr create` precisa de remote+auth+push; tratar ausência com mensagem (não criar nada). v1 faz `git push` antes? Não automático — usuário dá Push, depois Create PR (gh exige a branch no remote). Mensagem do gh guia.
- **Diff coloring** por linha (sem Shiki) no v1; Shiki token-highlight é #7.
- **suggestCommit** trunca o diff (~12k linhas) p/ caber no limite de prompt da CLI.
