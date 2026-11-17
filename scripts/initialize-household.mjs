// Initialize one empty D1 database. The plaintext password stays in this process.
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const args=process.argv.slice(2), remote=args.includes('--remote'), local=args.includes('--local');
const persistIndex=args.indexOf('--persist-to');
const persist=persistIndex>=0 ? args[persistIndex+1] : undefined;
const validArgs=args.filter((arg,i)=>arg==='--local'||arg==='--remote'||arg==='--persist-to'||(persistIndex>=0 && i===persistIndex+1));
if (remote===local || validArgs.length!==args.length || (persistIndex>=0 && (!persist || persist.startsWith('--') || remote)) || args.filter(x=>x==='--local').length>1 || args.filter(x=>x==='--remote').length>1 || args.filter(x=>x==='--persist-to').length>1) {
  console.error('사용법: node scripts/initialize-household.mjs (--local [--persist-to 경로] | --remote)'); process.exit(2);
}
if (!process.stdin.isTTY) { console.error('대화형 터미널에서 실행해 주세요.'); process.exit(1); }
const out=new Writable({write(_chunk,_encoding,callback){callback()}});
const rl=readline.createInterface({input:process.stdin,output:out,terminal:true});
async function ask(label){process.stdout.write(label);const value=await new Promise(resolve=>rl.question('',resolve));process.stdout.write('\n');return value}
const password=await ask(`${remote?'원격':'로컬'} 가계부의 새 공용 비밀번호 (8~256자): `);
const confirmation=await ask('새 비밀번호 확인: ');rl.close();
if(password.length<8||password.length>256||password!==confirmation){console.error('비밀번호 길이나 확인 입력이 올바르지 않습니다.');process.exit(1)}
const salt=randomBytes(16), hash=pbkdf2Sync(password,salt,100000,32,'sha256');
const stored=`pbkdf2-sha256$100000$${salt.toString('hex')}$${hash.toString('hex')}`;
// A single conditional insert prevents overwriting an existing household, even under concurrent initializations.
const sql=`INSERT INTO households (id,name,password_hash) SELECT 1,'우리 가계부','${stored}' WHERE NOT EXISTS (SELECT 1 FROM households) RETURNING id;`;
const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const cli=[wrangler,'d1','execute','couple-account-book',remote?'--remote':'--local','--json','--command',sql];
if(persist)cli.push('--persist-to',persist);
const result=spawnSync(process.execPath,cli,{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
if(result.error||result.status!==0){console.error('초기화 실패. 스키마와 Cloudflare 연결 상태를 확인하세요.');process.exit(1)}
let rows;try{rows=JSON.parse(result.stdout)[0].results}catch{console.error('초기화 결과를 확인하지 못했습니다. DB 상태를 먼저 확인하세요.');process.exit(1)}
if(rows.length!==1){console.error('이미 가계부가 있어 변경하지 않았습니다.');process.exit(1)}
console.log(`${remote?'원격':'로컬'} 빈 가계부를 생성했습니다. 카테고리는 직접 추가하거나 백업을 복원해 주세요.`);
