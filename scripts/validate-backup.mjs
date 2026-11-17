import { readFile, stat } from 'node:fs/promises';
import { validateBackup } from '../src/backup.js';
const path=process.argv[2];
if (!path || process.argv.length!==3) { console.error('사용법: node scripts/validate-backup.mjs <백업.json>'); process.exit(2); }
try { if ((await stat(path)).size > 20*1024*1024) throw Error('백업 파일이 20MB를 초과합니다.'); const backup=JSON.parse(await readFile(path,'utf8')); console.log(JSON.stringify(validateBackup(backup),null,2)); } catch(error) { console.error('검증 실패:',error.message); process.exit(1); }
