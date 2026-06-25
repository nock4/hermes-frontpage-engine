export const TWEET_EMBED_SANDBOX = 'allow-scripts allow-popups allow-same-origin'

function getTweetStatusId(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    const statusIndex = parts.findIndex((part) => part === 'status')
    return statusIndex >= 0 ? parts[statusIndex + 1] || null : null
  } catch {
    return null
  }
}

export function getTweetEmbedUrl(sourceUrl: string) {
  const statusId = getTweetStatusId(sourceUrl)
  if (!statusId) return null
  const url = new URL('https://platform.twitter.com/embed/Tweet.html')
  url.searchParams.set('id', statusId)
  url.searchParams.set('dnt', 'true')
  url.searchParams.set('theme', 'dark')
  return url.toString()
}

export function getTweetEmbedSrcDoc(sourceUrl: string) {
  const tweetUrl = sourceUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      body {
        min-height: 100%;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }
      .tweet-shell {
        width: 100%;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <div class="tweet-shell">
      <blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><a href="${tweetUrl}"></a></blockquote>
    </div>
    <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
  </body>
</html>`
}
