#!/usr/bin/env node
'use strict'
// Launcher de dev/source: `npm run build` + `npm link` → comando `maestro` no terminal.
// Usuário final usa o instalador (que põe `maestro` no PATH). Veja o README.
const { spawn } = require('node:child_process')
const path = require('node:path')

// fora do processo Electron, require('electron') devolve o caminho do binário.
const electron = require('electron')
const appDir = path.join(__dirname, '..')

const child = spawn(electron, [appDir, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  detached: true,
  stdio: 'ignore',
})
child.unref()
