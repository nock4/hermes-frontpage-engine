import type { AppRoute } from '../../lib/router'
import type { ArchiveRecord, LoadedEdition, SourceBindingRecord } from '../../types/runtime'
import { ArchiveMiniList } from './ArchiveNavigation'
import { SourceWindow, SourceWindowDock } from './SourceWindow'

interface RuntimeSidebarProps {
  presentation: ReturnType<typeof import('../../lib/runtimePresentation').getRuntimePresentation>
  loaded: LoadedEdition
  route: AppRoute
  archiveRecords: ArchiveRecord[]
  activeBinding: SourceBindingRecord | null
  primaryBinding: SourceBindingRecord | null
  previewBinding: SourceBindingRecord | null
  dockBindings: SourceBindingRecord[]
  navigate: (href: string) => void
  onClosePrimaryBinding: (bindingId: string) => void
  onClosePreviewBinding: () => void
  onRestoreDockBinding: (bindingId: string) => void
}

export function RuntimeSidebar({
  presentation,
  loaded,
  route,
  archiveRecords,
  activeBinding,
  primaryBinding,
  previewBinding,
  dockBindings,
  navigate,
  onClosePrimaryBinding,
  onClosePreviewBinding,
  onRestoreDockBinding,
}: RuntimeSidebarProps) {
  return (
    <aside className="side-rail">
      <section className="panel">
        <div className="eyebrow">{presentation.briefEyebrow}</div>
        <h2>{loaded.edition.title}</h2>
        <p>{loaded.brief.mood}</p>
        <p>Lighting: {loaded.brief.lighting}</p>
        <p>Motion: {loaded.ambiance.motion_system}</p>
        {route.kind === 'archive-edition' ? <p>{loaded.edition.date} · {loaded.edition.scene_family}</p> : null}
      </section>

      <section className="panel">
        <div className="eyebrow">Source windows</div>
        {primaryBinding ? (
          <SourceWindow binding={primaryBinding} mode="primary" onClose={() => onClosePrimaryBinding(primaryBinding.id)} surface="panel" />
        ) : (
          <p>{presentation.sourceWindowsEmptyState}</p>
        )}

        {previewBinding && (!primaryBinding || previewBinding.id !== primaryBinding.id) ? (
          <SourceWindow binding={previewBinding} mode="preview" onClose={onClosePreviewBinding} surface="panel" />
        ) : null}

        {dockBindings.length ? <SourceWindowDock bindings={dockBindings} onRestore={onRestoreDockBinding} /> : null}
      </section>

      <section className="panel">
        <div className="eyebrow">{presentation.selectionEyebrow}</div>
        {activeBinding ? (
          <>
            <p>{activeBinding.title}</p>
            <p>{activeBinding.excerpt}</p>
          </>
        ) : (
          <p>No binding selected.</p>
        )}
      </section>

      <section className="panel">
        <div className="eyebrow">Archive</div>
        <ArchiveMiniList currentEditionId={loaded.edition.edition_id} navigate={navigate} records={archiveRecords} />
      </section>

      {presentation.showReviewPanel ? (
        <section className="panel">
          <div className="eyebrow">Review</div>
          <p>Geometry: {loaded.review.geometry_status}</p>
          <p>Clickability: {loaded.review.clickability_status}</p>
          <p>Behavior: {loaded.review.behavior_status}</p>
        </section>
      ) : null}
    </aside>
  )
}
