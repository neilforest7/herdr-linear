export function normalizeIssueSummary(issue) {
  return {
    id: issue.uuid ?? issue.id,
    identifier: issue.identifier ?? issue.id,
    title: issue.title,
    url: issue.url ?? null,
    status: String(issue.status ?? ''),
    statusType: issue.statusType ?? null,
  };
}

export function normalizeIssueListItem(issue) {
  return {
    ...normalizeIssueSummary(issue),
    priority: { value: issue.priority?.value ?? null, name: issue.priority?.name ?? null },
    assignee: String(issue.assignee?.name ?? issue.assignee ?? ''),
    labels: issue.labels ?? [],
  };
}

export function normalizeIssue(issue) {
  const relations = issue.relations;
  if (!relations || !Array.isArray(relations.blocks) || !Array.isArray(relations.blockedBy) || !Array.isArray(relations.relatedTo) || !('duplicateOf' in relations)) throw new Error('relations unavailable');
  return {
    ...normalizeIssueListItem(issue),
    description: issue.description ?? null,
    estimate: issue.estimate ?? null,
    labels: issue.labels ?? [],
    project: issue.project ?? null,
    team: issue.team ?? null,
    createdBy: issue.createdBy ?? null,
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? null,
    dueDate: issue.dueDate ?? null,
    parentId: issue.parentId ?? null,
    relations: {
      blocks: relations.blocks.map(normalizeIssueSummary),
      blockedBy: relations.blockedBy.map(normalizeIssueSummary),
      relatedTo: relations.relatedTo.map(normalizeIssueSummary),
      duplicateOf: relations.duplicateOf == null ? null : normalizeIssueSummary(relations.duplicateOf),
    },
  };
}
