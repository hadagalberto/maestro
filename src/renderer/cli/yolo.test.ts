import { describe, it, expect } from 'vitest'
import { yoloInject } from './yolo'

describe('yoloInject', () => {
  it('off → vazio', () => {
    expect(yoloInject('claude', false)).toEqual({ args: [], env: {} })
    expect(yoloInject('claude', undefined)).toEqual({ args: [], env: {} })
  })
  it('claude → --dangerously-skip-permissions', () => {
    expect(yoloInject('claude', true)).toEqual({ args: ['--dangerously-skip-permissions'], env: {} })
  })
  it('codex → --dangerously-bypass-approvals-and-sandbox', () => {
    expect(yoloInject('codex', true).args).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
  })
  it('gemini → --approval-mode=yolo', () => {
    expect(yoloInject('gemini', true).args).toEqual(['--approval-mode=yolo'])
  })
  it('amp → --dangerously-allow-all', () => {
    expect(yoloInject('amp', true).args).toEqual(['--dangerously-allow-all'])
  })
  it('agy → --yolo', () => {
    expect(yoloInject('agy', true).args).toEqual(['--yolo'])
  })
  it('opencode → env OPENCODE_PERMISSION (sem flag)', () => {
    expect(yoloInject('opencode', true)).toEqual({ args: [], env: { OPENCODE_PERMISSION: '{"*":"allow"}' } })
  })
  it('caminho absoluto + extensão → resolve o kind', () => {
    expect(yoloInject('C:\\bin\\claude.exe', true).args).toEqual(['--dangerously-skip-permissions'])
  })
  it('CLI desconhecido → vazio', () => {
    expect(yoloInject('bash', true)).toEqual({ args: [], env: {} })
  })
})
