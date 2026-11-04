import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { downloadLinearImage, prepareDescription } from './description.mjs';

test('extended tags preserve surrounding markdown and hide image sources on failure', async () => {
  const src = 'https://uploads.linear.app/image.png?signature=TEST_SIGNATURE';
  const image = `<linear-image>${JSON.stringify({ type: 'image', attrs: { src, title: 'image.png', width: 1664, height: 220 } })}</linear-image>`;
  const raw = `Before <issue id="uuid" label="DEMO-22" href="https://linear.app/team/issue/DEMO-22" />\n${image}\nAfter`;
  assert.deepEqual(await prepareDescription(raw, async url => {
    assert.equal(url, src);
    return 'data/linear/images/example.png';
  }), [
    { type: 'markdown', text: 'Before [DEMO-22](https://linear.app/team/issue/DEMO-22)\n' },
    { type: 'image', path: 'data/linear/images/example.png', width: 1664, height: 220, title: 'image.png' },
    { type: 'markdown', text: '\nAfter' },
  ]);
  assert.deepEqual(await prepareDescription(image, async () => { throw new Error(src); }), [{ type: 'image', error: '图片暂时无法加载', title: 'image.png' }]);
  assert.deepEqual(await prepareDescription('<linear-image>{invalid secret</linear-image>'), [{ type: 'image', error: '图片暂时无法加载', title: '' }]);
  assert.deepEqual(await prepareDescription('<linear-image src="private'), [{ type: 'image', error: '图片暂时无法加载', title: '' }]);
  const noSize = `<linear-image>${JSON.stringify({ attrs: { src, width: -1, height: 0 } })}</linear-image>`;
  assert.deepEqual(await prepareDescription(noSize, async () => 'data/linear/images/example.png'), [{ type: 'image', path: 'data/linear/images/example.png', width: null, height: null, title: '' }]);
  assert.deepEqual(await prepareDescription('<issue label="DEMO-1" href="https://evil.example/secret" />'), [{ type: 'markdown', text: 'DEMO-1' }]);
  const example = '```md\n' + image + '\n```\n`<issue label="DEMO-1" href="https://linear.app/team/issue/DEMO-1" />`';
  assert.deepEqual(await prepareDescription(example, () => { throw new Error('code must not load'); }), [{type:'markdown',text:example}]);
  const unclosedExample = '```md\n<linear-image>example\n```\n';
  assert.deepEqual(await prepareDescription(unclosedExample + image, async () => 'data/linear/images/test.png'), [
    {type:'markdown',text:unclosedExample},
    {type:'image',path:'data/linear/images/test.png',width:1664,height:220,title:'image.png'},
  ]);
  assert.deepEqual(await prepareDescription(null), []);
});

test('authenticated image extraction restricts hosts, types and sizes', async () => {
  let saved;
  let requests = 0;
  const extract = async markdown => {
    requests++;
    assert.match(markdown, /^!\[image\]\(https:\/\/uploads\.linear\.app\//);
    return { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') }] };
  };
  try {
    await assert.rejects(downloadLinearImage('http://uploads.linear.app/a', extract));
    await assert.rejects(downloadLinearImage('https://uploads.linear.app.evil.example/a', extract));
    assert.equal(requests, 0);
    await assert.rejects(downloadLinearImage('https://uploads.linear.app/a)![other](https://example.com/a', async markdown => {
      assert.equal(markdown.includes(')![other]('), false);
      return {};
    }));
    saved = await downloadLinearImage(`https://uploads.linear.app/herdr-linear-self-check-${randomUUID()}?signature=TEST_SIGNATURE`, extract);
    assert.match(saved, /^data\/linear\/images\/[a-f0-9]{64}\.png$/);
    assert.deepEqual(await readFile(join(process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), saved)), Buffer.from([1, 2, 3]));
    await assert.rejects(downloadLinearImage('https://uploads.linear.app/a', async () => ({ content: [{ type: 'image', mimeType: 'text/html', data: 'AAAA' }] })));
    await assert.rejects(downloadLinearImage('https://uploads.linear.app/a', async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(14 * 1024 * 1024) }] })));
  } finally { if (saved) await rm(join(process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), saved), { force: true }); }
});
