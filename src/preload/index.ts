import { contextBridge, ipcRenderer } from 'electron'
import { ptyDataChannel, ptyExitChannel, type IpcChannel, type IpcRequest, type IpcEventPayloads, type AppEvent, type AppEventPayloads } from '@shared/ipc'

const api = {
  invoke<C extends IpcChannel>(channel: C, args: IpcRequest[C]['args']): Promise<IpcRequest[C]['result']> {
    return ipcRenderer.invoke(channel, args) as Promise<IpcRequest[C]['result']>
  },
  onPtyData(id: string, cb: (p: IpcEventPayloads['pty:data']) => void): () => void {
    const ch = ptyDataChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:data']) => cb(p)
    ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h)
  },
  onPtyExit(id: string, cb: (p: IpcEventPayloads['pty:exit']) => void): () => void {
    const ch = ptyExitChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:exit']) => cb(p)
    ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h)
  },
  on<E extends AppEvent>(event: E, cb: (p: AppEventPayloads[E]) => void): () => void {
    const h = (_e: Electron.IpcRendererEvent, p: AppEventPayloads[E]) => cb(p)
    ipcRenderer.on(event, h); return () => ipcRenderer.removeListener(event, h)
  },
  onDiscussionEvent(id: string, cb: (ev: import('@shared/discussion/types').DiscussionEvent) => void): () => void {
    const ch = `discussion:event:${id}`
    const h = (_e: Electron.IpcRendererEvent, ev: import('@shared/discussion/types').DiscussionEvent) => cb(ev)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
  onQueenRequest(cb: (req: import('@shared/queen').QueenRequest) => void): () => void {
    const h = (_e: Electron.IpcRendererEvent, req: import('@shared/queen').QueenRequest) => cb(req)
    ipcRenderer.on('queen:req', h)
    return () => ipcRenderer.removeListener('queen:req', h)
  },
  queenRespond(res: import('@shared/queen').QueenResponse): void { ipcRenderer.send('queen:res', res) },
  onPinsChanged(cb: () => void): () => void {
    const h = () => cb()
    ipcRenderer.on('pins:changed', h)
    return () => ipcRenderer.removeListener('pins:changed', h)
  },
}

contextBridge.exposeInMainWorld('term', api)
export type TermApi = typeof api
