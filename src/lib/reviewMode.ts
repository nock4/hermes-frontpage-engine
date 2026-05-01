type ReviewMode = 'debug' | 'clickable' | 'solo' | 'live'

export const getReviewMode = (search: string): ReviewMode => {
  const params = new URLSearchParams(search)
  if (params.get('debug') === 'masks') return 'debug'

  const qaMode = params.get('qa')
  if (qaMode === 'clickable') return 'clickable'
  if (qaMode === 'solo') return 'solo'

  return 'live'
}
