#!/usr/bin/env node

import { createServer } from 'net'

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
    server.on('error', () => resolve(false))
  })
}

async function getAvailablePort(preferred, maxAttempts = 100) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = preferred + attempt
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available port found starting from ${preferred}`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    args.push('5173')
  }

  const preferredPorts = args.map(arg => parseInt(arg, 10))
  const allocatedPorts = []

  for (const preferred of preferredPorts) {
    if (isNaN(preferred) || preferred < 1 || preferred > 65535) {
      console.error(`Invalid port: ${preferred}`)
      process.exit(1)
    }

    let port = preferred
    while (allocatedPorts.includes(port) || !(await isPortAvailable(port))) {
      port++
      if (port > 65535) {
        console.error(`No available port found starting from ${preferred}`)
        process.exit(1)
      }
    }
    allocatedPorts.push(port)
  }

  console.log(allocatedPorts.join(' '))
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
