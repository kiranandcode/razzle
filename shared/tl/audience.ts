// A share contains the visible slides, not the author's narration or off-slide workspace.
type Json = Record<string, any>

export function audienceSnapshot(document: { store: Record<string, any>, schema: any }, slides: Json[]) {
  const visible = slides.filter(s => !s.razzle?.hidden && !document.store[s.id]?.meta?.razzle?.hidden)
  const roots = new Set(visible.map(s => s.id))
  const shapes = new Set<string>()
  const pages = new Set<string>()
  const assets = new Set<string>()
  const source = document.store
  for (const record of Object.values(source) as Json[]) {
    if (record.typeName !== 'shape') continue
    let parent = record
    const seen = new Set<string>()
    while (parent && !roots.has(parent.id) && !seen.has(parent.id)) {
      seen.add(parent.id)
      parent = source[parent.parentId]
    }
    if (!parent || !roots.has(parent.id)) continue
    shapes.add(record.id)
    pages.add(parent.parentId)
    if (typeof record.props?.assetId === 'string') assets.add(record.props.assetId)
  }
  const store: Record<string, any> = {}
  for (const record of Object.values(source) as Json[]) {
    const keep = record.typeName === 'document' ||
      (record.typeName === 'page' && pages.has(record.id)) ||
      (record.typeName === 'shape' && shapes.has(record.id)) ||
      (record.typeName === 'asset' && assets.has(record.id)) ||
      (record.typeName === 'binding' && shapes.has(record.fromId) && shapes.has(record.toId))
    if (!keep) continue
    const { razzle, ...meta } = record.meta ?? {}
    store[record.id] = { ...record, meta: { ...meta, ...(razzle?.buildSteps ? { razzle: { buildSteps: razzle.buildSteps } } : {}) } }
  }
  return {
    document: { ...document, store },
    slides: visible.map(s => ({ id: s.id, title: s.title, stepCount: s.stepCount, elements: [],
      razzle: s.razzle?.buildSteps ? { buildSteps: s.razzle.buildSteps } : {} })),
  }
}
