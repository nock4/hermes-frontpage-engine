// Source observations describe evidence, not coordinates the generator must copy.
export const recompositionRule = 'Require at least one structural change to arrangement, grouping/object count, or spatial logic; scale shifts, cropping and surface distress alone do not count. Keep distinctive source silhouettes, motifs, light and material relationships recognizable in the new structure.'
export const photoGrammarRule = 'Representational source cues are a vocabulary of concrete fragments and relationships, not requirements for exact count, order, positions, or full-scene restaging. Recompose selected recognizable fragments into new groupings and negative space; do not rebuild the complete portrait lineup or backdrop. Palette and grain alone are insufficient.'

export function isRepresentationalSource(source = {}) {
  const text = [source.visual_summary, ...(source.preserve_cues || []), ...(source.composition_moves || [])].join(' ')
  return /\b(portrait (?:photo|head|of)|figures?|heads?|faces?|body|torso|seated|standing|kneeling|still[- ]life|band photograph)\b/i.test(text)
}

export function recomposeSourceCues(cues = []) {
  return cues.map((cue) => `Source observation to recompose: ${String(cue).replace(/\b(preserve|keep|retain|maintain)\s+/gi, '')}`)
}
