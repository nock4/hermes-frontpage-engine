import type { EmbedPreload } from '../../lib/embedPreloads'
import { TWEET_EMBED_SANDBOX } from '../../lib/tweetEmbed'

export function EmbedPreloadLayer({
  embeds,
}: {
  embeds: EmbedPreload[]
}) {
  return (
    <div aria-hidden="true" className="embed-preload-layer">
      {embeds.map((embed) => (
        embed.kind === 'tweet' ? (
          <iframe
            key={embed.id}
            className="embed-preload-frame"
            data-embed-preload-kind="tweet"
            loading="eager"
            sandbox={TWEET_EMBED_SANDBOX}
            srcDoc={embed.srcDoc}
            tabIndex={-1}
            title={`Preload ${embed.title}`}
          />
        ) : embed.kind === 'image' ? (
          <img
            key={embed.id}
            alt=""
            aria-hidden="true"
            className="embed-preload-image"
            data-embed-preload-kind="image"
            decoding="async"
            fetchPriority="high"
            loading="eager"
            src={embed.src}
          />
        ) : (
          <iframe
            key={embed.id}
            allow={embed.kind === 'youtube' ? 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture' : 'autoplay'}
            className="embed-preload-frame"
            data-embed-preload-kind={embed.kind}
            loading="eager"
            src={embed.src}
            tabIndex={-1}
            title={`Preload ${embed.title}`}
          />
        )
      ))}
    </div>
  )
}
