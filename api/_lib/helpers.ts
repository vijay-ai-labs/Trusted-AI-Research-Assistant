export interface SynthesisSource {
  marker: string
  title: string
  authors: string[]
  year: number
  sourceName: string
  sourceType: string
  peerReviewed: boolean
  provenance: string
  abstract: string
  trustNotes: string
  url: string
  doi?: string
}

export function buildSynthesisUserMessage(query: string, sources: SynthesisSource[]): string {
  const sourceBlocks = sources
    .map((s) => {
      const authorsStr = s.authors.length > 0 ? s.authors.join(', ') : 'Unknown'
      const peerReviewed = s.peerReviewed ? 'yes' : 'no'
      return [
        `[${s.marker}] Title: ${s.title} | Authors: ${authorsStr} | Year: ${s.year} | Venue: ${s.sourceName} | Provenance: ${s.provenance} | Peer-reviewed: ${peerReviewed}`,
        `Abstract: ${s.abstract}`,
        `Trust notes: ${s.trustNotes}`,
        `URL: ${s.url}`,
      ].join('\n')
    })
    .join('\n\n')

  return `Question: ${query}\n\nSources:\n${sourceBlocks}`
}
