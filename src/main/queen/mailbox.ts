import type { MailMessage } from '@shared/queen'

export class Mailbox {
  private byRecipient = new Map<string, MailMessage[]>()
  constructor(private ids: () => string = () => crypto.randomUUID(), private now: () => number = () => Date.now(), private cap = 200) {}

  send(m: { from: string; to: string; text: string }): MailMessage {
    const msg: MailMessage = { id: this.ids(), from: m.from, to: m.to, text: m.text, ts: this.now(), read: false }
    const list = this.byRecipient.get(m.to) ?? []
    list.push(msg)
    while (list.length > this.cap) list.shift()
    this.byRecipient.set(m.to, list)
    return msg
  }

  inbox(agent: string, opts: { unreadOnly?: boolean; markRead?: boolean } = {}): MailMessage[] {
    const list = this.byRecipient.get(agent) ?? []
    const out = opts.unreadOnly ? list.filter((m) => !m.read) : [...list]
    if (opts.markRead) for (const m of out) m.read = true
    return out
  }
}
