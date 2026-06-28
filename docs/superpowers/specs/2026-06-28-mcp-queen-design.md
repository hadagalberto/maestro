# MCP Server "Queen" — Design (sub-projeto #4)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA
**Base:** #1 grid + #2 perfis/maestro.yml/trust + #3 discussões — no `main`.
**Escopo:** servidor MCP embarcado ("Queen") que expõe ferramentas pros agentes (CLIs rodando nos terminais do Maestro) **dirigirem o app**: gerenciar terminais, iniciar/ler discussões, trocar mensagens entre agentes, notificar, consultar perfis/projeto.

---

## 1. Objetivo

Recriar a "Queen" do HiveTerm: um servidor MCP dentro do Maestro que CLIs externas (claude, codex…) conectam para controlar o app por ferramentas. Um agente pode listar/abrir/fechar terminais, escrever/ler em terminais, iniciar uma discussão, mandar mensagem pra outro agente, e notificar — tudo via MCP, sem UI.

### Critérios de sucesso

1. Servidor MCP **Streamable HTTP** sobe em `127.0.0.1:<porta efêmera>` quando o app inicia; porta+token publicados em `queen.json` (userData) e injetados como env nos panes que o Maestro spawna.
2. Um cliente MCP (o do próprio SDK) conecta com **token bearer**, faz `initialize`, lista as tools e chama-as com sucesso.
3. **Segurança**: requests sem token válido (timing-safe) são rejeitados; Host/Origin de browser rejeitados; bind só loopback; teardown no quit.
4. Tools que mudam estado (spawn_terminal, write_terminal, start_discussion) **honram o workspace-trust do #2** — bloqueiam em pasta não confiável.
5. Tools de terminal operam o grid real (via ponte main↔renderer): spawnar aparece como pane; kill remove; read devolve output; write injeta input.
6. Tools main-owned (discussões, profiles, mailbox, notify, project_info) funcionam sem renderer.
7. Painel "Queen" na UI mostra status (rodando, porta) + URL/token copiáveis + como conectar a CLI.

### Fora de escopo (futuro)

OAuth (só token por-launch); pins/notes tools (#8); sub-agent tools (#5); auto-config do `.mcp.json` por-CLI (v1 mostra instruções/copia); transporte stdio/named-pipe alternativo; multi-window scoping (v1 = a janela atual).

---

## 2. Stack adicional

| Item | Escolha | Nota |
|---|---|---|
| MCP | `@modelcontextprotocol/sdk` | `^1.29.0`. **Dual ESM/CJS** → externalize NORMAL (NÃO excluir; ao contrário do strip-ansi). `McpServer` + `StreamableHTTPServerTransport` |
| Transporte | Streamable HTTP | stateful (`sessionIdGenerator: randomUUID`), sessão por header `mcp-session-id`. Não stdio, não SSE legado |
| HTTP | `node:http` cru | bind `127.0.0.1:0`; handler próprio (POST=init/messages, GET=SSE, DELETE=teardown) → `transport.handleRequest(req,res,body)` |
| Validação | `zod` (já) | inputSchema = **raw zod shape** (`{k: z.string()}`), não `z.object()` |
| Auth | token por-launch | `randomUUID`/`randomBytes`; `crypto.timingSafeEqual`; header `Authorization: Bearer` em todo request |

Versão do SDK verificada via tarball + teste runtime (require CJS funciona no main; `initialize` retorna 200 + `mcp-session-id` + protocol `2025-06-18`).

---

## 3. Arquitetura

```
┌─ Main process ───────────────────────────────────────────────┐
│  QueenServer (node:http @127.0.0.1:0)                          │
│   • authGuard (bearer timing-safe) + host/origin allowlist    │
│   • por sessão: McpServer + StreamableHTTPServerTransport      │
│   • registerTool(...) → QueenTools handlers                   │
│  QueenTools  → chamam:                                         │
│   • DiscussionRunner/Store (#3)  — discussões (main)          │
│   • ProjectManager (#2)          — profiles/project (main)    │
│   • Mailbox (novo)               — mensagens entre agentes    │
│   • Notification (electron)      — notify                     │
│   • RendererBridge               — terminais (→ renderer)     │
│   • isTrusted (#2)               — gate de tools de estado    │
│  queen.json (userData): { url, token }                        │
└───────────────┬───────────────────────────────────────────────┘
                │ webContents.send('queen:req') / ipcMain.on('queen:res')
┌───────────────┴───────────────────────────────────────────────┐
│ Renderer: queenBridge — handlers de terminal sobre gridStore   │
│  list/spawn/kill panes; read (serialize xterm); write (pty)    │
└────────────────────────────────────────────────────────────────┘
        ▲ HTTP (Streamable) com Bearer token
   CLIs externas (claude/codex/…) conectam em http://127.0.0.1:<porta>/mcp
```

**Onde roda:** main process (não renderer, não utilityProcess — precisa orquestrar managers do main). Teardown em `before-quit`.

---

## 4. Unidades e interfaces

### 4.1 `QueenAuth` — `src/main/queen/auth.ts`
**Faz:** token + validação. `newToken(): string` (randomBytes hex); `checkToken(header?: string, token: string): boolean` (extrai `Bearer x`, `timingSafeEqual` com mesmo tamanho — sem vazar timing/length); `hostAllowed(hostHeader?, port): boolean` (∈ `127.0.0.1:port`/`localhost:port`); `originAllowed(origin?): boolean` (ausente OK = cliente não-browser; presente só se loopback). Puro, testável.

### 4.2 `Mailbox` — `src/main/queen/mailbox.ts`
**Faz:** caixa de mensagens entre agentes (em memória; cap por destinatário). `send({from,to,text}): Message`; `inbox(agent, {unreadOnly?}): Message[]`; `markRead(ids)`. `Message = {id, from, to, text, ts, read}`. Puro, testável.

### 4.3 `RendererBridge` — `src/main/queen/rendererBridge.ts`
**Faz:** request/reply main→renderer. `request(op: TerminalOp, args, timeoutMs=8000): Promise<unknown>` — `webContents.send('queen:req',{reqId,op,args})`; guarda resolver; `ipcMain.on('queen:res')` resolve/rejeita; timeout rejeita. Ops: `terminals.list`, `terminals.spawn`, `terminals.kill`, `terminals.read`, `terminals.write`. Se não há janela → rejeita "no window".

### 4.4 `QueenTools` — `src/main/queen/tools.ts`
**Faz:** registra todas as tools no `McpServer`. **Depende de:** DiscussionRunner/Store, ProjectManager, Mailbox, RendererBridge, isTrusted, Notification. Cada tool: `registerTool(name, {title,description,inputSchema}, handler)`; handler retorna `{content:[{type:'text',text}], isError?}`. **Gate de trust** (helper `requireTrust()`): para spawn_terminal/write_terminal/start_discussion, se há projeto aberto e não confiável → `{isError:true, content:[{type:'text',text:'workspace not trusted'}]}`.

Tools (v1):
| nome | args (raw zod) | faz |
|---|---|---|
| `list_terminals` | — | bridge terminals.list → [{id,name,command}] |
| `spawn_terminal` | `{ profileId?: string, command?: string, name?: string }` | trust → bridge terminals.spawn → {id} |
| `kill_terminal` | `{ id: string }` | bridge terminals.kill |
| `read_terminal` | `{ id: string, maxChars?: number }` | bridge terminals.read → texto (scrollback) |
| `write_terminal` | `{ id: string, data: string }` | trust → bridge terminals.write |
| `list_profiles` | — | ProjectManager.effectiveEntries → [{id,name,command}] |
| `start_discussion` | `{ topic, templateKind, orchestratorProfileId, participantProfileIds[], autonomous? }` | trust → DiscussionRunner.start → {id} |
| `get_discussion` | `{ id }` | DiscussionStore.get → transcript+cards (resumido) |
| `list_discussions` | — | DiscussionStore.list → [{id,topic,status}] |
| `send_message` | `{ from, to, text }` | Mailbox.send |
| `read_inbox` | `{ agent, unreadOnly? }` | Mailbox.inbox |
| `notify` | `{ title, body }` | Electron Notification |
| `project_info` | — | {currentProject, trusted} |

### 4.5 `QueenServer` — `src/main/queen/server.ts`
**Faz:** http server + sessões + dispatch. `start(deps): Promise<{url,token,port,close}>`. Handler: checa path `/mcp`; **authGuard** (token + host/origin) — 401 se falhar; lê body (cap ~4MB); roteia POST-initialize→nova sessão (cria McpServer via QueenTools + transport, `onclose`→delete sessão), POST/GET/DELETE existentes→transport da sessão. `close()` fecha todas as sessões + http. Escreve `queen.json` (url+token) em userData.

### 4.6 Integração (main `index.ts`)
Constrói QueenServer com deps (discussion, discussionStore, project, mailbox, rendererBridge(→win), isTrusted, notify); `start()` no `whenReady`; injeta `MAESTRO_MCP_URL`/`MAESTRO_MCP_TOKEN` no env dos panes spawnados (via PtyManager spawn env — passar no `pty:create`? Não: o env vai no spawn; o Maestro adiciona ao env do PTY). `before-quit` → `queen.close()`.

### 4.7 Renderer `queenBridge.ts`
**Faz:** assina `queen:req` (via preload `onQueenRequest`), executa no gridStore + registry de terminais, responde (`queenRespond`). Registry: `TerminalPane` registra no mount `{ serialize: () => string }` keyed by id; `terminals.read` usa. `terminals.write` → `window.term.invoke('pty:write',{id,data})`. `terminals.spawn` → resolve profileId via projectStore.profiles → `addPane(paneFromProfile)`. `terminals.kill` → removePane + pty:kill.

### 4.8 UI `QueenPanel.tsx`
**Faz:** indicador de status (rodando/porta) + URL/token (copiar) + snippet "como conectar" (claude/codex). Botão na toolbar abre. Hidrata via `queen:info` IPC.

### 4.9 preload
Adiciona: `onQueenRequest(cb)`, `queenRespond(reqId, payload)`, e `invoke('queen:info')` (já cabe no genérico invoke se adicionar canal).

---

## 5. Fluxo

**Boot:** whenReady → QueenServer.start → http listen 127.0.0.1:0 → lê porta → gera token → escreve queen.json → pronto. UI mostra no QueenPanel.

**Agente conecta:** CLI (configurada com a URL+token) → POST initialize (Bearer) → authGuard OK → nova sessão (McpServer+transport) → tools disponíveis.

**Tool de terminal:** agente chama `spawn_terminal{profileId}` → QueenTools.requireTrust → RendererBridge.request('terminals.spawn',{profileId}) → renderer addPane → responde {id} → tool retorna {id}.

**Tool main-owned:** `start_discussion` → requireTrust → DiscussionRunner.start → {id}. `send_message`/`read_inbox` → Mailbox. `notify` → Notification.

**Quit:** before-quit → queen.close() (fecha sessões + http).

## 6. Tratamento de erros

- Token inválido/ausente → 401 (sem corpo sensível). Host/Origin não-loopback → 403.
- Tool em pasta não confiável → `{isError:true}` com mensagem (não lança).
- RendererBridge sem janela / timeout → tool retorna isError "renderer unavailable".
- Body > cap → 413.
- initialize sem sessão é o único que cria; request não-init sem sessão válida → 400 (transport stateful).
- Sessão fecha → remove do mapa (sem leak); quit → fecha tudo.
- queen.json com permissão restrita (best-effort `mode 0600` no posix).

## 7. Testes

- **Unit (node)**: `QueenAuth` (timing-safe match, mismatch, host/origin allow/deny), `Mailbox` (send/inbox/unread/markRead/cap), `RendererBridge` (request/reply via fake webContents + ipcMain mock, timeout), `QueenTools` trust gate (mock deps: untrusted project → isError; trusted → calls dep).
- **Integration (node, real MCP client)**: sobe `QueenServer` num http efêmero; usa `@modelcontextprotocol/sdk/client` + StreamableHTTPClientTransport com o token → `initialize`, `listTools` (vê as 13), chama `notify`/`send_message`+`read_inbox`/`list_discussions`/`project_info` (main-owned, sem renderer) e assere resultados; chama sem token → erro. (Terminal tools usam bridge → fora desta integração; cobertos por unit do bridge + QueenTools.)
- **Component (Browser Mode)**: QueenPanel mostra url/porta a partir de `queen:info` mockado.
- **E2E (Playwright)**: app sobe → QueenPanel mostra "rodando" + porta. (Conexão real de CLI é manual/fora do e2e.)

## 8. Arquivos (novos/alterados)

```
+ src/main/queen/auth.ts            token + host/origin (+ test)
+ src/main/queen/mailbox.ts         mensagens entre agentes (+ test)
+ src/main/queen/rendererBridge.ts  request/reply main->renderer (+ test)
+ src/main/queen/tools.ts           registerTool de todas as tools (+ test do trust gate)
+ src/main/queen/server.ts          http + sessões + dispatch + queen.json
+ src/main/queen/queen.integration.test.ts  client MCP real ponta-a-ponta
~ src/shared/ipc.ts                 canais queen:info, queen:req/res (event), QueenInfo
~ src/shared/schemas.ts             schemas das tools (raw shapes reaproveitáveis) + queen channels
~ src/main/ipcRouter.ts             handler queen:info; registra ipcMain.on('queen:res')→bridge
~ src/main/index.ts                 constrói/sobe QueenServer; env nos panes; close no quit
~ src/preload/index.ts             onQueenRequest/queenRespond
+ src/renderer/queen/queenBridge.ts handlers de terminal (gridStore + registry)
+ src/renderer/queen/terminalRegistry.ts  id -> serialize() (TerminalPane registra)
~ src/renderer/term/TerminalPane.tsx  registra/desregistra no terminalRegistry
+ src/renderer/ui/QueenPanel.tsx
~ src/renderer/App.tsx              monta queenBridge + botão/painel Queen
~ package.json                     @modelcontextprotocol/sdk
+ e2e/                              queen.spec.ts (painel mostra rodando)
```

## Apêndice — armadilhas confirmadas (research + verificação)

- SDK `@modelcontextprotocol/sdk@^1.29.0`: **dual CJS → externalize normal** (NÃO excluir; require funciona no main CJS — provado). v2 (`main`/alpha) muda nomes (`NodeStreamableHTTPServerTransport`, inputSchema `z.object`) — não usar.
- API real: `StreamableHTTPServerTransport` (não Node…); `registerTool(name,{title,description,inputSchema},handler)`; inputSchema = raw shape (z.object também aceito no 1.29, mas raw é idiomático); handler `{content:[{type:'text',text}],isError?}`; `transport.handleRequest(req,res,bodyParseado)` (body lido 1×, passado como 3º arg).
- Sessões: criar só no POST initialize (sem session-id); não-init sem sessão → 400; `onclose`→deletar do mapa (senão leak); fechar tudo no quit.
- **Segurança**: 127.0.0.1 **não é auth** em desktop → token bearer obrigatório, `timingSafeEqual`, em **todo** request (spec MCP: "MUST NOT use sessions for authentication"). Allowlist Host/Origin hand-rolled (opções `allowedHosts`/`enableDnsRebindingProtection` do transport estão **deprecated** no 1.29 → middleware/handler próprio). bind 127.0.0.1 (nunca 0.0.0.0). cap de body. CVE-2025-66414 (rebind off por padrão, fixado 1.24) — estamos no 1.29.
- **Trust**: tools de estado (spawn/write/start_discussion) reusam `isTrusted` do #2 — MCP não pode furar o gate.
- CLIs (config, pro QueenPanel): claude `claude mcp add --transport http <url> --header "Authorization: Bearer <t>"`; **gemini usa `httpUrl` (não `url`)** no settings; cursor cap ~40 tools (temos 13). Token+URL em `queen.json` (userData, 0600) + env `MAESTRO_MCP_URL`/`MAESTRO_MCP_TOKEN` nos panes.
