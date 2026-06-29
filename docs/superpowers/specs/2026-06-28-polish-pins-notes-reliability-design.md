# Polish: Pins & Notes + Reliability — Design (sub-projeto #8)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA
**Base:** #1–#7 no `main` (clone funcional: grid, perfis/trust, discussões, Queen MCP, sub-agent trees, git, file finder).
**Escopo (#8, núcleo coerente):** **Pins & Notes** por-projeto (checklist + scratchpad) com **ferramentas MCP na Queen**; **auto-restart** de terminais; **cascade-kill** de sub-agentes. Fecha as últimas features de colaboração/confiabilidade do HiveTerm.

> #8 é o "polish" amplo do roadmap. Esta spec entrega o núcleo de maior valor. **Deferido (backlog, fora desta spec):** voz (feature Pro / serviço externo), i18n, tema claro, fontes configuráveis, stream-json token-streaming nas discussões, `captureMode:'pty'`, probe de `--help` por-CLI, system-prompt por-CLI, e os guards de segurança menores remanescentes (trust backstop no pty:create p/ spawns de origem-Queen, mailbox por-sessão). São independentes e podem virar #8b+.

---

## 1. Objetivo

1. **Pins**: itens de checklist por-projeto (texto + done), criados pela UI **ou por agentes via MCP** ("Queen"), persistidos. Marcar done / editar / remover.
2. **Notes**: um scratchpad de texto por-projeto, auto-save, editável na UI e via MCP (get/set/append).
3. **Auto-restart**: perfil pode marcar `autoRestart`; se o processo sai com código ≠ 0, o terminal respawna (com cap + backoff anti-loop).
4. **Cascade-kill**: fechar um terminal-pai fecha seus descendentes (consistência da árvore do #5).

### Critérios de sucesso

1. Painel **Pins & Notes** (toggle na toolbar): lista de pins (checkbox done, editar, remover, adicionar) + textarea de notes com auto-save.
2. Pins/notes **persistem por-projeto** e voltam ao reabrir o projeto.
3. **Queen tools**: `list_pins`/`create_pin`/`update_pin`/`set_pin_done`/`delete_pin` + `get_notes`/`set_notes`/`append_notes` operam no projeto atual; um pin criado por um agente **aparece na UI ao vivo** (push `pins:changed`).
4. Perfil com `autoRestart:true` cujo PTY sai com código ≠ 0 → respawna até `MAX_RESTARTS` (ex. 3); exit 0 ou cap atingido → para (sem loop).
5. Fechar um pai na sidebar/árvore mata pai **e** descendentes (PTYs incluídos).

### Fora de escopo

Ver nota no topo (voz, i18n, temas, fontes, streaming, etc.). Pins ligados a uma linha específica de output com âncora viva (v1: pin guarda o texto + opcional terminalId, sem âncora de scroll). Reordenar pins (v1: ordem de criação).

---

## 2. Arquitetura

```
┌─ Main ───────────────────────────────────────────────┐
│  PinsStore (electron-store 'maestro-pins')             │
│    key = projectRoot -> { pins: Pin[], notes: string } │
│  IPC pins:* / notes:* (root = currentProject)          │
│    mutações → push 'pins:changed' ao renderer          │
│  Queen tools (8) → PinsStore (sem trust gate; só dados)│
└───────────────┬───────────────────────────────────────┘
                │ pins:* / notes:* + push 'pins:changed'
┌───────────────┴───────────────────────────────────────┐
│ Renderer: pinsStore + PinsPanel (checklist + notes)     │
│  gridStore.removePaneTree (cascade-kill)                │
│  TerminalPane: autoRestart em exit≠0 (cap/backoff)      │
└────────────────────────────────────────────────────────┘
```

---

## 3. Modelo de dados

```ts
// shared/pins.ts
interface Pin { id: string; text: string; done: boolean; terminalId?: string; createdAt: number }
interface PinsData { pins: Pin[]; notes: string }
// ProfileEntry/PaneConfig += autoRestart?: boolean
```

---

## 4. Unidades e interfaces

### 4.1 `PinsStore` — `src/main/pins/pinsStore.ts` (electron-store, testável c/ mock)
```ts
class PinsStore {
  constructor()                       // electron-store 'maestro-pins' (ESM-default unwrap como ConfigStore)
  get(root): PinsData                 // default { pins:[], notes:'' }
  listPins(root): Pin[]
  createPin(root, text, terminalId?): Pin
  updatePin(root, id, text): void
  setPinDone(root, id, done): void
  deletePin(root, id): void
  getNotes(root): string
  setNotes(root, notes): void
  appendNotes(root, chunk): void      // notes + '\n' + chunk (ou chunk se vazio)
}
```
Chaveado por `projectRoot` (objeto `Record<string, PinsData>` no store). ids via `crypto.randomUUID`. Cap ~500 pins/projeto.

### 4.2 IPC + schemas
Canais (root = `currentProject`; sem projeto → no-op/defaults): `pins:list`, `pins:create {text, terminalId?}`, `pins:update {id, text}`, `pins:setDone {id, done}`, `pins:delete {id}`, `notes:get`, `notes:set {notes}`, `notes:append {chunk}`. Push: `pins:changed` (sem payload; renderer refetch). zod valida. **Toda mutação** (via IPC ou via Queen tool) emite `pins:changed`.

### 4.3 Queen tools (estende `tools.ts` do #4) — +8 tools
`list_pins`, `create_pin {text}`, `update_pin {id,text}`, `set_pin_done {id,done}`, `delete_pin {id}`, `get_notes`, `set_notes {notes}`, `append_notes {chunk}`. Usam `deps.pins` + `deps.currentProject()`; sem projeto → erro amigável. **Sem trust gate** (só leem/escrevem dados do app, não executam comando). Após mutar, chamam `deps.onPinsChanged()` (emite o push). (Queen agora ~24 tools.)

### 4.4 Reliability (renderer)
- **autoRestart**: `ProfileEntry.autoRestart?` + `PaneConfig.autoRestart?`. `paneFromProfile` (App + queenBridge) copia. `TerminalPane`: no `onPtyExit`, se `pane.autoRestart && code !== 0 && restarts < MAX_RESTARTS(3)` → incrementa um ref de contador, espera backoff (`500 * 2^n` ms), e re-spawna (`pty:create` de novo com o mesmo id/cwd/env). Helper puro `nextRestart(autoRestart, code, count, max)` → `{ restart: boolean; delayMs: number }` (testável). Exit 0 ou cap → para; mostra no terminal a contagem ("reiniciando… N/3").
- **cascade-kill**: `gridStore.removePaneTree(id): string[]` — coleta `id` + todos os descendentes (por `parentId`, transitivo, com guard de visitados), remove todos do estado, retorna os ids removidos. Callers (`AgentTreeView`/`Sidebar` kill button) chamam `removePaneTree(id)` e fazem `pty:kill` em cada id retornado.

### 4.5 Renderer UI
- `pinsStore` (zustand): `pins`, `notes`, `refresh()`, `addPin(text)`, `togglePin(id,done)`, `editPin(id,text)`, `deletePin(id)`, `saveNotes(text)` (debounced). Assina `pins:changed` → refresh.
- **PinsPanel** (toggle "Pins" na toolbar): seção Pins (checkbox done, texto editável inline, ×, input "+ pin") + seção Notes (textarea auto-save debounced ~600ms). Sem projeto → "abra um projeto".

## 5. Fluxo

**Pin via UI:** "+ pin" → `pins:create` → store mutate → push `pins:changed` → pinsStore refresh. **Pin via agente:** Queen `create_pin` → PinsStore + `onPinsChanged` → push → UI atualiza ao vivo. **Notes:** digitar → debounce → `notes:set`. Agente `append_notes` → push → UI mostra. **Abrir projeto:** PinsPanel refresh → `pins:list`/`notes:get` do projeto. **autoRestart:** PTY exit≠0 → TerminalPane decide via `nextRestart` → respawn. **Fechar pai:** kill → `removePaneTree` → mata a subárvore.

## 6. Tratamento de erros

- Sem projeto → pins/notes IPC retornam `[]`/`''`/no-op; painel mostra aviso.
- electron-store 'maestro-pins' corrompido → default `{pins:[],notes:''}` por-projeto.
- autoRestart cap atingido → para de tentar (mensagem no terminal); evita loop infinito de crash.
- cascade-kill com ciclo de parentId (não deveria) → guard de visitados.
- Queen pin/notes sem projeto → tool retorna `{isError:true}` "nenhum projeto aberto".
- `pins:changed` chega sem projeto aberto → refresh é no-op.

## 7. Testes

- **Unit — PinsStore** (electron-store mock, igual ConfigStore): CRUD pins, notes get/set/append, keying por-projeto, cap.
- **Unit — Queen pin/notes tools** (deps mock): create_pin chama store + onPinsChanged; set_notes/get_notes; sem projeto → isError.
- **Unit — nextRestart**: autoRestart off → no; exit 0 → no; count<max & code≠0 → yes c/ backoff crescente; count≥max → no.
- **Unit — gridStore.removePaneTree**: pai→filho→neto remove os 3; irmão não afetado; ciclo não trava.
- **Integration (real MCP client)**: `create_pin` então `list_pins` retorna o pin; `set_notes`/`get_notes` round-trip; tudo via client real (PinsStore mock nas deps).
- **Component (Browser Mode)**: PinsPanel renderiza pins (checkbox) + notes; adicionar pin chama IPC.
- **E2E (Playwright)**: abre projeto, abre Pins panel, adiciona um pin → aparece; (cascade-kill coberto por unit do store).

## 8. Arquivos (novos/alterados)

```
+ src/shared/pins.ts             Pin/PinsData
~ src/shared/types.ts            ProfileEntry/PaneConfig += autoRestart?
~ src/shared/schemas.ts          pins:*/notes:* arg schemas + autoRestart no profileEntrySchema
~ src/shared/ipc.ts              pins:*/notes:* channels + pins:changed event
+ src/main/pins/pinsStore.ts     PinsStore (+test)
~ src/main/queen/tools.ts        8 pin/notes tools (+ pins dep + onPinsChanged) (+test)
~ src/main/ipcRouter.ts          pins:*/notes:* handlers (emit pins:changed)
~ src/main/index.ts              constrói PinsStore; emit pins:changed; passa às deps (router+queen)
~ src/main/queen/server.ts       (deps QueenToolDeps ganham pins/currentProject/onPinsChanged — já tem currentProject)
+ src/renderer/store/pinsStore.ts
+ src/renderer/ui/PinsPanel.tsx
~ src/renderer/App.tsx           botão "Pins" + painel + assina pins:changed
~ src/renderer/store/gridStore.ts  removePaneTree
~ src/renderer/ui/AgentTreeView.tsx kill usa removePaneTree
+ src/renderer/reliability/restart.ts  nextRestart (+test) [puro]
~ src/renderer/term/TerminalPane.tsx   autoRestart no onPtyExit
~ src/shared/presets.ts          (opcional) nenhum preset com autoRestart por default
~ e2e/                           pins.spec.ts
```

## Apêndice — decisões

- **PinsStore** segue o padrão do ConfigStore (electron-store + unwrap ESM-default). Store próprio `maestro-pins` (não polui o config).
- **Queen pin/notes tools sem trust gate** — não executam comando, só mexem em dados; diferente de spawn/write/start_discussion.
- **Push `pins:changed`** unifica mutações de UI e de MCP → a UI reflete pins criados por agentes ao vivo (mesmo padrão dos eventos per-id, mas global — há 1 janela/projeto).
- **autoRestart** com cap (3) + backoff exponencial — evita crash-loop; `nextRestart` puro pra testar a decisão sem o efeito.
- **cascade-kill** via `removePaneTree` no store (puro, retorna ids) + caller mata os PTYs — mantém o AgentTree do #5 consistente (sem nós órfãos).
- Persistência de `autoRestart` no pane: já cabe no `paneConfigSchema` se eu adicionar o campo (igual fiz com parentId no #5) — incluir.
