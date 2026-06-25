export type SourceAccentTone = 'video' | 'audio' | 'social' | 'reading'

interface BaseSourceWindowDescriptor {
  allowsPlaybackPersistence: boolean
  domainLabel: string
  ctaLabel: string
  platformLabel: string
  accentTone: SourceAccentTone
}

interface SourceWindowSocialMetadata {
  sourceLabel?: string
  postLabel?: string
  byline?: string
}

interface YouTubeSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'youtube-embed'
  embedUrl: string
}

interface YouTubeLinkoutSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'youtube-linkout'
  sourceUrl: string
}

interface SoundCloudSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'soundcloud-embed'
  embedUrl: string
  sourceUrl: string
}

interface BandcampSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'bandcamp-card'
  sourceUrl: string
  artistLabel: string
  releasePath: string
}

interface BandcampEmbedSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'bandcamp-embed'
  embedUrl: string
  sourceUrl: string
  artistLabel: string
  releasePath: string
}

interface AudioDockSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'audio-dock'
  streamUrl: string | null
}

interface TweetSourceWindowDescriptor extends BaseSourceWindowDescriptor, SourceWindowSocialMetadata {
  kind: 'tweet-embed'
  sourceUrl: string
}

interface SocialCardSourceWindowDescriptor extends BaseSourceWindowDescriptor, SourceWindowSocialMetadata {
  kind: 'social-card'
  sourceUrl: string | null
}

interface RichPreviewSourceWindowDescriptor extends BaseSourceWindowDescriptor {
  kind: 'rich-preview'
  sourceUrl: string | null
}

export type SourceWindowDescriptor =
  | YouTubeSourceWindowDescriptor
  | YouTubeLinkoutSourceWindowDescriptor
  | SoundCloudSourceWindowDescriptor
  | BandcampSourceWindowDescriptor
  | BandcampEmbedSourceWindowDescriptor
  | AudioDockSourceWindowDescriptor
  | TweetSourceWindowDescriptor
  | SocialCardSourceWindowDescriptor
  | RichPreviewSourceWindowDescriptor
