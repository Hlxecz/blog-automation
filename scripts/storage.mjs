import fs from 'node:fs';
import path from 'node:path';

const check = condition => {
  if (!condition) throw Object.assign(new Error('자료 폴더 경로를 확인할 수 없어 삭제하지 않았습니다.'), { status: 409 });
};
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
function bytesIn(directory) {
  const stat = fs.lstatSync(directory);
  check(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()));
  return stat.isFile() ? stat.size : fs.readdirSync(directory).reduce((bytes, name) => bytes + bytesIn(path.join(directory, name)), 0);
}

// Derive both targets from the job ID, never from a saved draft's metadata.
export function jobStorage(root, bases, id) {
  check(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(id));
  const workspace = path.resolve(root), realWorkspace = fs.realpathSync.native(workspace);
  const targets = [];
  let bytes = 0;
  for (const directory of bases) {
    const base = path.resolve(directory), target = path.resolve(base, id);
    check(inside(workspace, base) && path.dirname(target) === base);
    if (!fs.existsSync(base)) continue;
    const realBase = fs.realpathSync.native(base);
    check(!fs.lstatSync(base).isSymbolicLink() && realBase === path.resolve(realWorkspace, path.relative(workspace, base)));
    let stat;
    try { stat = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    check(stat.isDirectory() && !stat.isSymbolicLink());
    const realTarget = fs.realpathSync.native(target);
    check(inside(realBase, realTarget) && path.dirname(realTarget) === realBase);
    bytes += bytesIn(realTarget); // Validate the entire tree before deleting either target.
    targets.push(realTarget);
  }
  return { bytes, targets };
}

export function deleteJobStorage(root, bases, id) {
  const storage = jobStorage(root, bases, id);
  try {
    // Remove snapshots first, keeping the inbox entry available if removal fails.
    for (const target of storage.targets.toReversed()) fs.rmSync(target, { recursive: true });
  } catch {
    throw Object.assign(new Error('일부 자료를 삭제하지 못했습니다. 이 글의 파일을 사용하는 프로그램을 닫고 다시 삭제해 주세요.'), { status: 409 });
  }
  return storage.bytes;
}
