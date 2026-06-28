# Sub-agent Trees — Design (sub-projeto #5)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA
**Base:** #1 grid + #2 perfis/trust + #3 discussões + #4 Queen (MCP) — no `main`.
**Escopo:** hierarquia de agentes — um agente spawna sub-agentes sob demanda; árvore de hierarquia visível na sidebar; pai lê output do filho e é notificado quando o filho termina; isolado por projeto.

---

## 1. Objetivo

Recriar os "sub-agent trees" do HiveTerm sobre o que já existe (terminais #1 + Queen #4): um agente rodando num terminal pode **spawnar um sub-agente** (outro terminal, filho), formando uma **árvore** pai→filhos. A UI mostra a árvore (indentada, com status). O pai pode **ler o output** do filho (já via `read_terminal`) e **esperar/ser notificado** quando o filho termina.

### Critérios de sucesso

1. Um terminal carrega seu `parentId` (quem o spawnou); terminais raiz não têm pai.
2. Queen tool `spawn_sub_agent({ parentId, profileId|command })` cria um terminal-filho ligado ao pai.
3. `list_agents()` devolve a árvore (raízes → filhos, com status running/exited).
4. `await_agent({ id, timeoutMs })` resolve quando aquele agente termina, devolvendo exitCode + output (best-effort).
5. Quando um filho termina, o **pai recebe uma mensagem** na mailbox (#4) — "agent X exited (code N)".
6. Sidebar mostra os terminais como **árvore** (filhos indentados sob o pai) com dot de status (rodando/terminado) + cor do perfil.
7. Agente sabe seu próprio id via env `MAESTRO_TERMINAL_ID` (injetado no pane) → usa como `parentId` ao spawnar filhos.
8. Isolado: a árvore reflete os terminais da janela/projeto atual.

### Fora de escopo (futuro)

Limites de profundidade/quantidade de sub-agentes (free tier do HiveTerm) — #8; cancelar uma subárvore inteira com um clique (v1: matar nós um a um); re-parent (mover nó); persistir a árvore entre sessões (v1: vive enquanto a janela existe, junto com os panes persistidos do #1 — parentId persiste no pane).

---

## 2. Arquitetura

```
┌─ Main ───────────────────────────────────────────────┐
│  AgentTree (fonte da verdade)                          │
│   nós: {id,name,command,parentId?,status,exitCode?}   │
│   open() no pty:create ; close() no pty:kill          │
│   markExited() no exit do PtyHost → mailbox(to:parent)│
│   tree(): roots[] ; awaitExit(id,timeout)             │
│  Queen tools: spawn_sub_agent / list_agents /         │
│               await_agent  (usam AgentTree+Bridge)    │
└───────────────┬───────────────────────────────────────┘
                │ pty:create{+name,+parentId} / pty:kill / pty:exit
┌───────────────┴───────────────────────────────────────┐
│ Renderer                                               │
│  panes carregam parentId ; env MAESTRO_TERMINAL_ID     │
│  TerminalPane: status exited → gridStore               │
│  Sidebar: árvore (parentId) + status dots              │
└────────────────────────────────────────────────────────┘
```

**Chokepoint:** todo terminal passa por `pty:create` (TerminalPane) e `pty:kill` (removePane). `pty:create` ganha `name?`/`parentId?` → o handler no main registra o nó no AgentTree. Exit do PTY (PtyHostBridge, main) → `AgentTree.markExited`. Sem canal novo de lifecycle — reusa o que existe.

---

## 3. Modelo de dados

```ts
// shared
interface PaneConfig { /* ...#1-#4... */ parentId?: string }   // novo campo
// pty:create args ganham: name?: string; parentId?: string

// main: src/main/queen/agentTree.ts
type AgentStatus = 'running' | 'exited'
interface AgentNode { id: string; name: string; command: string; parentId?: string; status: AgentStatus; exitCode?: number; createdAt: number }
interface AgentTreeNode extends AgentNode { children: AgentTreeNode[] }
```
Renderer: gridStore ganha `exited: Record<string, number>` (id → exitCode) atualizado quando TerminalPane recebe `pty:exit`. Sidebar usa panes(parentId) + exited p/ render.

---

## 4. Unidades e interfaces

### 4.1 `AgentTree` — `src/main/queen/agentTree.ts` (puro, testável)
```ts
class AgentTree {
  constructor(now?: () => number)
  open(n: { id; name; command; parentId? }): void
  close(id: string): void                 // remove nó (e marca filhos órfãos? v1: mantém filhos, parentId vira dangling → viram raiz na viz)
  markExited(id: string, code: number): { parentId?: string } | null   // retorna parentId p/ o caller notificar
  get(id): AgentNode | undefined
  tree(): AgentTreeNode[]                  // raízes (sem parent OU parent inexistente) com children recursivos
  awaitExit(id: string, timeoutMs: number): Promise<{ exitCode: number } | 'timeout' | 'gone'>
}
```
`awaitExit`: se já exited → resolve já; senão registra waiter, resolve no markExited; timeout → 'timeout'; se nó removido → 'gone'. Puro (sem I/O); `now` injetável.

### 4.2 Wiring no main (ipcRouter + PtyHostBridge/index)
- `ipcRouter` `pty:create` handler: após `ptyHost.spawn`, `agentTree.open({ id, name: a.name ?? a.command, command: a.command, parentId: a.parentId })`.
- `pty:kill`: `agentTree.close(a.id)`.
- Exit: o PtyHostBridge recebe `{type:'exit',id,code}` do utilityProcess antes de repassar pro renderer → chama um callback `onExit(id,code)` (novo dep) → main faz `const r = agentTree.markExited(id,code); if (r?.parentId) mailbox.send({ from:'system', to:r.parentId, text:\`agent ${id} exited (code ${code})\` })`.

### 4.3 Queen tools (estende `tools.ts` #4)
| tool | args | faz |
|---|---|---|
| `spawn_sub_agent` | `{ parentId: string, profileId?, command?, name? }` | trust → `bridge.request('terminals.spawn', { profileId, command, name, parentId })` → {id} |
| `list_agents` | — | `agentTree.tree()` |
| `await_agent` | `{ id: string, timeoutMs?: number }` | `agentTree.awaitExit(id, timeoutMs ?? 120000)` → se exited, anexa output via `bridge.request('terminals.read',{id})` |
(QueenToolDeps ganha `agentTree`.)

### 4.4 RendererBridge `terminals.spawn` (estende #4)
Aceita `parentId` no args → renderer cria o pane com `parentId` (que vai no `pty:create`). `read_terminal` já existe.

### 4.5 Renderer
- `gridStore`: `panes` já existem; pane ganha `parentId`. Add `exited: Record<string,number>` + ação `setExited(id,code)`.
- `TerminalPane`: no handler de `pty:exit` (já existe), chamar `useGrid.getState().setExited(pane.id, code)` além de escrever no terminal.
- env: paneFromProfile (App + queenBridge) injeta `MAESTRO_TERMINAL_ID: pane.id` no `pane.env` (junto do `queenEnv()` do #4). Como o id é gerado na hora, injeta no objeto pane após criar o id.
- `queenBridge` `terminals.spawn`: aceita `parentId`, passa pro pane; `terminals.tree` não é necessário (list_agents é no main).
- **Sidebar**: nova render em árvore — agrupa panes por parentId; raízes (sem parentId ou pai ausente) no topo, filhos indentados recursivamente; cada nó: dot de cor + nome + dot de status (verde rodando / cinza-exitcode terminado) + × (kill).

### 4.6 UI
Sidebar vira `AgentTreeView` (substitui a lista plana atual de "TERMINAIS"): mesma função (selecionar/fechar) + indentação por hierarquia + status. Painel separado de árvore na Queen? Não — a sidebar já é o lugar.

---

## 5. Fluxo

**Pai spawna filho:** agente (sabe seu id via `MAESTRO_TERMINAL_ID`) chama Queen `spawn_sub_agent({ parentId: <meu id>, profileId })` → tools.requireTrust → RendererBridge terminals.spawn{parentId} → renderer addPane(parentId) → TerminalPane `pty:create{id,name,command,parentId}` → main `agentTree.open` (liga ao pai). Sidebar mostra o filho indentado sob o pai.

**Filho termina:** PTY exit → PtyHostBridge `onExit(id,code)` → `agentTree.markExited` → mailbox pro pai. Renderer TerminalPane recebe `pty:exit` → `gridStore.setExited` → sidebar mostra status terminado. Pai, ao chamar `read_inbox`/`await_agent`, vê o término.

**await_agent:** agente chama → main awaitExit → resolve no exit (ou timeout) → anexa output (terminals.read) → retorna.

## 6. Tratamento de erros

- Spawn de filho em pasta não confiável → `spawn_sub_agent` retorna isError (trust gate, igual #4).
- `await_agent` em id inexistente → 'gone'; timeout → 'timeout' (não erro fatal).
- Fechar um pai não mata os filhos automaticamente no v1 (evita kill em cascata surpresa); filhos viram raízes na viz (parent dangling). (Kill-em-cascata fica como melhoria.)
- Exit chega pra nó já fechado (race kill+exit) → markExited no-op se ausente.
- Sidebar com ciclo de parentId (não deveria ocorrer — ids únicos, pai criado antes) → guard: detecção de visitados na montagem da árvore evita loop infinito.

## 7. Testes

- **Unit (node) — AgentTree**: open/close/markExited; tree() (raízes+filhos, pai ausente→raiz, sem ciclo infinito); awaitExit (já-exited resolve, exit posterior resolve, timeout, gone); markExited devolve parentId.
- **Unit — Queen tools**: spawn_sub_agent (trust gate; chama bridge com parentId); list_agents (devolve tree); await_agent (resolve + anexa read). (mock deps).
- **Integration (real MCP client)**: list_agents devolve a árvore de um AgentTree pré-populado; await_agent resolve quando markExited é chamado.
- **Component (Browser Mode)**: Sidebar/AgentTreeView renderiza pai com filho indentado + status dot (a partir de gridStore mockado).
- **E2E**: abrir 2 terminais via picker → sidebar lista ambos (árvore plana). (Parent/child real via Queen é coberto na integration; e2e com agente real é manual.)

## 8. Arquivos (novos/alterados)

```
+ src/main/queen/agentTree.ts        AgentTree (+test)
~ src/shared/types.ts                PaneConfig += parentId
~ src/shared/schemas.ts              ptyCreate += name?/parentId?
~ src/shared/ipc.ts                  pty:create args += name?/parentId?; AgentNode/AgentTreeNode types; queen channels
~ src/main/queen/tools.ts            spawn_sub_agent/list_agents/await_agent (+ agentTree dep) (+test)
~ src/main/ipcRouter.ts              pty:create→agentTree.open; pty:kill→close; onExit dep
~ src/main/ptyHostBridge.ts          expõe onExit callback (já recebe exit do utilityProcess)
~ src/main/index.ts                  constrói AgentTree; wire onExit→markExited+mailbox; passa agentTree às tools
~ src/main/queen/queen.integration.test.ts  + list_agents/await_agent
~ src/renderer/store/gridStore.ts    pane.parentId; exited map + setExited
~ src/renderer/term/TerminalPane.tsx pty:exit → setExited
~ src/renderer/queen/queenBridge.ts  terminals.spawn aceita parentId; inject MAESTRO_TERMINAL_ID
~ src/renderer/App.tsx               paneFromProfile: parentId? + MAESTRO_TERMINAL_ID env
+ src/renderer/ui/AgentTreeView.tsx  sidebar em árvore (substitui lista plana)
~ src/renderer/ui/Sidebar.tsx        usa AgentTreeView (ou vira ele)
~ e2e/                               (reuso) sidebar lista terminais
```

## Apêndice — decisões/armadilhas

- **Reusar pty:create/kill** como chokepoint do AgentTree (sem canal de lifecycle novo); `name`/`parentId` viajam no payload (zod refine não necessário — opcionais).
- **Exit no main**: PtyHostBridge já recebe `{type:'exit'}` do utilityProcess; expor `onExit` callback é o ponto certo (main sabe o exit antes do renderer).
- **markExited→mailbox**: notifica o pai reusando a Mailbox do #4 (sem mecanismo novo).
- **MAESTRO_TERMINAL_ID** no env: o agente descobre seu próprio id pra spawnar filhos (junto do MAESTRO_MCP_URL/TOKEN do #4).
- **Trust**: spawn_sub_agent reusa o trust gate do #4 (exec).
- **Sem kill em cascata** no v1 (filhos viram raízes ao fechar o pai) — evita surpresa; melhoria futura.
- **Guard de ciclo** na montagem da árvore (visited set) — defensivo.
- **awaitExit** é puro (waiters em memória + timer); resolve já-exited na hora.
