import { useEffect, useMemo, useReducer, useState } from 'react'
import { clearEncounterTrail, createInteractionState, getInteractionGeometry, getPackagedMaterialPath, interactionReducer, loadEncounterTrail, pickLabArtifacts, saveEncounterTrail } from '../../lib/interactionLab'
import type { ArtifactRecord, SourceBindingRecord } from '../../types/runtime'

interface InteractionLabProps {
  artifacts: ArtifactRecord[]
  bindings: SourceBindingRecord[]
  editionId: string
  platePath: string
  onOpenSource: (binding: SourceBindingRecord, artifact: ArtifactRecord) => void
}

const verbFor = (index: number) => (['material', 'contour', 'wash'] as const)[index % 3]

export function InteractionLab({ artifacts, bindings, editionId, platePath, onOpenSource }: InteractionLabProps) {
  const [state, dispatch] = useReducer(interactionReducer, undefined, createInteractionState)
  const [hydratedEditionId, setHydratedEditionId] = useState<string | null>(null)
  const bindingsByArtifact = useMemo(() => new Map(bindings.map((binding) => [binding.artifact_id, binding])), [bindings])
  const selected = useMemo(() => pickLabArtifacts(artifacts, new Set(bindings.map(({ artifact_id }) => artifact_id))), [artifacts, bindings])
  const safePlatePath = getPackagedMaterialPath(undefined, editionId, platePath)

  useEffect(() => {
    dispatch({ type: 'hydrate', trail: loadEncounterTrail(window.localStorage, editionId) })
    setHydratedEditionId(editionId)
  }, [editionId])

  useEffect(() => {
    if (hydratedEditionId !== editionId) return
    saveEncounterTrail(window.localStorage, editionId, state.trail)
  }, [editionId, hydratedEditionId, state.trail])

  const activate = (artifact: ArtifactRecord, binding: SourceBindingRecord) => {
    if (state.revealedArtifactIds.includes(artifact.id)) {
      onOpenSource(binding, artifact)
      dispatch({ type: 'source-opened' })
      return
    }
    dispatch({
      type: 'activate',
      encounter: {
        artifactId: artifact.id,
        sourceUrl: binding.source_url,
        sourceTitle: binding.source_title || binding.title,
        order: state.trail.length + 1,
        discoveredAt: Date.now(),
      },
    })
  }

  return (
    <div className="interaction-lab" data-interaction-lab="true" style={(safePlatePath ? { '--lab-plate': `url("${safePlatePath}")` } : {}) as React.CSSProperties}>
      <div className="interaction-lab__territories">
        {selected.map((artifact, index) => {
          const binding = bindingsByArtifact.get(artifact.id)!
          const revealed = state.revealedArtifactIds.includes(artifact.id)
          const verb = verbFor(index)
          const material = getPackagedMaterialPath(binding.source_visual?.poster_asset_path, editionId, platePath)
          const geometry = getInteractionGeometry(artifact)
          const target = geometry.target.bounds
          const visual = geometry.visual.bounds
          return (
            <button
              aria-label={`${revealed ? 'Open source for' : 'Reveal'} ${binding.source_title || binding.title}`}
              className={`interaction-lab__territory interaction-lab__territory--${verb}${revealed ? ' is-revealed' : ''}`}
              data-interaction-lab-artifact={artifact.id}
              data-lab-revealed={String(revealed)}
              data-verb={verb}
              key={artifact.id}
              onClick={() => activate(artifact, binding)}
              style={{
                left: `${target.x * 100}%`, top: `${target.y * 100}%`,
                width: `${target.w * 100}%`, height: `${target.h * 100}%`,
                clipPath: geometry.target.clipPath, WebkitClipPath: geometry.target.clipPath,
              } as React.CSSProperties}
              type="button"
            >
              <span
                className="interaction-lab__visual"
                data-visible-artifact={artifact.id}
                style={{
                  left: `${visual.x * 100}%`, top: `${visual.y * 100}%`,
                  width: `${visual.w * 100}%`, height: `${visual.h * 100}%`,
                  clipPath: geometry.visual.clipPath, WebkitClipPath: geometry.visual.clipPath,
                  ...(material ? { '--lab-material': `url("${material}")` } : {}),
                } as React.CSSProperties}
              >
                <span className="interaction-lab__material" aria-hidden="true" />
                <span className="interaction-lab__contour" aria-hidden="true">{binding.source_title || binding.title}</span>
                {verb === 'wash' && revealed ? <span className="interaction-lab__wash" data-verb="wash" aria-hidden="true" /> : null}
              </span>
            </button>
          )
        })}
      </div>
      <aside className="interaction-lab__trail" aria-label="Encounter trail">
        <div className="interaction-lab__trail-fragment" aria-hidden="true" />
        <ol>
          {state.trail.map((encounter) => <li className="interaction-lab__trail-item" key={encounter.artifactId}><b>{String(encounter.order).padStart(2, '0')}</b><span>{encounter.sourceTitle}</span></li>)}
        </ol>
        <button className="interaction-lab__reset" onClick={() => { clearEncounterTrail(window.localStorage, editionId); dispatch({ type: 'clear' }) }} type="button">clear trace</button>
      </aside>
    </div>
  )
}
