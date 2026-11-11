// Lifted from scripts/lib/edition-package-assembly.mjs (chooseAboutTypography).
export function chooseAboutTypography(payload) {
  const text = [
    payload.edition_title,
    payload.scene_family,
    payload.mood,
    payload.lighting,
    payload.scene_prompt,
    ...(payload.material_language || []),
    ...(payload.object_inventory || []),
  ].join(' ').toLowerCase()

  const profiles = {
    botanicalField: {
      profile_id: 'botanical-field',
      heading_family: "'DFE Fraunces', Georgia, serif",
      body_family: "'DFE Newsreader', Iowan Old Style, Georgia, serif",
      accent_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 720,
      rationale: 'Fraunces gives the title an organic, seed-label quality; Newsreader keeps the explanation calm and readable.',
    },
    archiveReader: {
      profile_id: 'archive-reader',
      heading_family: "'DFE Newsreader', Georgia, serif",
      body_family: "'DFE Newsreader', Iowan Old Style, Georgia, serif",
      accent_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 720,
      rationale: 'Newsreader supports an editorial archive voice while Space Grotesk keeps process labels crisp.',
    },
    signalTechnical: {
      profile_id: 'signal-technical',
      heading_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      body_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      accent_family: "'DFE JetBrains Mono', 'DFE Mono', ui-monospace, monospace",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 640,
      rationale: 'Space Grotesk carries a precise technical mood without turning the panel into a dashboard.',
    },
    constructedWorld: {
      profile_id: 'constructed-world',
      heading_family: "'DFE Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
      body_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      accent_family: "'DFE Newsreader', Georgia, serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 640,
      rationale: 'Bricolage Grotesque fits assembled, experimental scenes while Space Grotesk keeps the process text direct.',
    },
    listeningArcade: {
      profile_id: 'listening-arcade',
      heading_family: "'DFE Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
      body_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      accent_family: "'DFE Fraunces', Georgia, serif",
      heading_weight: 720,
      body_weight: 430,
      accent_weight: 680,
      rationale: 'Bricolage Grotesque and Space Grotesk fit record, arcade, and listening-room editions while Fraunces keeps source captions tactile.',
    },
    artObject: {
      profile_id: 'art-object',
      heading_family: "'DFE Fraunces', 'DFE Newsreader', Georgia, serif",
      body_family: "'DFE Newsreader', Georgia, serif",
      accent_family: "'DFE Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      heading_weight: 700,
      body_weight: 430,
      accent_weight: 700,
      rationale: 'Fraunces and Newsreader fit image-led art objects while Space Grotesk keeps process labels crisp.',
    },
  }

  if (/(listen|listening|audio|track|album|record|radio|nts|bandcamp|mix|music|arcade|speaker|sound|cassette|turntable|song)/.test(text)) {
    return profiles.listeningArcade
  }
  if (/(plant|garden|botanic|botanical|native|seed|field|forest|moss|leaf|flower|pollinator|prairie|meadow|habitat|dragonfly|milkweed)/.test(text)) {
    return profiles.botanicalField
  }
  if (/(paint|painting|print|printmaking|artist|artwork|gallery|canvas|photograph|image|studio|exhibition|chapel|lacquer|pigment|ink)/.test(text)) {
    return profiles.artObject
  }
  if (/(software|agent|memory|protocol|api|code|model|signal|ledger|machine|algorithm|network|system)/.test(text)) {
    return profiles.signalTechnical
  }
  if (/(archive|library|book|ledger|paper|document|folio|cabinet|map|catalogue|index|print|reader)/.test(text)) {
    return profiles.archiveReader
  }
  if (/(shrine|theatre|stage|ritual|folklore|procession|altar|loom|assemblage|workshop|studio|watchpost)/.test(text)) {
    return profiles.constructedWorld
  }
  return profiles.constructedWorld
}
