import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function releaseInfo(root = ROOT) {
  const pkg = read(path.join(root,'package.json')), lock = read(path.join(root,'package-lock.json'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('배포 버전 형식을 확인하세요. 예: 0.3.5 또는 0.4.0-rc.1');
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package.json과 package-lock.json의 버전이 다릅니다. npm version 명령을 사용하세요.');
  const headings = fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8').split(/\r?\n/);
  if (!headings.some(line => line.startsWith(`## [${version}] - `))) throw new Error(`CHANGELOG.md에 ${version}의 변경 내역과 날짜를 작성하세요.`);
  return {version,directory:path.join(root,'dist',version),filename:`HDev-Studio-${version}-win-x64.exe`};
}

export function checksums(root = ROOT) {
  const info = releaseInfo(root), artifact = path.join(info.directory,info.filename);
  const bytes = fs.readFileSync(artifact);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(info.directory,'SHA256SUMS.txt'),`${sha256}  ${info.filename}\n`);
  fs.writeFileSync(path.join(info.directory,'release.json'),JSON.stringify({version:info.version,filename:info.filename,bytes:bytes.length,sha256},null,2)+'\n');
  return {...info,bytes:bytes.length,sha256};
}

function run(command) {
  const info = releaseInfo();
  if (command === 'check') { console.log(`버전 일치: ${info.version} · 변경 내역 확인 완료`); return; }
  if (command === 'build') {
    if (process.platform !== 'win32') throw new Error('Windows에서 EXE를 빌드하세요.');
    if (fs.existsSync(path.join(info.directory,info.filename))) throw new Error(`${info.version} EXE가 이미 있습니다. 기존 배포본을 유지하려면 새 버전으로 올린 뒤 빌드하세요.`);
    for (const file of ['tistory.config.json','style/profile.md','style/samples/source-notes.md']) {
      if (!fs.existsSync(path.join(ROOT,file))) throw new Error('먼저 npm run setup으로 로컬 설정을 준비하세요.');
    }
    const result = spawnSync(process.execPath,[path.join(ROOT,'node_modules/electron-builder/cli.js'),'--win','portable','--x64',`--config.directories.output=${info.directory}`],{cwd:ROOT,stdio:'inherit',windowsHide:true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`EXE 빌드 실패 (${result.status ?? result.signal})`);
  } else if (command !== 'checksums') throw new Error('사용법: node scripts/release.mjs check|build|checksums');
  const result = checksums();
  console.log(`배포 파일: ${path.join(result.directory,result.filename)}\nSHA256: ${result.sha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
