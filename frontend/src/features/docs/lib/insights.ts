export function revisionInsights(revisions: { authorId?: string }[]) {
  return {
    versions: revisions.length,
    contributors: new Set(
      revisions.flatMap((revision) =>
        revision.authorId ? [revision.authorId] : []
      )
    ).size,
  }
}
