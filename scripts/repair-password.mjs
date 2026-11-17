// Rehash the existing password locally; never print the password or stored hashes.
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { Writable } from 'node:stream';

if (process.argv.slice(2).join(' ') !== '--remote' || !process.stdin.isTTY) {
  console.error('대화형 PowerShell에서 node scripts/repair-password.mjs --remote 를 실행하세요.'); process.exit(1);
}
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function query(sql) {
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'couple-account-book', '--remote', '--json', '--command', sql], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw Error('Cloudflare D1에 연결하지 못했습니다.');
  return JSON.parse(result.stdout)[0].results;
}
try {
  const rows = query('SELECT id, password_hash, auth_version FROM households ORDER BY id LIMIT 1');
  if (rows.length !== 1) throw Error('가계부를 찾을 수 없습니다.');
  const old = rows[0], match = /^pbkdf2-sha256\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(old.password_hash);
  if (!match || +match[1] < 100000 || +match[1] > 2000000 || !Number.isSafeInteger(old.id) || !Number.isSafeInteger(old.auth_version)) throw Error('비밀번호 형식을 확인할 수 없습니다.');
  const rl = readline.createInterface({ input: process.stdin, output: new Writable({ write(_c, _e, cb) { cb(); } }), terminal: true });
  process.stdout.write('기존 가계부 비밀번호: ');
  const password = await new Promise(resolve => rl.question('', resolve)); rl.close(); process.stdout.write('\n');
  const actual = pbkdf2Sync(password, Buffer.from(match[2], 'hex'), +match[1], 32, 'sha256');
  if (!timingSafeEqual(actual, Buffer.from(match[3], 'hex'))) throw Error('기존 비밀번호가 일치하지 않습니다. 변경하지 않았습니다.');
  const salt = randomBytes(16), hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const replacement = `pbkdf2-sha256$100000$${salt.toString('hex')}$${hash.toString('hex')}`;
  const updated = query(`UPDATE households SET password_hash='${replacement}', auth_version=auth_version+1 WHERE id=${old.id} AND auth_version=${old.auth_version} RETURNING id`);
  if (updated.length !== 1) throw Error('가계부 설정이 변경되어 적용하지 않았습니다. 다시 시도하세요.');
  console.log('비밀번호를 유지하면서 로그인 설정을 복구했습니다.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
