import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../src/backup.js';
const valid = () => ({format:'couple-account-book',version:1,exported_at:'2026-11-17T00:00:00Z',categories:[{id:1,type:'expense',name:'식비',sort_order:0,is_active:1}],transactions:[{id:1,category_id:1,type:'expense',amount:1500,transaction_date:'2026-11-17',memo:'점심',subject:'남편',payment_method:null,recorded_by:null,source_file:null,source_row:null,version:1,created_at:'2026-11-17T00:00:00Z',updated_at:'2026-11-17T00:00:00Z'}]});
test('유효한 백업의 건수와 합계를 계산한다',()=>{const result=validateBackup(valid());assert.equal(result.transactions,1);assert.equal(result.expense,1500);assert.equal(result.income,0)});
test('거래의 카테고리가 없거나 유형이 다르면 거부한다',()=>{const b=valid();b.transactions[0].category_id=2;assert.throws(()=>validateBackup(b));b.transactions[0].category_id=1;b.transactions[0].type='income';assert.throws(()=>validateBackup(b))});
test('실제 없는 날짜와 잘못된 금액을 거부한다',()=>{const b=valid();b.transactions[0].transaction_date='2026-02-30';assert.throws(()=>validateBackup(b));b.transactions[0].transaction_date='2026-02-28';b.transactions[0].amount=1.5;assert.throws(()=>validateBackup(b))});
test('중복 카테고리와 거래 ID를 거부한다',()=>{const b=valid();b.categories.push({...b.categories[0],id:2});assert.throws(()=>validateBackup(b));b.categories.pop();b.transactions.push({...b.transactions[0]});assert.throws(()=>validateBackup(b))});
