# CLI Profiles + maestro.yml — Design (sub-projeto #2)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA num grid de terminais
**Base:** sub-projeto #1 (terminal grid foundation) — entregue no `main`.
**Escopo:** perfis de CLI (presets + globais + projeto via `maestro.yml`), conceito de projeto (abrir pasta), seletor de perfil no "+ terminal", auto-start, reload ao vivo, e **workspace trust** (segurança).

---

## 1. Objetivo

Hoje "+ terminal" abre só o shell padrão em `cwd: '.'`. Este sub-projeto introduz **perfis de agente** e o conceito de **projeto**:

- **Abrir uma pasta** (projeto). A raiz vira o cwd base e a fonte do `maestro.yml`.
- **Perfis** vêm de 3 camadas mescladas: **presets** embutidos (claude, codex, opencode, amp, shell) + **globais** do usuário (app config) + **projeto** (`maestro.yml`, versionado no repo — "config as code"). Projeto sobrescreve global, que sobrescreve preset (por `id`).
- **"+ terminal"** abre um **seletor de perfil**; lançar um perfil cria um pane com seu command/args/cwd/env/cor.
- **autoStart**: perfis marcados sobem sozinhos ao abrir o projeto (se confiável).
- **Reload ao vivo**: editar `maestro.yml` atualiza a lista de perfis.
- **Workspace trust**: abrir um repo com `maestro.yml` que define comandos é um vetor de RCE (supply-chain). Projeto novo abre em **Modo Restrito**; perfis de origem-projeto e autoStart só rodam após o usuário **confiar** na pasta.

### Critérios de sucesso

1. Abrir pasta via diálogo; projetos recentes persistem; trocar de projeto.
2. `maestro.yml` parseado e validado; erros de sintaxe (com linha:col) e de schema (com path) exibidos sem travar.
3. Lista efetiva de perfis = merge presets+global+projeto, com badge de origem e cor.
4. "+ terminal" → seletor → spawn com o perfil (command/args/cwd/env aplicados; cwd relativo à raiz do projeto).
5. Perfis globais: criar/editar/remover num painel simples (persistem por-usuário).
6. autoStart sobe perfis de projeto ao abrir — **apenas se a pasta for confiável**.
7. Editar `maestro.yml` reflete na UI em ≤1s.
8. **Trust**: pasta não-confiável → banner Modo Restrito; rodar perfil de projeto pede confiança; o gate é no **main** (não no renderer); o repo nunca se auto-confia.

### Fora de escopo (próximos sub-projetos)

Orquestração/discussões (#3), system prompt por perfil (#3), MCP "Queen" (#4), git/file-finder (#6/#7). Editor visual do `maestro.yml` (edição é à mão; só damos scaffold + erros). Ícones por perfil (só cor por ora).

---

## 2. Stack adicional

| Item | Escolha | Versão | Nota |
|---|---|---|---|
| Parse YAML | `yaml` (eemeli) | `^2.9.0` | `parseDocument` coleta todos os erros c/ linha:col; `stringify` p/ scaffold. **Só no main.** Zero deps. (não usar `js-yaml` 5.x nem `yaml@next` 3.x) |
| Validação shape | `zod` | já no projeto | Valida o objeto pós-YAML; `issue.path` → path lógico |
| Watch arquivo | `node:fs` `watchFile` | builtin | **Sem chokidar** — 4.x tem bug de detecção no Windows 11+Electron (#1361); 5.x é ESM-only (quebra no utilityProcess CJS). `watchFile` poll de 1 arquivo é robusto cross-platform |

---

## 3. Modelo de dados

### 3.1 Profile (efetivo, no renderer)
```ts
interface Profile {
  id: string                 // chave de merge (estável)
  name: string               // label; default = id
  command: string
  args: string[]
  cwd?: string               // relativo à raiz do projeto; default = raiz
  env?: Record<string,string>
  autoStart: boolean
  color?: string             // hex p/ dot no tab/sidebar
  disabled?: boolean         // projeto pode desligar um preset/global herdado
  source: 'preset' | 'global' | 'project'
}
```

### 3.2 Presets embutidos (`PROFILE_PRESETS`, constante no shared)
`claude` (#d97757), `codex` (#10a37f), `opencode` (#f59e0b), `amp` (#8b5cf6), `shell` (powershell.exe no Win / bash fora, #6e7681). `autoStart:false`. São templates; o usuário usa direto ou sobrescreve por id.

### 3.3 `maestro.yml` (schema validado por zod)
```yaml
version: 1
defaultProfile: claude         # opcional
profiles:
  claude:                      # id = chave
    command: claude            # name default = "claude"
    args: []
  api:
    name: API dev server
    command: npm
    args: [run, dev]
    autoStart: true
    color: "#3fb950"
  shell:                       # sobrescreve o preset "shell"
    disabled: true
```
zod: `maestroConfigSchema = { version: literal(1), defaultProfile?: string, profiles: record(string, profileEntry) }` onde `profileEntry = { name?, command(min1), args?: string[] default [], cwd?, env?: record(string,string), autoStart?: bool default false, color?, disabled?: bool }`.

### 3.4 AppConfig (electron-store) — estendido, `schemaVersion: 2`
```ts
interface AppConfig {
  schemaVersion: 2
  // ...#1: activeLayout, panes, layoutSizes, settings
  globalProfiles: Record<string, ProfileEntry>   // perfis do usuário (mesma forma do maestro.yml)
  recentProjects: string[]                        // paths absolutos, MRU, máx ~10
  currentProject: string | null                   // path da pasta aberta
  trust: { trustedFolders: string[]; deniedFolders: string[] }
}
```
`migrate()` de v1→v2: adiciona os campos novos com defaults; mantém os de #1.

### 3.5 PaneConfig — estendido (compatível com #1)
Adiciona `color?: string` e `profileId?: string` (origem do pane). `origin: 'user'|'project'` e `projectRoot?` viajam no spawn (não precisam persistir no pane; ao reidratar, panes restaurados spawnam como `user` no projeto atual — não disparam o gate; ver §6).

---

## 4. Unidades e interfaces

### 4.1 `maestroConfig.ts` (main)
**Faz:** ler/parsear/validar/scaffold do `maestro.yml`. **Depende de:** `yaml`, `zod`.
```ts
type ConfigProblem =
  | { kind:'syntax'; line:number; col:number; message:string }
  | { kind:'schema'; path:string; message:string }
type LoadResult = { ok:true; profiles: ProfileEntryMap; defaultProfile?:string }
               | { ok:false; problems: ConfigProblem[] }
loadMaestroConfig(file:string): Promise<LoadResult | { ok:'absent' }>
scaffoldMaestroConfig(file:string): Promise<void>   // stringify(starter), nunca concat
```
Regras (do research): `parseDocument(text,{prettyErrors:true,uniqueKeys:true,strict:true})`; se `doc.errors` → problems 'syntax' (com `linePos`); senão `toJS()` (tratar `null` = "vazio"); zod → problems 'schema' (`issue.path.join('.')`). Nunca `parse()` (throw/1-erro). Arquivo ausente → `{ok:'absent'}`.

### 4.2 `maestroWatcher.ts` (main)
**Faz:** observar 1 arquivo via `fs.watchFile(file,{interval:1000}, cb)`; ao mudar mtime → recarrega → callback. `stop()` faz `fs.unwatchFile`. Trocar de projeto para o watcher antigo e cria novo. (Sem chokidar.)

### 4.3 `trust.ts` (main) — **núcleo de segurança, puro e testável**
**Faz:** resolução de confiança por path. **Depende de:** `node:path`, `node:fs`.
```ts
function canonical(p:string): string   // fs.realpathSync.native se existir; senão path.resolve; normaliza separador final; toLowerCase no win32
function isUnder(child:string, root:string): boolean   // via path.relative (NÃO startsWith): rel==='' || (!rel.startsWith('..') && !isAbsolute(rel))
function isTrusted(target:string, trust:TrustConfig): boolean
// denied tem precedência; trusted herda p/ subpastas
```
Hardening (verificação adversarial): **realpath canônico nos dois lados** (symlink/junction/`\\?\`/8.3 burlam comparação léxica); case-fold explícito no win32; containment por segmentos (não prefixo de string).

### 4.4 `projectManager.ts` (main)
**Faz:** abrir pasta (`dialog.showOpenDialog({properties:['openDirectory']})`), manter `currentProject`, `recentProjects` (MRU via ConfigStore), e calcular a **lista efetiva de perfis** = merge(presets, globalProfiles, projectProfiles) por id, precedência projeto>global>preset, aplicando `disabled`, tagueando `source`. Dispara reload via watcher.

### 4.5 `ConfigStore` (main) — estendido
Novos getters/setters: `globalProfiles`, `recentProjects` (push MRU, dedup, cap 10), `currentProject`, `trust` (grant/revoke mutam listas). `migrate()` v1→v2.

### 4.6 `ipcRouter` (main) — estendido + **trust gate**
Novos canais: `project:open` (diálogo→abre), `project:openPath`, `project:current`, `project:recent`, `profiles:list` (efetiva + problems do maestro.yml), `profiles:setGlobal` (CRUD global), `maestro:scaffold`, `trust:get`, `trust:grant`, `trust:revoke`. Push: `profiles:changed`, `project:changed`, `trust:changed`.

**Gate no `pty:create`** (chokepoint único): payload ganha `origin:'user'|'project'` e `projectRoot?` (zod `refine`: `projectRoot` obrigatório quando `origin==='project'`). Handler: se `origin==='project'` e `!isTrusted(canonical(projectRoot))` → lança erro tipado `TRUST_REQUIRED` (com projectRoot) que o renderer vira prompt de confiança. `resolveLauncher`/spawn só rodam após o gate. (Spawns `user` — panes que o usuário criou à mão — passam direto.)

### 4.7 Renderer
- **store**: `currentProject`, `profiles: Profile[]`, `maestroProblems`, `trusted: boolean`. Hidrata via `project:current`+`profiles:list`; assina `profiles:changed`/`project:changed`/`trust:changed`.
- **ProjectBar** (topo-esq): nome do projeto + botão abrir/trocar (dropdown de recentes).
- **ProfilePicker**: "+ terminal" → popover com perfis efetivos agrupados por origem (dot de cor) + "novo shell". Selecionar → `addPane` com command/args/cwd/env/color/profileId; spawn com `origin` ('project' se source==='project', senão 'user') e `projectRoot`=currentProject.
- **RestrictedBanner**: quando há projeto aberto, com perfis de projeto, e `!trusted` → banner "Esta pasta define perfis que executam programas. Confiar?" [Confiar][Confiar na pasta-pai…][Gerenciar]. Botões "rodar" de perfis de projeto ficam travados; ao clicar, pede confiança.
- **autoStart**: ao abrir/projeto ficar confiável, spawna perfis `autoStart && source==='project'` uma vez.
- **GlobalProfiles panel**: form simples add/editar/remover perfis globais (`profiles:setGlobal`).
- **MaestroProblems**: lista de erros (sintaxe linha:col / schema path) num painel/toast; botão "criar maestro.yml" (`maestro:scaffold`) quando ausente.
- Pane mostra dot de cor (sidebar/tab).

---

## 5. Fluxo de dados

**Abrir projeto:** ProjectBar→`project:open`→diálogo→ConfigStore.currentProject+recent→watcher liga em `<root>/maestro.yml`→load→merge→push `project:changed`+`profiles:changed`. Renderer hidrata; se `!trusted` e há perfis de projeto → RestrictedBanner; autoStart só se trusted.

**Editar maestro.yml:** watcher detecta→reload→merge→`profiles:changed`→store atualiza (problems se inválido).

**Novo terminal de perfil:** ProfilePicker→`addPane`(color/profileId)→TerminalPane monta→`pty:create`{origin,projectRoot,...}→IpcRouter valida sender+zod+**trust gate**→ptyHost.spawn. Se `TRUST_REQUIRED`→renderer mostra prompt; ao **Confiar**→`trust:grant`→`trust:changed`→re-tenta spawn.

**Confiar:** prompt/banner→`trust:grant(path|parent)`→ConfigStore.trust→push `trust:changed`→store `trusted=true`→banner some, botões liberam, autoStart dispara.

## 6. Tratamento de erros

- `maestro.yml` sintaxe/schema inválido → problems exibidos; **mantém perfis válidos anteriores** (não derruba a lista); ausência → `{absent}` + botão scaffold.
- `TRUST_REQUIRED` → prompt de confiança (não é erro fatal).
- Diálogo cancelado → no-op.
- Path de projeto sumiu (recente inválido) → marca indisponível, remove do MRU sob confirmação.
- Reidratação de panes (#1): panes salvos spawnam como `origin:'user'` no projeto atual → **não** disparam gate (são do usuário, não do repo). Perfis de projeto autoStart é que passam pelo gate.
- watcher: se o arquivo some/renomeia (atomic save), `watchFile` continua observando o path; reload trata ausência.

## 7. Testes

- **Unit (node)** — **`trust.ts` é prioridade (segurança)**: containment (`C:/a/b` ⊂ `C:/a`, `C:/abc` ⊄ `C:/a`), denied precede trusted, herança de pai, case-fold win32, realpath (mock fs.realpathSync.native), path inexistente. `maestroConfig`: yaml válido/ inválido (syntax c/ linha, schema c/ path), vazio, ausente, duplicate-key. merge: precedência projeto>global>preset, `disabled`, `source` tag. `ConfigStore` migrate v1→v2 + recent MRU cap/dedup.
- **Component (Browser Mode)**: ProfilePicker lista por origem; RestrictedBanner aparece quando `!trusted`; clicar perfil de projeto não-confiável dispara prompt.
- **E2E (Playwright)**: abrir pasta-fixture com `maestro.yml`, ver Modo Restrito, **Confiar**, autoStart sobe, terminal de perfil ecoa. (userData isolado; sob `navigator.webdriver` o renderer já usa DOM renderer.)

## 8. Arquivos (novos/alterados)

```
+ src/main/maestroConfig.ts      parse/validate/scaffold (yaml+zod)
+ src/main/maestroWatcher.ts     fs.watchFile de 1 arquivo
+ src/main/projectManager.ts     abrir/recent/current + merge efetivo
+ src/main/trust.ts              isTrusted/canonical/isUnder (+ testes)
+ src/shared/presets.ts          PROFILE_PRESETS
~ src/shared/types.ts            Profile, ProfileEntry, TrustConfig, AppConfig v2, PaneConfig +color/profileId
~ src/shared/ipc.ts              novos canais + origin/projectRoot
~ src/shared/schemas.ts          maestroConfigSchema, ptyCreate +origin/projectRoot (refine), profileEntry
~ src/main/configStore.ts        globalProfiles/recentProjects/currentProject/trust + migrate v2
~ src/main/ipcRouter.ts          novos handlers + trust gate no pty:create
~ src/main/index.ts             wire projectManager/watcher/trust
+ src/renderer/store/projectStore.ts   currentProject/profiles/trusted/problems
+ src/renderer/ui/ProjectBar.tsx
+ src/renderer/ui/ProfilePicker.tsx
+ src/renderer/ui/RestrictedBanner.tsx
+ src/renderer/ui/GlobalProfiles.tsx
+ src/renderer/ui/MaestroProblems.tsx
~ src/renderer/App.tsx           wire projeto/perfis/trust/autoStart; "+ terminal" usa picker
~ src/renderer/ui/Toolbar.tsx    abre o picker
~ src/renderer/ui/Sidebar.tsx    dot de cor por pane
+ e2e/fixtures/sample/maestro.yml   fixture
~ e2e/                          teste de projeto+trust+perfil
```

## Apêndice — armadilhas confirmadas (research + verificação)

- `yaml`: usar `parseDocument` (não `parse`); passar `prettyErrors/uniqueKeys/strict` explícitos; `toJS()` de arquivo vazio = `null`; só no main, nunca expor texto cru pro renderer.
- **chokidar evitado**: 4.x não detecta criação no Windows 11+Electron (#1361); 5.x ESM-only quebra no utilityProcess CJS. Usar `fs.watchFile`.
- **trust**: gate no MAIN (renderer é não-confiável); repo nunca se auto-confia (trust só no electron-store user-global); realpath canônico nos dois lados (symlink/junction/`\\?\`/8.3); containment por `path.relative` (não `startsWith`); `origin/projectRoot` obrigatórios juntos (zod refine, não comentário); lembrar que `resolveLauncher` embrulha em `cmd.exe /c` → args de projeto são vetor de injeção de metachar do cmd → gatear o spawn inteiro (command+args+cwd+env), não só o command.
- merge por `id`; `disabled` desliga herdado; taguear `source` p/ badge.
