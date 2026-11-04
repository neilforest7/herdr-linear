import assert from 'node:assert/strict';
import { normalizeIssue, normalizeIssueListItem } from './issue.mjs';

const related = (id, uuid, statusType) => ({ id, uuid, title: id, url: `https://linear.app/issue/${id}`, status: 'Todo', statusType });
const blocks = related('DEMO-1', 'uuid-1', 'unstarted');
const blockedBy = related('DEMO-2', 'uuid-2', 'started');
const relatedTo = related('DEMO-3', 'uuid-3', 'completed');
const duplicateOf = related('DEMO-4', 'uuid-4', 'canceled');
const raw = {
  ...related('DEMO-34', 'uuid-34', 'unstarted'),
  priority: { value: 0, name: 'No priority' },
  assignee: null,
  description: '  # Heading\n\n[link](https://example.com)\n',
  estimate: 0,
  labels: ['bug'],
  project: 'Project', team: 'Team', createdBy: 'Creator',
  createdAt: 'created', updatedAt: 'updated', dueDate: null, parentId: null,
  relations: { blocks: [blocks], blockedBy: [blockedBy], relatedTo: [relatedTo], duplicateOf },
};
const summary = item => ({ id: item.uuid, identifier: item.id, title: item.title, url: item.url, status: item.status, statusType: item.statusType });
assert.deepEqual(normalizeIssue(raw), {
  ...summary(raw), priority: { value: 0, name: 'No priority' }, assignee: '',
  description: raw.description, estimate: 0, labels: ['bug'], project: 'Project', team: 'Team', createdBy: 'Creator',
  createdAt: 'created', updatedAt: 'updated', dueDate: null, parentId: null,
  relations: { blocks: [summary(blocks)], blockedBy: [summary(blockedBy)], relatedTo: [summary(relatedTo)], duplicateOf: summary(duplicateOf) },
});
assert.deepEqual(normalizeIssueListItem({ ...raw, priority: { value: 1, name: 'Urgent' } }).priority, { value: 1, name: 'Urgent' });
assert.equal(normalizeIssue({ ...raw, description: null }).description, null);
assert.throws(() => normalizeIssue({ ...raw, relations: undefined }));
