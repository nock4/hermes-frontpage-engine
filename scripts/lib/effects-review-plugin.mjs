import fs from 'node:fs'
import path from 'node:path'
import { normalizeEffects, effectKinds } from '../../src/lib/editionEffects.mjs'

export function reviewEffectsFromRequest({ query, context, admission, hasContract = false }) {
  const q = new URLSearchParams(query),
    kind = q.get('effectReview')
  if (
    hasContract ||
    q.get('qaEffects') !== '1' ||
    !effectKinds.includes(kind) ||
    admission?.edition_id !== context.editionId
  )
    return null
  for (const evidence of admission.evidence || [])
    try {
      return normalizeEffects(
        {
          schema_version: 1,
          edition_id: context.editionId,
          effects: [{ kind, artifact_id: evidence.artifact_id, binding_id: evidence.binding_id, evidence }],
        },
        context,
      )
    } catch {
      /* Unsupported modality stays off; never invent a source or mask. */
    }
  return null
}
// Server-only Vite dev middleware. No review override is bundled or served by
// vite preview/static production, and no published edition bytes are written.
export const effectsReviewPlugin = {
  name: 'local-edition-effects-review',
  apply: 'serve',
  configureServer(server) {
    const root = server.config.root
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'GET' || !/^\/editions\/[a-zA-Z0-9_-]+\/effects\.json$/.test(req.url || ''))
        return next()
      try {
        const query = String(req.headers['x-dfe-effects-review'] || ''),
          base = path.join(root, 'public', req.url.replace(/\/effects\.json$/, '')),
          read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
        const admission = read(path.join(root, 'tmp', 'effects-review-admission.json')),
          edition = read(path.join(base, 'edition.json')),
          map = read(path.join(base, 'artifact-map.json')),
          bindings = read(path.join(base, 'source-bindings.json'))
        const effects = reviewEffectsFromRequest({
          query,
          admission,
          hasContract: fs.existsSync(path.join(base, 'effects.json')),
          context: { editionId: edition.edition_id, artifacts: map.artifacts, bindings: bindings.bindings },
        })
        if (!effects) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(effects))
      } catch {
        return next()
      }
    })
  },
}
