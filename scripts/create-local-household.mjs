// Run interactively: node scripts/create-local-household.mjs. No password is written to disk.
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
const empty = process.argv.includes('--empty');
if (process.argv.slice(2).some(arg => arg !== '--empty')) { console.error('사용법: node scripts/create-local-household.mjs [--empty]'); process.exit(1); }
if (!process.stdin.isTTY) { console.error('대화형 터미널에서 실행해 주세요.'); process.exit(1); }
const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
process.stdout.write('로컬 전용 공용 비밀번호 (8자 이상): ');
const password = await new Promise(resolve => rl.question('', resolve)); rl.close(); process.stdout.write('\n');
if (password.length < 8 || password.length > 256) { console.error('8~256자로 입력해 주세요.'); process.exit(1); }
const salt = randomBytes(16), hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const stored = `pbkdf2-sha256$100000$${salt.toString('hex')}$${hash.toString('hex')}`;
const sql = `INSERT INTO households (id,name,password_hash) VALUES (1,'우리 가계부','${stored}') ON CONFLICT(id) DO NOTHING; INSERT INTO categories (household_id,type,name,sort_order) SELECT 1, type, name, ordering FROM (SELECT 'expense' type, '식비' name, 1 ordering UNION ALL SELECT 'expense','생활용품',2 UNION ALL SELECT 'expense','주거',3 UNION ALL SELECT 'expense','교통',4 UNION ALL SELECT 'expense','의료',5 UNION ALL SELECT 'expense','문화',6 UNION ALL SELECT 'expense','기타',7 UNION ALL SELECT 'income','급여',1 UNION ALL SELECT 'income','상여',2 UNION ALL SELECT 'income','기타수입',3) WHERE EXISTS (SELECT 1 FROM households WHERE id=1) ON CONFLICT(household_id,type,name) DO NOTHING;`;
// Wrangler receives only the salted hash, never the plaintext password.
const command = empty ? sql.slice(0, sql.indexOf(';') + 1) : sql;
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const result = spawnSync(process.execPath, [wrangler,'d1','execute','couple-account-book','--local','--command',command], {stdio:'inherit', windowsHide:true});
if (result.error || result.status !== 0) { console.error(result.error || '초기화 실패'); process.exit(1); }
console.log('로컬 가계부가 준비되었습니다. 기존 가계부가 있었다면 비밀번호는 변경되지 않았습니다.');
