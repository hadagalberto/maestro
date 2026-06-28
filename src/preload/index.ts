import { contextBridge, ipcRenderer } from 'electron'
import { ptyDataChannel, ptyExitChannel, type IpcChannel, type IpcRequest, type IpcEventPayloads } from '@shared/ipc'

const api = {
  invoke<C extends IpcChannel>(channel: C, args: IpcRequest[C]['args']): Promise<IpcRequest[C]['result']> {
    return ipcRenderer.invoke(channel, args) as Promise<IpcRequest[C]['result']>
  },
  onPtyData(id: string, cb: (p: IpcEventPayloads['pty:data']) => void): () => void {
    const ch = ptyDataChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:data']) => cb(p) // strip event
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
  onPtyExit(id: string, cb: (p: IpcEventPayloads['pty:exit']) => void): () => void {
    const ch = ptyExitChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:exit']) => cb(p)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
}

contextBridge.exposeInMainWorld('term', api)
export type TermApi = typeof api
