import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setup } from '../scripts/setup.mjs';
import { buildPlan, checksums, releaseInfo } from '../scripts/release.mjs';

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
    version: '1.2.3', directory: path.join(root, 'dist', '1.2.3', 'windows'), filename: 'HDev-Studio-1.2.3-win-x64.exe'
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

test('platform build configurations and checksums stay in separate output folders', t => {
  const root = fixture(t);
  assert.throws(() => buildPlan('build', { platform: 'darwin', root }), /build:mac/);
  assert.throws(() => buildPlan('build-mac', { platform: 'win32', root }), /macOS/);
  assert.throws(() => releaseInfo(root, { platform: 'darwin', arch: '../outside' }), /지원하는/);
  const plan = buildPlan('build-mac', { platform: 'darwin', arch: 'arm64', root });
  assert.deepEqual(plan.args, ['--config', 'macos/electron-builder.cjs', '--mac', 'dmg', 'zip', '--arm64', '--publish', 'never']);
  const all = buildPlan('build-mac', { platform: 'darwin', all: true, root });
  assert.deepEqual(all.args, ['--config', 'macos/electron-builder.cjs', '--mac', 'dmg', 'zip', '--arm64', '--x64', '--publish', 'never']);
  assert.equal(all.filenames.length, 4);
  fs.mkdirSync(plan.info.directory, { recursive: true });
  for (const name of all.filenames) fs.writeFileSync(path.join(plan.info.directory, name), name);
  const windows = buildPlan('build', { platform: 'win32', root });
  assert.deepEqual(windows.args, ['--config', 'windows/electron-builder.cjs', '--win', 'portable', '--x64', '--publish', 'never']);
  assert.notEqual(windows.info.directory, plan.info.directory);
  fs.mkdirSync(windows.info.directory, { recursive: true });
  fs.writeFileSync(path.join(windows.info.directory, windows.info.filename), 'Windows file');
  fs.writeFileSync(path.join(plan.info.directory, 'unrelated.zip'), 'ignore');
  const result = checksums(root, { platform: 'darwin' });
  assert.equal(result.artifacts.length, 4);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.sha256, createHash('sha256').update(artifact.filename).digest('hex'));
  }
  assert.equal(fs.readFileSync(path.join(plan.info.directory, 'SHA256SUMS.txt'), 'utf8').includes('unrelated.zip'), false);
  assert.equal(fs.readFileSync(path.join(plan.info.directory, 'SHA256SUMS.txt'), 'utf8').includes('win-x64.exe'), false);
  assert.equal(checksums(root).filename, windows.info.filename);
  assert.equal(fs.readFileSync(path.join(windows.info.directory, 'SHA256SUMS.txt'), 'utf8').includes('mac-'), false);
});
