import path from 'node:path'

function getFreePort({ net }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (port) resolve(port)
        else reject(new Error('Unable to allocate a local browser-harness CDP port.'))
      })
    })
  })
}

async function waitForCdpWebSocket({ port, fetchWithTimeout, timeoutMs = 15_000 }) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/json/version`, {}, 1000)
      if (response.ok) {
        const payload = await response.json()
        if (payload.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Managed Chromium CDP endpoint did not become ready on port ${port}. ${lastError?.message || ''}`.trim())
}

export async function startManagedBrowserHarnessBrowser({ runDir, runId, root, fs, spawn, net, fetchWithTimeout }) {
  const { chromium } = await import('playwright')
  const port = await getFreePort({ net })
  const userDataDir = path.join(runDir, 'browser-harness-chrome-profile')
  await fs.mkdir(userDataDir, { recursive: true })

  const child = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'about:blank',
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const cdpWs = await waitForCdpWebSocket({ port, fetchWithTimeout })
  return {
    child,
    cdpWs,
    port,
    buName: `dfe-${runId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}`,
  }
}

export function stopManagedBrowserHarnessBrowser(managedBrowser) {
  if (!managedBrowser || managedBrowser.child.killed) return
  managedBrowser.child.kill('SIGTERM')
}
