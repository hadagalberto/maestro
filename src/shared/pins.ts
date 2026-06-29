export interface Pin { id: string; text: string; done: boolean; terminalId?: string; createdAt: number }
export interface PinsData { pins: Pin[]; notes: string }
