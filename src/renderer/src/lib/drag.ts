// HTML5 drag carries no readable payload until drop, so the media panel parks the dragged item
// here for the timeline's dragover ghost.
import type { MediaItem } from '@shared/timeline'

export const MEDIA_MIME = 'application/x-cutroom-media'
export const mediaDrag: { item: MediaItem | null } = { item: null }
