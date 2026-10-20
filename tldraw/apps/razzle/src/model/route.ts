// Which page this window is. Routes (docs/DESIGN.md, "Screens"):
//   /#/?deck=<id>                          editor
//   /#/present?view=audience&deck=<id>     audience screen (presenter app / projector)
//   /#/present?view=speaker&deck=<id>      speaker screen
//   /#/view?d=<data>                       a shared talk: the deck is in the link (model/share.ts)
export type View = 'editor' | 'audience' | 'speaker' | 'shared'

export interface Route {
  view: View
  deckId: string | null
}

export const parseRoute = (hash = location.hash, search = location.search): Route => {
  const h = hash.replace(/^#/, '')
  const [path, query = ''] = h.split('?')
  const params = new URLSearchParams(query || search.replace(/^\?/, ''))
  const deckId = params.get('deck')
  if (path.replace(/\/$/, '') === '/view') return { view: 'shared', deckId: null }
  if (path.replace(/\/$/, '') === '/present') {
    return { view: params.get('view') === 'speaker' ? 'speaker' : 'audience', deckId }
  }
  return { view: 'editor', deckId }
}

export const route = parseRoute()
