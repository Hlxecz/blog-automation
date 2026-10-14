import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliEnvironment, findExecutable } from '../scripts/cli-runtime.mjs';
import { cliCommand } from '../scripts/ai.mjs';
import { aiGuides } from '../web/ai-help.js';

test('Finder PATH discovers version-managed Node and CLI, ignores broken links and passes PATH to children', { skip: process.platform === 'win32' }, t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-path-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, '.nvm/versions/node/v22.20.0/bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['node', 'codex']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  fs.symlinkSync(path.join(home, 'missing'), path.join(home, '.local/bin/codex'));
  const discovered = cliEnvironment({ platform: 'darwin', home, env: { PATH: '/usr/bin:/bin', KEEP: 'value' } });
  assert.equal(discovered.KEEP, 'value');
  assert.ok(discovered.PATH.split(':').includes('/opt/homebrew/bin'));
  assert.ok(discovered.PATH.split(':').includes('/usr/local/bin'));
  assert.ok(discovered.PATH.split(':').includes(bin));
  // Test the temporary installations only. The CI host may already have a
  // Homebrew Node, which correctly takes precedence over discovered nvm bins.
  const env = { ...discovered, PATH: discovered.PATH.split(':').filter(dir => dir.startsWith(home + path.sep)).join(':') };
  assert.equal(findExecutable('codex', env, 'darwin'), path.join(bin, 'codex'));
  assert.deepEqual(cliCommand('codex', { platform: 'darwin', home, env }), { command: path.join(bin, 'codex'), prefix: [] });
  assert.deepEqual(cliCommand('claude', { platform: 'darwin', home, electron: '44',
    env: { ...env, TISTORY_CLAUDE_BIN: path.join(home, 'custom cli.mjs') } }),
    { command: path.join(bin, 'node'), prefix: [path.join(home, 'custom cli.mjs')] });
  const preferred = path.join(home, 'preferred/bin');
  fs.mkdirSync(preferred, { recursive: true });
  fs.writeFileSync(path.join(preferred, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.deepEqual(cliCommand('claude', { platform: 'darwin', home, electron: '44',
    env: { ...env, PATH: `${preferred}:${env.PATH}`, TISTORY_CLAUDE_BIN: path.join(home, 'custom cli.mjs') } }),
    { command: path.join(preferred, 'node'), prefix: [path.join(home, 'custom cli.mjs')] });
  fs.chmodSync(path.join(bin, 'codex'), 0o644);
  if (process.platform !== 'win32') assert.equal(findExecutable('codex', env, 'darwin'), null);
  assert.deepEqual(cliEnvironment({ platform: 'win32', env: { PATH: 'original' } }), { PATH: 'original' });
});

test('macOS help provides terminal commands while Windows keeps PowerShell instructions', () => {
  const mac = aiGuides('darwin'), win = aiGuides('win32');
  assert.equal(mac.codex.install, 'npm install -g @openai/codex@latest');
  assert.equal(mac.codex.login, 'codex login');
  assert.equal(mac.claude.install, 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(mac.claude.update, 'claude update');
  assert.equal(win.codex.login, 'codex.cmd login');
  assert.equal(win.claude.install, 'winget install Anthropic.ClaudeCode');
});
