# Orchestration / Discussions — Design (sub-projeto #3)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA
**Base:** #1 (grid) + #2 (perfis + maestro.yml + workspace trust) — no `main`.
**Escopo:** discussões multi-agente — um orquestrador conduz participantes (CLIs de IA) por rodadas, com templates (decisão, brainstorm, review, plan, dev-squad, custom), transcript ao vivo e summary cards. Inclui o system prompt por papel (adiado do #2).

---

## 1. Objetivo

Implementar o recurso central do HiveTerm: criar uma **discussão** onde um **orquestrador** (uma CLI) dirige **≥2 participantes** (outras CLIs) por uma sequência de fases, cada CLI respondendo a um prompt composto do tópico + turnos anteriores; ao fim, o orquestrador sintetiza em **cards** (decisão/ideias/veredito/plano/status). Modo **autônomo** (sem aprovação entre turnos) ou interativo (pausa em fases com gate).

Crucial: cada turno é uma invocação **headless/one-shot** da CLI (`claude -p`, `codex exec`, `gemini -p`…), **não** digitação no terminal interativo do #1/#2 (TUI emite ANSI/spinners não-parseáveis).

### Critérios de sucesso

1. Modal "New discussion": template, tópico, orquestrador (1 perfil), participantes (≥2 perfis), toggle autônomo. (Igual ao screenshot.)
2. Engine roda as 6 templates como **flow data**, compondo prompts do transcript, respeitando `maxRounds`.
3. Cada turno = uma invocação one-shot capturada de forma limpa (stdout, sem ANSI), com **timeout + kill** por turno.
4. Transcript aparece ao vivo (eventos por discussão); summary cards renderizados distintos.
5. Discussões persistem; lista lateral; reabrir mostra transcript+cards.
6. **Trust**: iniciar discussão que usa participante de projeto exige pasta confiável (reusa o gate do #2); o spawn de captura re-checa trust no main.
7. Abortar uma discussão mata os processos-filho (árvore) e encerra limpo.
8. Engine é **puro e testável**: roda determinístico com `MockAdapter`; `captureOnce` testado com comando de shell real.

### Fora de escopo (futuro)

Streaming token-a-token (stream-json varia por CLI — v1 captura texto completo por turno); MCP "Queen" (#4); sub-agent trees (#5); editar/re-rodar um turno; multi-discussão simultânea pesada (suporta 1 ativa + histórico). Auth/probe de `--help` por CLI: v1 usa config `discuss` por-perfil (presets) + erro claro em timeout; probe automático fica pro #8.

---

## 2. Stack adicional

| Item | Escolha | Nota |
|---|---|---|
| Captura one-shot | `node:child_process` `spawn` (pipes) | NÃO node-pty. Separa stdout/stderr; `close` não `exit`; `StringDecoder`; `AbortSignal.any`; tree-kill |
| Strip ANSI | `strip-ansi` | dep direta (defensivo; pipes já vêm limpos em geral) |
| Validação | `zod` (já) | `discussionInput`, `summaryCard`, `discussionEvent` schemas |
| Persistência | `electron-store` (já) | store separado `maestro-discussions` |

---

## 3. Modelo de dados (puro, em `src/shared/discussion/`)

```ts
type TemplateKind = 'decision'|'brainstorm'|'review'|'plan'|'dev-squad'|'custom'

interface Participant { id: string; role: string; profileId: string }  // role: pro/con/defender/attacker/product/eng/builder-N…

type SpeakerSelector =
  | { kind: 'all' } | { kind: 'roles'; roles: string[] }
  | { kind: 'orchestrator' }

interface PromptContext { topic: string; phase: string; round: number; role: string; transcript: Turn[]; priorSynthesis?: string }
type PromptTemplate = (ctx: PromptContext) => { system?: string; prompt: string }   // função tipada (sem placeholder-injection)

interface Phase {
  id: string; label: string
  speakers: SpeakerSelector
  template: PromptTemplate
  mode: 'parallel' | 'sequential'
  repeat?: { until: 'maxRounds' | 'converged'; max: number }
  synthesize?: { template: PromptTemplate; card: CardKind }
  gate?: 'auto' | 'approval'     // approval suspende no modo interativo
}
interface FlowSpec { id: string; kind: TemplateKind; phases: Phase[]; maxRounds: number; windowTurns: number }

interface Turn { id: string; phaseId: string; round: number; participantId: string; role: string; text: string; createdAt: number; isSynthesis: boolean; error?: string }
type CardKind = 'decision'|'ideas'|'verdict'|'plan'|'status'|'note'
interface SummaryCard { kind: CardKind; title: string; body: string; dissents?: string[]; actions?: { owner?: string; task: string }[] }

type DiscussionStatus = 'running'|'done'|'error'|'aborted'|'awaiting-approval'
interface Discussion {
  id: string; topic: string; templateKind: TemplateKind
  orchestratorProfileId: string; participants: Participant[]
  autonomous: boolean; status: DiscussionStatus
  transcript: Turn[]; cards: SummaryCard[]
  createdAt: number; updatedAt: number; projectRoot: string | null
}
```

### 3.1 Eventos (engine → UI, por discussão)
```ts
type DiscussionEvent =
  | { type:'phase-start'; phaseId:string; round:number }
  | { type:'turn-start'; turn: Pick<Turn,'id'|'phaseId'|'participantId'|'role'|'round'> }
  | { type:'turn-delta'; turnId:string; text:string }      // v1: 1 delta = resposta inteira
  | { type:'turn-end'; turn: Turn }
  | { type:'synthesis'; turn: Turn }
  | { type:'card'; card: SummaryCard }
  | { type:'round-boundary'; round:number }
  | { type:'awaiting-approval'; phaseId:string }
  | { type:'status'; status: DiscussionStatus }
  | { type:'error'; message:string; turnId?:string }
interface DiscussionResult { transcript: Turn[]; cards: SummaryCard[]; rounds: number; status: DiscussionStatus }
```

### 3.2 Adapter (única superfície impura)
```ts
type AgentChunk = { type:'delta'; text:string } | { type:'final'; text:string } | { type:'error'; message:string }
interface AgentTurnRequest { participantId:string; profileId:string; system?:string; prompt:string; cwd:string; signal:AbortSignal }
interface AgentAdapter { run(req: AgentTurnRequest): AsyncIterable<AgentChunk> }
```

### 3.3 ProfileEntry estendido — invocação headless por-perfil
```ts
interface DiscussInvoke {
  argsTemplate: string[]   // ex: ['-p', '{{prompt}}'] ; '{{prompt}}' substituído; se ausente e stdin=true, prompt vai por stdin
  stdin?: boolean          // manda prompt por stdin (default false; usado p/ prompts grandes)
  captureMode?: 'pipe'|'pty'  // default 'pipe'
  timeoutMs?: number       // default 120000
}
// ProfileEntry ganha `discuss?: DiscussInvoke`. Presets trazem defaults:
//   claude  -> ['-p','{{prompt}}']
//   codex   -> ['exec','{{prompt}}']
//   gemini  -> ['-p','{{prompt}}']
//   opencode/amp/shell -> ['-p','{{prompt}}'] (fallback; ajustável)
```
Sem `discuss` no perfil → fallback `['-p','{{prompt}}']` modo pipe/texto.

---

## 4. Unidades e interfaces

### 4.1 Engine puro — `src/shared/discussion/engine.ts`
**Faz:** `async function* runDiscussion(input, deps): AsyncGenerator<DiscussionEvent, DiscussionResult>`. **Depende de:** só dos tipos + `deps` injetadas (`{ adapter, now, ids, signal }`).
- Caminha as fases; resolve speakers; compõe prompt via `PromptContext` (transcript **janelado** a `windowTurns` + sempre inclui synthesis anterior); chama `adapter.run`; agrega chunks → `Turn`; emite eventos.
- `parallel`: roda os speakers concorrentes (multiplexa deltas); `sequential`: um após o outro (cada um vê os anteriores).
- `repeat.max`/`maxRounds`: **contador rígido**; `converged` = early-exit opcional se a synthesis contém sentinela `CONVERGED` (nunca o único terminador).
- `synthesize`: prompta o orquestrador a emitir **JSON do card**; valida com zod `summaryCard`; em falha, **1 re-ask**; senão card `note` com texto cru. Prompt instrui a **expor dissenso** (não fabricar consenso).
- `gate:'approval'` && !autonomous → emite `awaiting-approval`, suspende (`const a = yield`); driver resume com `.next({approve})`. Autônomo: auto-resolve.
- `signal` abortado → encerra, status `aborted`.
- Determinístico: toda impureza (spawn/clock/ids) via deps; `MockAdapter` → run byte-determinístico.

### 4.2 Templates — `src/shared/discussion/templates.ts`
**Faz:** `buildFlow(kind, participants): FlowSpec` com os 6 fluxos (data + PromptTemplate functions):
- **decision**: [diverge: pro+con em paralelo] → [rebut: sequencial, cada um vê o outro] × até maxRounds → [orquestrador decide + card `decision`].
- **brainstorm**: [diverge: todos em paralelo, sem cross-talk] → [orquestrador agrupa/sintetiza → card `ideas`].
- **review**: [defender apresenta] → [attacker critica] → [defender responde] loop → [veredito + card `verdict`].
- **plan**: [product] + [eng] paralelo → [orquestrador funde → card `plan` + riscos].
- **dev-squad**: [orquestrador divide em N tarefas] → [builder-1..N paralelo] → [integra + cards `status`].
- **custom**: usa `phases` fornecido pelo usuário (mesmo schema).
- Atribuição de papéis: mapeia participantes selecionados aos papéis do template (decision precisa 2: pro/con; review 2: defender/attacker; plan 2: product/eng; brainstorm/dev-squad: N).

### 4.3 `captureOnce` — `src/main/discussion/captureOnce.ts` (utilityProcess)
**Faz:** spawn one-shot e captura limpa. **Depende de:** `node:child_process`, `node:string_decoder`, `strip-ansi`, `resolveLauncher` (só pra resolver path — **sem** wrapper `cmd /c`; spawna o `.cmd/.exe` direto, `shell:false`).
- `spawn(file,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:!win})`.
- decode por stream com `StringDecoder`; resolve no `close` (stdout drenado); strip-ansi após decode completo.
- `AbortSignal.any([caller, AbortSignal.timeout(timeoutMs)])`; on abort → tree-kill (`taskkill /PID p /T /F` no Win; `process.kill(-pid)` SIGTERM→SIGKILL no posix) + reject tipado (`aborted`|`timeout`).
- `maxBytes` cap → abort+kill (`overflow`). `stdin.end(prompt?)` sempre (senão trava). Flag `exited` evita kill de PID reusado.

### 4.4 `CliAdapter` — `src/main/discussion/cliAdapter.ts` (utilityProcess)
**Faz:** implementa `AgentAdapter` mapeando perfil→`captureOnce`. Resolve `DiscussInvoke` do perfil (ou fallback); substitui `{{prompt}}` nos args (ou stdin se `stdin:true`/prompt grande > ~32KB → temp file referenciado); roda; emite `{type:'final',text:stdout}` (ou `{type:'error'}` em CaptureError). v1: 1 chunk final por turno (sem stream).

### 4.5 `DiscussionRunner` + `DiscussionStore` (main)
- `DiscussionStore` (electron-store `maestro-discussions`): CRUD de `Discussion[]` (cap ~50, MRU). 
- `DiscussionRunner`: dado um `discussionInput`, monta participants→profiles (resolve via ProjectManager/effective profiles), constrói `FlowSpec` (buildFlow), cria `CliAdapter`, roda `runDiscussion`, **persiste** turnos/cards incrementalmente, **empurra** cada evento pro renderer (`discussion:event:<id>`), guarda `AbortController` por discussão. **Trust gate**: antes de iniciar, se algum participante/orquestrador é perfil de **origem projeto**, exige `isTrusted(projectRoot)` (reusa #2) — senão rejeita `TRUST_REQUIRED`.

### 4.6 IPC (estende ipcRouter) + schemas
Canais: `discussion:start` (input → {id}), `discussion:list`, `discussion:get`(id), `discussion:abort`(id), `discussion:approve`(id), `discussion:delete`(id). Push: `discussion:event:<id>`. zod: `discussionInputSchema`, `summaryCardSchema`, `discussionEventSchema`. Sender guard + trust como #2.

### 4.7 Renderer
- `discussionStore` (zustand): discussões (lista), discussão ativa (transcript/cards/status), assina `discussion:event:<id>`.
- **NewDiscussionModal**: grid de 6 templates (ícone+descrição), tópico (textarea), orquestrador (select de perfis efetivos), participantes (multi-select, ≥2), toggle autônomo, botão "Start discussion". Valida ≥2 participantes.
- **DiscussionView**: cabeçalho (tópico/template/status + abortar), turnos agrupados por fase/rodada (avatar/cor por participante, papel, texto; "pensando…" enquanto turn aberto), cards destacados ao fim de synthesis; botão Aprovar quando `awaiting-approval`.
- **DiscussionList** (rail direita): discussões recentes (tópico, template, status, hora); clicar abre na DiscussionView; deletar.
- **Entry**: botão "Discussões" na toolbar (ou aba) abre o modal / alterna o rail.

---

## 5. Fluxo de dados

**Start:** modal → `discussion:start(input)` → Runner valida (≥2, perfis existem, **trust** se projeto) → cria Discussion (status running, persist) → retorna id → renderer abre DiscussionView e assina `discussion:event:<id>` → Runner roda `runDiscussion`, cada evento: persiste + push. **turn-start/end** pintam turnos; **synthesis/card** pintam cards; **status** atualiza. **done/error/aborted** finalizam.

**Turno:** engine compõe prompt (contexto janelado) → `CliAdapter.run` → `captureOnce` spawna a CLI headless no cwd (= projectRoot ou cwd do perfil), captura stdout limpo, retorna texto → Turn.

**Abortar:** `discussion:abort(id)` → AbortController.abort() → captura mata árvore → engine encerra status `aborted` → push.

**Aprovar (interativo):** fase `gate:'approval'` → engine `awaiting-approval` → UI mostra Aprovar → `discussion:approve(id)` → runner `.next({approve:true})`.

## 6. Tratamento de erros

- **CLI trava (auth/login interativo)** → timeout por turno → CaptureError `timeout` → Turn com `error`, engine segue (turno vira nota de erro no transcript; orquestrador ainda sintetiza com o que tem). UI marca o turno como falho.
- **CLI não existe / spawn falha** → CaptureError `spawn` → idem.
- **JSON do card inválido** → 1 re-ask → senão card `note` texto cru.
- **TRUST_REQUIRED** no start → modal mostra "confie no projeto primeiro" (reusa banner #2).
- **Abort** → mata árvore (taskkill /T /F), sem processos órfãos.
- **Overflow** (CLI floda stdout) → kill + erro no turno.
- App fecha / quit → aborta discussões ativas (AbortControllers) no `before-quit`.
- Engine nunca lança pro processo: erros viram eventos `error`/Turn.error.

## 7. Testes

- **Unit (node) — engine** (prioridade): com `MockAdapter` scriptado, roda cada template (decision/brainstorm/review/plan/dev-squad/custom) e assere a sequência de eventos, ordem de speakers (parallel/sequential), respeito a `maxRounds`, early-exit `converged`, synthesize→card (JSON válido, JSON inválido→re-ask→note), gate `approval` (suspende e resume), abort (status aborted). Determinístico (deps injetadas: now/ids fixos).
- **Unit (node) — captureOnce**: comando de shell real (`node -e "process.stdout.write('ok')"` ou powershell echo) → captura 'ok'; comando que dorme + timeout curto → CaptureError timeout + processo morto; abort via signal; strip-ansi; stdin.
- **Unit — summaryCard schema** + **buildFlow** (papéis atribuídos certo, nº de participantes por template).
- **Component (Browser Mode)**: NewDiscussionModal (valida ≥2 participantes; lista perfis efetivos); DiscussionView pinta turnos a partir de eventos mockados no store.
- **E2E (Playwright)**: cria perfis "fake" cujo `discuss.argsTemplate` é um echo de shell determinístico (sem CLI de IA real) → inicia discussão decision → vê ≥2 turnos + 1 card → status done. (userData isolado; trust concedido.)

## 8. Arquivos (novos/alterados)

```
+ src/shared/discussion/types.ts        modelo puro (FlowSpec/Turn/Event/Adapter/Discussion)
+ src/shared/discussion/engine.ts       runDiscussion (async generator) + helpers de prompt/janela
+ src/shared/discussion/templates.ts    buildFlow + 6 templates + PromptTemplates
+ src/shared/discussion/mockAdapter.ts  MockAdapter (testes) — em shared p/ reuso no e2e? não; fica em test util
~ src/shared/types.ts                   ProfileEntry += discuss?: DiscussInvoke
~ src/shared/schemas.ts                 discussInvoke no profileEntrySchema; discussionInput/summaryCard/discussionEvent
~ src/shared/ipc.ts                     canais discussion:* + evento discussion:event:<id> + DiscussionState
~ src/shared/presets.ts                 discuss defaults nos presets
+ src/main/discussion/captureOnce.ts    spawn pipes + abort/timeout/tree-kill
+ src/main/discussion/cliAdapter.ts     AgentAdapter via captureOnce
+ src/main/discussion/discussionStore.ts electron-store maestro-discussions
+ src/main/discussion/discussionRunner.ts roda engine, persiste, push eventos, trust gate, abort
~ src/main/ipcRouter.ts                  handlers discussion:* + push
~ src/main/index.ts                      wire runner; abort em before-quit
~ src/preload/index.ts                   on(discussion:event:<id>) (genérico por-id, como pty:data)
+ src/renderer/store/discussionStore.ts  zustand
+ src/renderer/ui/NewDiscussionModal.tsx
+ src/renderer/ui/DiscussionView.tsx
+ src/renderer/ui/DiscussionList.tsx
+ src/renderer/ui/DiscussionsButton.tsx  entry na toolbar
~ src/renderer/App.tsx                    monta o rail/modal de discussões
+ e2e/fixtures/discuss/maestro.yml        perfis fake (echo) p/ e2e
~ e2e/                                    discussion.spec.ts
```

## Apêndice — armadilhas confirmadas (research + verificação)

- **One-shot, não TUI**: cada turno = invocação headless nova (`-p`/`exec`), nunca digitar no terminal interativo.
- **Captura**: `spawn` pipes (não pty); resolver no `close` (não `exit`, senão perde cauda); `StringDecoder` (não concat de Buffer → corrompe multibyte); strip-ansi após decode completo; `stdin.end()` sempre; **não** passar por `cmd /c` (quebra exit code/tree-kill — spawna o `.cmd/.exe` direto).
- **Abort/timeout**: `AbortSignal.any([caller, AbortSignal.timeout(ms)])`; tree-kill Windows = `taskkill /PID p /T /F` (child.kill só mata o filho direto); posix = `detached` + `process.kill(-pid)`; flag `exited` contra reuso de PID; cap de bytes.
- **CLIs**: flags non-interactive reais (June 2026) — claude `-p` (+`--output-format`,`--permission-mode dontAsk`,`--bare`), gemini `-p` (NÃO existe `--non-interactive`; `--yolo`/`--approval-mode`), codex `exec` (`--full-auto` DEPRECATED → `--sandbox workspace-write`; final no stdout, progresso no stderr), copilot `-p --allow-all-tools`, aider `--message --yes-always --no-stream`, cursor `cursor-agent -p --force`. **Flags driftam** → guardar em `discuss` por-perfil, não hardcode no core.
- **Auth = hang principal**: cada CLI pode cair em login interativo → timeout+kill por turno obrigatório; erro claro. JSON output varia por CLI → v1 usa texto.
- **Orquestração**: templates = dados (FlowSpec); core = generator puro com deps injetadas (testável via MockAdapter); `maxRounds` rígido; synthesis estruturada (zod) com dissenso obrigatório, não fabricar consenso; autonomia = flag do runner (gate), não template.
- **Trust**: discussão com perfil de projeto exige pasta confiável; gate re-checado no main antes do spawn de captura.
