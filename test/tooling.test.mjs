import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setup } from '../scripts/setup.mjs';
import { checksums, releaseInfo } from '../scripts/release.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-tooling-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hdev-tooling-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.cpSync(new URL('../config/', import.meta.url), path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changes\n\n## [1.2.3] - 2026-09-15\n');
  return root;
}

test('fresh setup creates required local files and preserves subsequent user edits', t => {
  const root = fixture(t);
  const created = setup(root);
  assert.deepEqual(created, ['tistory.config.json', 'style/profile.md', 'style/samples/source-notes.md']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, created[0]))).blogUrl, 'https://your-blog.tistory.com');
  for (const file of created) fs.writeFileSync(path.join(root, file), `User edit: ${file}`);
  assert.deepEqual(setup(root), []);
  for (const file of created) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), `User edit: ${file}`);
  assert.ok(fs.statSync(path.join(root, 'inbox')).isDirectory());
  assert.ok(fs.statSync(path.join(root, 'drafts')).isDirectory());
});

test('release checks reject inconsistent versions and undocumented releases', t => {
  const root = fixture(t);
  assert.deepEqual(releaseInfo(root), {
    version: '1.2.3', directory: path.join(root, 'dist', '1.2.3'), filename: 'HDev-Studio-1.2.3-win-x64.exe'
  });
  for (const lock of [
    { version: '1.2.4', packages: { '': { version: '1.2.3' } } },
    { version: '1.2.3', packages: { '': { version: '1.2.4' } } }
  ]) {
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.throws(() => releaseInfo(root), /버전이 다릅니다/);
  }
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '## [Unreleased]\n');
  assert.throws(() => releaseInfo(root), /변경 내역과 날짜/);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '../outside' }));
  assert.throws(() => releaseInfo(root), /버전 형식/);
});

test('checksum metadata matches bytes and does not change the existing artifact', t => {
  const root = fixture(t), info = releaseInfo(root);
  fs.mkdirSync(info.directory, { recursive: true });
  const artifact = path.join(info.directory, info.filename);
  const bytes = Buffer.from('Synthetic release artifact for testing only\n');
  fs.writeFileSync(artifact, bytes);
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(checksums(root).sha256, expected);
  assert.deepEqual(fs.readFileSync(artifact), bytes);
  assert.equal(fs.readFileSync(path.join(info.directory, 'SHA256SUMS.txt'), 'utf8'), `${expected}  ${info.filename}\n`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(info.directory, 'release.json'))), {
    version: info.version, filename: info.filename, bytes: bytes.length, sha256: expected
  });
});
