import type { ArchiveRecord } from '../../types/runtime'

interface ArchiveNavigationProps {
  records: ArchiveRecord[]
  navigate: (href: string) => void
  currentEditionId: string
}

export function ArchiveIndexPage({ records, navigate, currentEditionId }: ArchiveNavigationProps) {
  return (
    <main className="archive-shell">
      <header className="runtime-topbar">
        <div>
          <div className="eyebrow">Archive</div>
          <h1>Daily edition archive</h1>
          <p>Browse previous front-page worlds by date and family.</p>
        </div>
        <div className="topbar-actions">
          <button onClick={() => navigate('/')} type="button">Back to current</button>
        </div>
      </header>

      <section className="archive-grid">
        {records.map((record) => (
          <button className="archive-card" key={record.edition_id} onClick={() => navigate(record.archive_href)} type="button">
            <img alt={record.title} src={record.preview_asset_path} />
            <div className="archive-card__body">
              <div className="archive-card__meta">
                <span>{record.date}</span>
                <span>{record.scene_family}</span>
              </div>
              <strong>{record.title}</strong>
              <p>{record.motif_tags.join(' · ')}</p>
              {record.edition_id === currentEditionId ? <span className="badge">current</span> : null}
            </div>
          </button>
        ))}
      </section>
    </main>
  )
}

export function ArchiveMiniList({ records, navigate, currentEditionId }: ArchiveNavigationProps) {
  return (
    <ul className="archive-mini-list">
      {records.map((record) => (
        <li key={record.edition_id}>
          <button onClick={() => navigate(record.is_live ? '/' : record.archive_href)} type="button">
            <span>{record.title}</span>
            <span>{record.date}</span>
            {record.edition_id === currentEditionId ? <span className="badge">here</span> : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
