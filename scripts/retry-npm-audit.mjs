import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const maxAttempts = Number(process.env.DFE_NPM_AUDIT_ATTEMPTS || 3)
const attemptTimeoutMs = Number(process.env.DFE_NPM_AUDIT_TIMEOUT_MS || 90000)
const retryablePattern = /(audit endpoint returned an error|network timeout|econnreset|etimedout|eai_again|socket hang up|fetch failed|registry\.npmjs\.org)/i
const auditArgs = args.includes('--json') ? args : [...args, '--json']

function runAudit(attempt) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['audit', ...auditArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let output = ''
    const timer = setTimeout(() => {
      output += `\nnpm audit attempt timed out after ${attemptTimeoutMs}ms against registry.npmjs.org\n`
      child.kill('SIGTERM')
    }, attemptTimeoutMs)
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      output += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 1, output: `${output}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output })
    })
  })
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await runAudit(attempt)
  if (result.code === 0) process.exit(0)
  const retryable = retryablePattern.test(result.output || '')
  if (!retryable || attempt >= maxAttempts) process.exit(result.code || 1)
  const delayMs = 1500 * attempt
  console.warn(`[qa:publish] npm audit attempt ${attempt}/${maxAttempts} hit a retryable registry error; retrying in ${delayMs}ms`)
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}
