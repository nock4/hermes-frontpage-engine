import { getRichPreviewModel } from '../../lib/richPreviewModel'
import { getSourceWindowSurfaceProfile } from '../../lib/sourceWindowSurface'

export type SourceWindowMode = 'preview' | 'primary' | 'secondary'
export type SourceWindowSurface = 'panel' | 'stage'
export type SourceWindowSurfaceProfile = ReturnType<typeof getSourceWindowSurfaceProfile>
export type RichPreviewModel = ReturnType<typeof getRichPreviewModel>
