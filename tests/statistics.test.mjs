import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function mockDb(authenticated = true) {
  const calls = [];
  return { calls, prepare(sql) { return { bind(...args) { calls.push({sql, args}); return {
    async first() { return authenticated ? {household_id: 42} : null; },
    async all() { return {results: [{month:'2026-01',type:'expense',category_id:3,category_name:'식비',total:1000,count:1}]}; }
  }; } }; } };
}
const request = path => new Request('https://example.test'+path, {headers:{Cookie:'session='+'a'.repeat(64)}});

test('통계는 인증된 가계부와 지정 연도만 조회한다', async () => {
  const db=mockDb();
  const response=await worker.fetch(request('/api/statistics?year=2026'), {DB:db});
  assert.equal(response.status,200);
  assert.equal((await response.json()).groups[0].total,1000);
  const query=db.calls.find(c=>c.sql.includes('AS category_name'));
  assert.deepEqual(query.args,[42,'2026-01-01','2026-12-31']);
  assert.match(query.sql,/t\.subject AS subject/);
  assert.match(query.sql,/GROUP BY[^;]*t\.subject/);
});
test('통계 연도는 인증된 가계부의 거래에서만 조회한다', async () => {
  const calls=[];
  const db={prepare(sql){return {bind(...args){calls.push({sql,args});return {
    async first(){return {household_id:42}},
    async all(){return {results:[{year:'2026'},{year:'2024'}]}}
  }}}}};
  const response=await worker.fetch(request('/api/statistics/years'),{DB:db});
  assert.deepEqual((await response.json()).years,['2026','2024']);
  assert.deepEqual(calls.at(-1).args,[42]);
});
test('통계는 비로그인 요청과 잘못된 연도를 거부한다', async () => {
  const noSession=await worker.fetch(new Request('https://example.test/api/statistics?year=2026'),{DB:mockDb()});
  assert.equal(noSession.status,401);
  const db=mockDb();
  const invalid=await worker.fetch(request('/api/statistics?year=2026x'),{DB:db});
  assert.equal(invalid.status,400);
  assert.equal(db.calls.length,1);
});
