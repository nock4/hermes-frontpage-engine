// Bounded JSON grammar walk BEFORE JSON.parse can discard duplicate keys.
// Parse string tokens with JSON.parse only after locating their full lexical
// boundary; decoded key comparison catches escaped aliases at every depth.
export function parseUniqueKeyJson(text) {
  if (text.length > 2_000_000) throw new SyntaxError('JSON response exceeds size limit')
  let i = 0
  const fail = () => { throw new SyntaxError(`Invalid JSON at offset ${i}`) }
  const whitespace = () => { while (' \t\r\n'.includes(text[i]) && i < text.length) i++ }
  const string = () => {
    if (text[i] !== '"') fail()
    const start = i++
    while (i < text.length) {
      const c = text[i++]
      if (c === '"') return JSON.parse(text.slice(start, i))
      if (c === '\\') i++
    }
    fail()
  }
  const value = depth => {
    if (depth > 128) throw new SyntaxError('JSON response exceeds nesting limit')
    whitespace()
    const c = text[i]
    if (c === '{') {
      i++; whitespace()
      const keys = new Set()
      if (text[i] === '}') { i++; return }
      while (i < text.length) {
        whitespace()
        const key = string()
        if (keys.has(key)) throw new SyntaxError(`Duplicate JSON object key ${JSON.stringify(key)} at offset ${i}`)
        keys.add(key)
        whitespace()
        if (text[i++] !== ':') fail()
        value(depth + 1); whitespace()
        const next = text[i++]
        if (next === '}') return
        if (next !== ',') fail()
      }
      fail()
    }
    if (c === '[') {
      i++; whitespace()
      if (text[i] === ']') { i++; return }
      while (i < text.length) {
        value(depth + 1); whitespace()
        const next = text[i++]
        if (next === ']') return
        if (next !== ',') fail()
      }
      fail()
    }
    if (c === '"') { string(); return }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, i)) { i += literal.length; return }
    }
    // A token-local numeric grammar, not an object/key regex parser.
    const number = text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)
    if (!number) fail()
    i += number[0].length
  }
  value(0); whitespace()
  if (i !== text.length) fail()
  return JSON.parse(text)
}
