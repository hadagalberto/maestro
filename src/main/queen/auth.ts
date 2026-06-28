import { randomBytes, timingSafeEqual } from 'node:crypto'

export class QueenAuth {
  constructor(public readonly token: string = randomBytes(24).toString('hex')) {}

  checkToken(header: string | undefined): boolean {
    if (!header || !header.startsWith('Bearer ')) return false
    const provided = Buffer.from(header.slice('Bearer '.length))
    const expected = Buffer.from(this.token)
    if (provided.length !== expected.length) return false
    return timingSafeEqual(provided, expected)
  }

  hostAllowed(host: string | undefined, port: number): boolean {
    if (!host) return false
    return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
  }

  originAllowed(origin: string | undefined): boolean {
    if (!origin) return true // non-browser clients omit Origin
    try {
      const u = new URL(origin)
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
    } catch { return false }
  }
}
