// Entrypoint do utilityProcess. Comunica com o main via process.parentPort.
import type { ParentPort } from 'electron'
import { PtyManager } from './ptyManager'

// process.parentPort é uma augmentação do Electron sobre NodeJS.Process,
// disponível apenas em filhos utilityProcess. Com types: ["node"] (tsconfig.node.json)
// ela não vem tipada, então declaramos a augmentação mínima aqui.
declare global {
  namespace NodeJS {
    interface Process {
      parentPort: ParentPort
    }
  }
}

type InMsg =
  | { type: 'spawn'; o: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number } }
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string }
  | { type: 'killAll' }

const port: ParentPort = process.parentPort

const mgr = new PtyManager({
  onData: (id, data) => port.postMessage({ type: 'data', id, data }),
  onExit: (id, code, reason) => port.postMessage({ type: 'exit', id, code, reason }),
})

port.on('message', (e) => {
  const m = e.data as InMsg
  switch (m.type) {
    case 'spawn': mgr.spawn(m.o); break
    case 'write': mgr.write(m.id, m.data); break
    case 'resize': mgr.resize(m.id, m.cols, m.rows); break
    case 'kill': mgr.kill(m.id); break
    case 'killAll': mgr.killAll(); break
  }
})
