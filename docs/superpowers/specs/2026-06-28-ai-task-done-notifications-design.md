# Notificações de "tarefa da IA concluída" — Design

**Data:** 2026-06-28
**Projeto:** Maestro
**Base:** #1–#8 + ícone/menu no `main`.

## Problema

Usuário quer ser avisado quando **a IA termina uma tarefa**, não quando o terminal/processo encerra. Um CLI de IA interativo (claude/codex TUI) **não sai** ao concluir uma tarefa — fica vivo, ocioso, esperando o próximo prompt. Logo "tarefa terminou" ≠ exit do PTY; precisa ser detectado de outra forma.

## Decisões (aprovadas)

- **Detecção: sinal + inatividade** (ambos).
- **Escopo: painéis + discussões + sub-agente**, com **toggle na toolbar**.
- **Anti-ruído: background-only** (só notifica com a janela do Maestro sem foco) + setting global `taskNotify` (default ligado).

## Mecanismos

1. **Sinal explícito (preciso)** — no stream do xterm de cada painel:
   - **BEL** (`term.onBell`).
   - **OSC 9** (`ESC ] 9 ; texto BEL`, estilo iTerm/Windows Terminal) — ignora `9;4…` (progress).
   - **OSC 777** (`ESC ] 777 ; notify ; … BEL`).
   - Qualquer um → dispara "tarefa concluída" na hora.
2. **Inatividade (heurística)** — máquina de estados pura `taskSignal.ts`:
   - `armOnInput()` quando o usuário envia input ao terminal (`term.onData`).
   - `noteOutput()` em cada chunk de output.
   - timer de `IDLE_MS` (4000) reiniciado a cada output; ao expirar → `onIdle()`: dispara **só se** armado **e** houve output desde o arme; depois **desarma**. Mata o falso-positivo do banner inicial (sem input → sem notificação) e do idle puro.
   - No exit do PTY: limpa o timer e reseta o arme (não notifica "tarefa" no fechamento).
3. **Discussões/orquestração (preciso)** — no `emit` do runner: evento `{type:'status', status:'done'}` → notifica com o tópico.
4. **Sub-agente (preciso)** — `ptyHost.onExit` de nó com `parentId` (spawn via Queen) → "agente concluiu (code N)". Painéis interativos normais (sem parentId) **não** notificam no exit.

## Fluxo / arquitetura

- **Renderer** detecta no painel → `window.term.invoke('app:notify', {title, body})`.
- **Main** decide exibir: `maybeNotify` checa `settings.taskNotify` + `win.isFocused()` (skip se focado) → `new Notification`; clique → `win.show()/focus()`.
- Discussão/sub-agente chamam `maybeNotify` direto no main (já têm o evento preciso lá).
- **Toggle**: botão na toolbar lê/escreve `settings.taskNotify` via `config:get`/`config:set` (schema de settings ganha o campo; main lê em tempo de notificação).

## Arquivos

```
~ src/shared/types.ts           AppConfig.settings += taskNotify + DEFAULT
~ src/shared/schemas.ts         settingsPatch += taskNotify; appNotifyArgs + canal
~ src/shared/ipc.ts             IpcRequest 'app:notify'
~ src/main/ipcRouter.ts         dep notifyTask + handle('app:notify')
~ src/main/index.ts             maybeNotify; notify discussão(done) + sub-agente(exit)
+ src/renderer/notify/taskSignal.ts  máquina pura (+test)
~ src/renderer/term/TerminalPane.tsx  arme/idle + bell + OSC 9/777
~ src/renderer/App.tsx          estado + botão toggle (🔔/🔕)
```

## Testes

- **Unit — taskSignal**: idle sem arme → no; arme sem output → no; arme+output+idle → fire e reseta; após fire → no; output sem arme → ignora.
- typecheck + unit + component + build verdes; smoke manual (app rodando, background, tarefa idle → notifica).

## Fora de escopo (v1)

Foco no painel ao clicar a notificação (só foca a janela); limiar/`always` configuráveis na UI (default fixo background-only/4s); parsing do título/corpo do OSC 777.
