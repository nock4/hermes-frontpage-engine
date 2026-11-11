// Tell: one plain Telegram message. Never throws; a failed notice must not turn
// a good edition into a failed run.

export async function tell(message, { env = process.env, fetchImpl = fetch, log = console.log, shadow = false } = {}) {
  const text = `${shadow ? '[shadow] ' : ''}${message}`.slice(0, 3500)
  log(`tell: ${text}`)
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { sent: false, reason: 'telegram not configured' }
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: false }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { sent: false, reason: `telegram HTTP ${response.status}` }
    return { sent: true }
  } catch (error) {
    // The URL holds the bot token: report the kind of failure, never the message.
    return { sent: false, reason: `telegram ${error.name}` }
  }
}
