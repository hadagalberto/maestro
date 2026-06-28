# Terminal Grid Foundation — Design (sub-projeto #1)

**Data:** 2026-06-27
**Projeto:** HiveTerm clone — app desktop para orquestrar múltiplas CLIs de IA em um grid de terminais
**Escopo deste doc:** sub-projeto #1 (fundação: grid de terminais multi-pane rodando qualquer CLI). Os sub-projetos #2–#8 estão no Apêndice A (roadmap), fora do escopo de implementação agora.

---

## 1. Objetivo

Construir a base do app: uma janela Electron que roda **N terminais reais** (PTY) em um **grid redimensionável** com presets **2 / 3 / 2×2**, cada pane rodando uma CLI arbitrária (Claude Code, Codex, shell, etc.). Layouts e terminais abertos persistem entre sessões. Tudo com baseline de segurança Electron 2026 (sandbox + contextIsolation).

Esta fundação é o alicerce de tudo que vem depois (orquestração, MCP "Queen", git, file finder). Os limites de cada unidade são desenhados para que os sub-projetos seguintes se conectem por interfaces claras, sem reescrita.

### Critérios de sucesso (v1 deste sub-projeto)

1. Abrir 1–4 terminais, cada um rodando uma CLI/shell configurável (comando + cwd + env + nome).
2. Alternar entre layouts 2 / 3 / 2×2; arrastar os splitters; tamanhos persistem por layout.
3. Digitar em um pane chega ao PTY; output do PTY aparece no pane (incl. TUIs como vim/htop e CLIs de IA com TUI).
4. Redimensionar a janela/pane reflui o terminal (cols/rows propagados ao PTY).
5. Fechar um pane mata o PTY (e netos); fechar o app mata todos os PTYs.
6. Scrollback restaurado ao reabrir (best-effort).
7. Spawn de `claude`/`codex` funciona no Windows (resolução de `.cmd`).
8. Renderer roda com `sandbox:true`; nenhum acesso Node cru no renderer.

### Fora de escopo (vai pros sub-projetos seguintes)

Orquestração/discussões, MCP server, sub-agent trees, git panel, file finder, pins/notes, voz, i18n completa, temas customizáveis além de claro/escuro, `hive.yml` config-as-code (vem no #2 — aqui a config de terminal mora só no store local).

---

## 2. Stack (decisões globais — valem para todo o projeto)

> Versões verificadas via npm em 2026-06-27 e passadas por verificação adversarial.

| Camada | Escolha | Versão | Nota |
|---|---|---|---|
| Runtime | `electron` | `^42.5.0` | Define a ABI que o node-pty precisa casar |
| Build/dev | `electron-vite` | `^5.0.0` | Bundla main+preload+renderer, HMR. **Fixa Vite 7** (peer range exclui Vite 8) |
| Bundler renderer | `vite` | `^7.3.6` | Fixo em 7 enquanto electron-vite 6 estiver beta |
| React plugin | `@vitejs/plugin-react` | `5.2.0` | **Travado em 5.2.0** (6.x exige Vite 8) |
| Packager | `electron-builder` | `^26.15.6` | NSIS/dmg/AppImage/deb, assina, rebuild ABI, unpack `.node` |
| Rebuild nativo | `@electron/rebuild` | `^4.0.5` | Relinka node-pty pra ABI do Electron (dev/CI) |
| UI | `react` + `react-dom` | `^19.2` | + TypeScript estrito |
| Estilo | `tailwindcss` + `@tailwindcss/vite` | `^4.3.1` | Tailwind v4, plugin Vite (sem postcss.config) |
| PTY | `node-pty` | `^1.1.0` | Oficial Microsoft (mantido por engs Anthropic). ConPTY no Win |
| Resolução de binário | `which` | `^7.0.0` | Acha o `.cmd` real (exige Node ≥22.22) |
| Render terminal | `@xterm/xterm` | `^6.0.0` | Escopo novo. Canvas removido |
| Addons xterm | `@xterm/addon-fit` `-webgl` `-unicode11` `-web-links` `-search` `-serialize` | `0.11 / 0.19 / 0.9 / 0.12 / 0.16 / 0.14` | Conjunto v6 |
| Grid | `react-resizable-panels` | `^4.11.2` | **API v4** (Group/Panel/Separator) |
| Estado (renderer) | `zustand` | `^5.0` | |
| Persistência (main) | `electron-store` | `^11.0.2` | Fonte da verdade em disco |
| Validação IPC | `zod` | `^4.x` | Valida payloads na fronteira de confiança |
| Testes | `vitest` `@vitest/browser-playwright` `vitest-browser-react` `@playwright/test` | `4.1 / 4.1 / 2.2 / 1.61` | Unit + Browser Mode + E2E `_electron` |

**Trade-offs assumidos:**
- **Vite 7 (não 8):** electron-vite 5 não suporta Vite 8. Revisitar quando electron-vite 6 sair stable.
- **node-pty 1.1.0 sem prebuild Linux:** no Linux o node-pty compila do fonte (precisa `python3 + make + g++`). Aceito (alvo primário é Windows/mac). Reavaliar 1.2.0 stable.

---

## 3. Arquitetura — modelo de processos

```
┌─ Main process (Node) ─────────────────────────────────────┐
│  • App lifecycle, janela, menu, CSP                        │
│  • IpcRouter  (ipcMain.handle tipado, valida sender)      │
│  • ConfigStore (electron-store): layouts, panes, settings │
│  • spawn do UtilityProcess de PTY                          │
└───────────┬───────────────────────────────────┬───────────┘
            │ MessagePort/IPC                     │ contextBridge IPC
┌───────────┴────────────────┐      ┌─────────────┴─────────────────────┐
│ UtilityProcess: PtyHost     │      │ Renderer (React, sandbox:true)     │
│  • node-pty vive AQUI        │      │  • Sidebar (projeto → terminais)   │
│  • PtyManager: spawn/write/   │     │  • Grid (react-resizable-panels)   │
│    resize/kill/onData/onExit  │     │  • TerminalPane (xterm por PTY)    │
│  • resolução .cmd no Windows  │     │  • zustand store                   │
│  • streama bytes p/ renderer  │      │  • window.term (API do preload)    │
└──────────────────────────────┘     └────────────────────────────────────┘
```

**Por que `utilityProcess` e não rodar node-pty no main:** isola código nativo/CPU-intensivo (e potenciais crashes de spawn) do processo principal; mantém o main responsivo. O PtyHost faz o trabalho nativo; o main só roteia e persiste. (Se a complexidade do MessagePort pesar no v1, fallback aceitável é rodar o PtyManager no próprio main — a interface `PtyManager` não muda; só muda onde ele vive. Decisão default: **utilityProcess**.)

**Baseline de segurança (explícito em `webPreferences`, mesmo sendo default no E42):**
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. CSP estrita via `onHeadersReceived` (dev http) **e** meta tag (file://). Nunca expor `ipcRenderer` cru pelo contextBridge — só métodos semânticos. Validar `event.senderFrame.url` **síncrono** contra allowlist exata (URL do index empacotado / `http://localhost:5173` em dev).

---

## 4. Unidades e interfaces

Cada unidade tem propósito único, interface explícita e é testável isolada.

### 4.1 `PtyManager` (PtyHost / utilityProcess)
**Faz:** ciclo de vida dos PTYs. **Depende de:** `node-pty`, `which`.
```ts
interface PtyManager {
  spawn(opts: { id: string; command: string; args?: string[]; cwd: string;
                env?: Record<string,string>; cols: number; rows: number }): void;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
}
// eventos (push p/ renderer via canal por-terminal): pty:data:<id>, pty:exit:<id>
```
**Regras críticas (do research/verificação):**
- **Windows spawn de CLI:** resolver via `which.sync(bin,{all:true})`, **filtrar para `.cmd`** (nunca o shim sem extensão → erro 193), e lançar `cmd.exe /d /s /c <arquivo.cmd> ...args`. Em mac/linux, lançar via login shell (`$SHELL -lc`) p/ pegar PATH/nvm.
- **env:** sempre espalhar `process.env` (manter `SystemRoot`/`Path`, senão PowerShell dá `8009001d`).
- `useConptyDll: true` no Windows (ConPTY moderno embutido). `handleFlowControl: true`.
- `kill()` no Windows ignora signal; ConPTY derruba o pseudo-console — **testar** que o filho (claude/codex) e netos morrem.
- Streamar bytes crus; não pré-decodificar UTF-8 por chunk (corrompe multibyte).

### 4.2 `IpcRouter` + contrato `shared/ipc.ts` (main + preload)
**Faz:** fronteira de confiança tipada. **Depende de:** `electron`, `zod`.
- Um módulo `shared/ipc.ts` com nomes de canal + tipos de payload/retorno (fonte única, importado por main e preload).
- `handle(channel, fn)` valida sender **antes** de qualquer await; valida payload com `zod`.
- Canais request/response: `pty:create`, `pty:write`, `pty:resize`, `pty:kill`, `layout:load`, `layout:save`, `config:get`, `config:set`.
- Canais push por-terminal: `pty:data:<id>`, `pty:exit:<id>` (isola streams entre terminais).

### 4.3 `preload.ts` → `window.term`
**Faz:** expõe API semântica mínima. CJS sob sandbox. Strip do `event` nos callbacks. Sem `ipcRenderer` cru.

### 4.4 `ConfigStore` (main, electron-store)
**Faz:** fonte da verdade em disco. **Depende de:** `electron-store`.
- Guarda: `activeLayout`, panes por layout (`{id, command, cwd, env, name}`), tamanhos por `groupId`, settings (fonte, scrollback, tema).
- **Schema versionado** (`schemaVersion` + migrações), escrita atômica (electron-store já faz).
- Renderer nunca toca o disco; só via IPC `config:*` / `layout:*`.

### 4.5 `gridStore` (renderer, zustand)
**Faz:** estado de UI. `activeLayout: 'two'|'three'|'quad'`, `panes` keyed by `terminalId`, `activePaneId`. Ações add/remove/setLayout/setActive. Hidrata do `config:get` no boot; persiste mudanças via `config:set` (debounced).

### 4.6 `Grid` + layouts nomeados (renderer)
**Faz:** o split visual. **Depende de:** `react-resizable-panels` v4.
- **Modelo remount-por-layout:** `<TwoPane/>`, `<ThreePane/>`, `<QuadPane/>`, cada um subtree próprio com `groupId` estável (`grid-two/three/quad`) → tamanhos persistem independente por layout.
- `useDefaultLayout({ groupId, storage })` com `storage` custom apontando pro `config:*` (não localStorage).
- Persistir em `onLayoutChanged` (settled), não `onLayoutChange` (durante drag).
- **Terminais ficam FORA da árvore de panes**, renderizados com key estável por `terminalId` → trocar layout reparenteia a mesma instância xterm, não mata o PTY.

### 4.7 `TerminalPane` (renderer)
**Faz:** monta xterm e liga ao PTY. **Depende de:** `@xterm/*`, `window.term`.
- No mount: `term.open()`, carrega addons (fit, unicode11 [setar `activeVersion='11'` **antes** de escrever], search, serialize, web-links → `shell.openExternal`).
- Restaura scrollback (serialize) **antes** de `open()`, em terminal do mesmo tamanho.
- Assina `pty:data:<id>` → `term.write`; `term.onData` → `pty:write`.
- `ResizeObserver` (debounced) → `fit.fit()` → `pty:resize(cols,rows)`.
- **Pool de WebGL:** addon WebGL só nos panes visíveis/focados; `dispose()` nos ocultos (cai pro DOM renderer); `onContextLoss` → dispose + recria no próximo frame visível. Respeita orçamento de ~8 contextos.
- Persiste scrollback (`serialize.serialize()`) no unmount/close.

---

## 5. Fluxo de dados

**Criar terminal:** UI "+ terminal" → `gridStore.add` → `TerminalPane` monta → `window.term.invoke('pty:create', {command,cwd,cols,rows})` → IpcRouter (valida) → PtyHost `spawn` → retorna `id`. Pane assina `pty:data:<id>`.

**Tecla digitada:** `xterm.onData` → `window.term.invoke('pty:write',{id,data})` → IpcRouter → PtyHost `write`.

**Output do PTY:** `pty.onData` → PtyHost → push `pty:data:<id>` → preload (strip event) → `TerminalPane` → `xterm.write(bytes)`.

**Resize:** `ResizeObserver`/`onResize` do Panel → `fit.fit()` → `pty:resize`.

**Trocar layout:** `setLayout` → `Grid` remonta subtree → mesmos `TerminalPane` (key estável) reparenteados, PTYs vivos → `fit()` dispara reflow.

**Fechar pane:** `gridStore.remove` → `pty:kill` → unmount. **Fechar app:** `before-quit` → kill de todos os PTYs.

---

## 6. Tratamento de erros

- **Falha de spawn** (binário não existe / erro 193 / ENOENT): PtyHost emite `pty:exit:<id>` com código + motivo; pane mostra banner "falhou ao iniciar `<cmd>`" + últimas linhas + botão "tentar de novo".
- **PTY morre (exit != 0):** pane mostra exit code + últimas ~30 linhas; opção restart manual (auto-restart é polish, #8).
- **Perda de contexto WebGL:** `onContextLoss` → fallback DOM transparente; recria quando visível.
- **Crash do PtyHost (utilityProcess):** main detecta `exit`, marca todos os panes como mortos, oferece respawn do host; não derruba o app.
- **IPC sender não confiável / payload inválido (zod):** handler rejeita e loga; nada executa.
- **electron-store corrompido / schema antigo:** migração; se falhar, backup do arquivo + reset pro default com aviso.
- **node-pty ABI mismatch (dev):** documentado no README + `postinstall` roda `@electron/rebuild`; mensagem clara se faltar toolchain (Linux).

---

## 7. Estratégia de testes

Pirâmide em 4 camadas (do research/verificação):

1. **Unit (Node):** `PtyManager` com `vi.mock('node-pty')` — assere args de spawn (incl. resolução `.cmd` no Windows), forward de write/resize, onData→sink, kill. Determinístico, sem binário nativo, roda em todo OS.
2. **Component (Vitest Browser Mode + Playwright provider):** `TerminalPane` em **Chromium real** (xterm precisa de DOM mensurável + canvas/WebGL; jsdom dá 0×0 e passa falso-positivo). Mocka `window.term`, não node-pty. Testa: output escrito no buffer, drag de splitter recomputa cols/rows.
3. **Contract/IPC:** valida o contrato `shared/ipc.ts` (zod schemas + tipos), sender validation rejeitando origem não-allowlisted.
4. **E2E (`@playwright/test` `_electron`):** lança o app buildado (`out/main`), abre 2×2, assere 4 terminais vivos, digita `echo hi`, vê `hi`. Stub de dialogs nativos via `app.evaluate`.

**CI:** matriz `ubuntu/windows/macos`; `npx @electron/rebuild`; unit+component em todo push; E2E com `xvfb-run` no Linux, `trace: on-first-retry`, upload de traces em falha.

---

## 8. Estrutura de pastas (proposta)

```
/                       electron.vite.config.ts, electron-builder.yml, package.json, tsconfig*
/src/main/             index.ts, ipcRouter.ts, configStore.ts, ptyHost.spawn.ts
/src/main/pty/         ptyManager.ts (roda no utilityProcess)
/src/preload/          index.ts
/src/shared/           ipc.ts (contrato), schemas.ts (zod), types.ts
/src/renderer/         main.tsx, App.tsx, index.css (@import "tailwindcss")
/src/renderer/store/   gridStore.ts
/src/renderer/grid/    Grid.tsx, TwoPane.tsx, ThreePane.tsx, QuadPane.tsx, layoutStorage.ts
/src/renderer/term/    TerminalPane.tsx, webglPool.ts, xtermTheme.ts
/src/renderer/ui/      Sidebar.tsx, Toolbar.tsx
/e2e/                  *.spec.ts
```

---

## Apêndice A — Roadmap (milestone: clone completo)

Cada item = próprio ciclo spec→plan→build. Ordem de dependência:

1. **Terminal grid foundation** ← este doc
2. **CLI profiles + config-as-code** (`hive.yml`, defs de agente, auto-start, env, cwd)
3. **Orquestração/discussões** (orquestrador dirige participantes, templates, summary cards)
4. **MCP server "Queen"** (spawn/kill/io/message tools p/ agentes)
5. **Sub-agent trees** (hierarquia + viz na sidebar)
6. **Git panel** (diff, commit, push, PR)
7. **File finder + search** (fuzzy, find-in-files, Shiki highlight)
8. **Polish** (pins/notes, voz, i18n, temas, fontes, notificações, auto-restart)

---

## Apêndice B — Armadilhas confirmadas a respeitar

- node-pty: bare name no Windows → ENOENT; shim sem extensão → erro 193; preferir `.cmd` via `cmd.exe /c`; manter `SystemRoot`/`Path` no env; `kill()` ignora signal no Win.
- node-pty 1.1.0: sem prebuild Linux (compila do fonte); winpty ainda vem como fallback legado (remoção é no 1.2.0).
- xterm v6: sem canvas renderer; respeitar limite de contextos WebGL (pool); `unicode11.activeVersion='11'` antes de escrever; serialize é experimental (best-effort).
- react-resizable-panels v4: API é Group/Panel/Separator/orientation/useDefaultLayout (não a antiga); não usar localStorage no Electron; não morfar 1 grupo entre 2/3/4 panes (remount por layout); terminais com key estável fora da árvore.
- Electron: `sandbox:true` impede node-pty no renderer (fica no main/utilityProcess); nunca expor `ipcRenderer` cru; validar sender síncrono; preload em CJS; CSP via meta cobre só file://, precisa onHeadersReceived em dev.
- empacotamento: `asarUnpack` o diretório inteiro `node_modules/node-pty/build/Release/*` (binários nativos + ConPTY dll).
- Tailwind v4: usar `@tailwindcss/vite` + `@import "tailwindcss"`, sem postcss.
