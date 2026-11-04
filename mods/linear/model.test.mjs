import assert from 'node:assert/strict';
import { filterIssues, find, issueURL } from './model.js';
const issues = [{ identifier: 'APP-1', title: 'Fix login', status: 'Done', assignee: 'Forest' }, { identifier: 'APP-2', title: '中文搜索', status: 'Todo' }];
assert.deepEqual(filterIssues(issues, 'FOREST'), [issues[0]]);
assert.deepEqual(filterIssues(issues, ' 中文 '), [issues[1]]);
assert.equal(filterIssues(issues, '').length, 2);
assert.equal(find({ children: [{ id: 'linear' }] }, 'linear').id, 'linear');
assert.equal(issueURL('https://linear.app/team/issue/APP-1'), 'https://linear.app/team/issue/APP-1');
for (const bad of ['javascript:alert(1)', 'https://linear.app.evil.test/issue', 'https://evil.test', 'http://linear.app', 'garbage']) assert.equal(issueURL(bad), null);
console.log('Model checks passed');

const { visibleIssues, ended, issueReference, webURL } = await import('./model.js');
const rows = [{ ...issues[0], statusType: 'completed' }, { ...issues[1], statusType: 'started' }, { identifier: 'APP-3', title: 'Canceled', statusType: 'canceled' }];
assert.equal(ended(rows[0]), true);
assert.deepEqual(visibleIssues(rows, '', 'open'), [rows[1]]);
assert.equal(visibleIssues(rows, '', 'ended').length, 2);
assert.equal(issueReference('https://linear.app/team/issue/DEMO-34/title'), 'DEMO-34');
assert.equal(issueReference('https://linear.app.evil.test/issue/DEMO-34'), null);
assert.equal(webURL('javascript:alert(1)'), null);

const { detailMarkdown } = await import('./model.js');
assert.equal(detailMarkdown('# Heading\n## Section\n```md\n# code\n```'), '### Heading\n#### Section\n```md\n# code\n```');
