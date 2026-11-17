import { validateBackup } from './backup.js';
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
async function makePasswordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 600000;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256);
  return `pbkdf2-sha256$${iterations}$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  const [algorithm, iterations, salt, expected] = stored.split('$');
  if (algorithm !== 'pbkdf2-sha256' || !/^\d+$/.test(iterations) || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(expected) || Number(iterations) < 100000 || Number(iterations) > 2000000) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt.match(/../g), x => parseInt(x, 16)), iterations: Number(iterations) }, key, 256));
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function cookie(request) { return request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8); }
async function session(request, db) {
  const token = cookie(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return db.prepare('SELECT s.household_id FROM sessions s JOIN households h ON h.id = s.household_id AND h.auth_version = s.auth_version WHERE s.token_hash = ? AND s.expires_at > ?').bind(await digest(token), new Date().toISOString()).first();
}
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin === new URL(request.url).origin && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}
const RESTORE_LIMIT = 1500000;
async function readLimited(request, limit) {
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > limit) throw Error('too large');
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw Error('too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { throw Error('invalid'); }
}
async function body(request) {
  const value = JSON.parse(await readLimited(request, 8192));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid');
  return value;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, db = env.DB;
    if (path === '/api/health' && request.method === 'GET') { try { await db.prepare('SELECT 1').first(); return json({ok:true}); } catch { return json({ok:false},503); } }
    if (!path.startsWith('/api/')) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if (!['GET','HEAD'].includes(request.method) && !sameOrigin(request)) return json({error:'요청 출처를 확인할 수 없습니다.'},403);
    try {
      if (path === '/api/session' && request.method === 'POST') {
        const data = await body(request); if (typeof data.password !== 'string' || data.password.length > 256) return json({error:'비밀번호를 확인해 주세요.'},400);
        // D1's atomic counter enforces a shared, persistent limit across Worker instances.
        const now = Date.now(), windowStart = Math.floor(now / 60000) * 60000;
        const limit = await db.prepare('INSERT INTO login_attempts (window_start, attempts) VALUES (?, 1) ON CONFLICT(window_start) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(windowStart).first();
        if (limit.attempts > 10) return json({error:'잠시 후 다시 시도해 주세요.'},429,{'Retry-After':String(Math.ceil((windowStart + 60000 - now)/1000))});
        const household = await db.prepare('SELECT id, password_hash, auth_version FROM households ORDER BY id LIMIT 1').first();
        if (!household || !(await verifyPassword(data.password, household.password_hash))) return json({error:'비밀번호를 확인해 주세요.'},401);
        const token = hex(crypto.getRandomValues(new Uint8Array(32))), expires = new Date(now + 7*86400000).toISOString();
        const inserted = await db.prepare('INSERT INTO sessions (token_hash, household_id, expires_at, auth_version) SELECT ?, id, ?, auth_version FROM households WHERE id = ? AND auth_version = ?').bind(await digest(token), expires, household.id, household.auth_version).run();
        if (!inserted.meta.changes) return json({error:'비밀번호가 변경되었습니다. 다시 로그인해 주세요.'},401);
        const secure = url.protocol === 'https:' ? '; Secure' : '';
        return json({ok:true},200,{'Set-Cookie':`session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`});
      }
      const auth = await session(request, db); if (!auth) return json({error:'로그인이 필요합니다.'},401);
      if (path === '/api/password' && request.method === 'POST') {
        const d=await body(request);
        if (typeof d.current_password !== 'string' || d.current_password.length > 256 || typeof d.new_password !== 'string' || d.new_password.length < 12 || d.new_password.length > 256 || d.new_password === d.current_password) return json({error:'새 비밀번호는 현재 비밀번호와 다른 12~256자여야 합니다.'},400);
        const now=Date.now(), windowStart=Math.floor(now / 60000)*60000;
        const limit=await db.prepare('INSERT INTO login_attempts (window_start, attempts) VALUES (?, 1) ON CONFLICT(window_start) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(windowStart).first();
        if (limit.attempts > 10) return json({error:'잠시 후 다시 시도해 주세요.'},429,{'Retry-After':String(Math.ceil((windowStart+60000-now)/1000))});
        const household=await db.prepare('SELECT password_hash, auth_version FROM households WHERE id = ?').bind(auth.household_id).first();
        if (!household || !(await verifyPassword(d.current_password,household.password_hash))) return json({error:'현재 비밀번호를 확인해 주세요.'},401);
        const hash=await makePasswordHash(d.new_password);
        const updated=await db.prepare('UPDATE households SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ? AND auth_version = ?').bind(hash,auth.household_id,household.auth_version).run();
        if (!updated.meta.changes) return json({error:'비밀번호가 이미 변경되었습니다. 다시 로그인해 주세요.'},409);
        return json({ok:true},200,{'Set-Cookie':`session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`});
      }
      if (path === '/api/restore' && request.method === 'POST') {
        let raw; try { raw=await readLimited(request,RESTORE_LIMIT); } catch(e) { if(e.message==='too large') return json({error:'백업 파일은 1,500,000바이트 이하여야 합니다.'},413); throw e; }
        let backup,summary; try { backup=JSON.parse(raw); summary=validateBackup(backup); } catch(e) { return json({error:'백업 파일이 올바르지 않습니다: '+e.message},400); }
        if (backup.categories.length + backup.transactions.length === 0) return json({error:'빈 백업은 복원할 수 없습니다.'},400);
        try {
          await db.batch([
            db.prepare('INSERT INTO restore_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM categories WHERE household_id = ?) OR EXISTS(SELECT 1 FROM transactions WHERE household_id = ?) THEN 0 ELSE 1 END').bind(auth.household_id,auth.household_id),
            db.prepare("INSERT INTO categories (household_id,type,name,sort_order,is_active) SELECT ?, json_extract(value,'$.type'), json_extract(value,'$.name'), json_extract(value,'$.sort_order'), json_extract(value,'$.is_active') FROM json_each(?, '$.categories')").bind(auth.household_id,raw),
            db.prepare("INSERT INTO transactions (household_id,category_id,type,amount,transaction_date,memo,subject,payment_method,recorded_by,source_file,source_row,version,created_at,updated_at) SELECT ?, c.id, json_extract(t.value,'$.type'), json_extract(t.value,'$.amount'), json_extract(t.value,'$.transaction_date'), json_extract(t.value,'$.memo'), json_extract(t.value,'$.subject'), json_extract(t.value,'$.payment_method'), json_extract(t.value,'$.recorded_by'), json_extract(t.value,'$.source_file'), json_extract(t.value,'$.source_row'), json_extract(t.value,'$.version'), json_extract(t.value,'$.created_at'), json_extract(t.value,'$.updated_at') FROM json_each(?, '$.transactions') t JOIN json_each(?, '$.categories') b ON json_extract(b.value,'$.id') = json_extract(t.value,'$.category_id') JOIN categories c ON c.household_id = ? AND c.type = json_extract(b.value,'$.type') AND c.name = json_extract(b.value,'$.name')").bind(auth.household_id,raw,raw,auth.household_id),
            db.prepare('DELETE FROM restore_guard')
          ]);
        } catch(e) { if (String(e).includes('CHECK constraint failed: value = 1')) return json({error:'복원은 카테고리와 거래가 모두 없는 가계부에서만 가능합니다.'},409); throw e; }
        return json({ok:true,summary});
      }
      if (path === '/api/backup' && request.method === 'GET') {
        const [categories,transactions] = await db.batch([
          db.prepare('SELECT id,type,name,sort_order,is_active FROM categories WHERE household_id = ? ORDER BY id').bind(auth.household_id),
          db.prepare('SELECT id,category_id,type,amount,transaction_date,memo,subject,payment_method,recorded_by,source_file,source_row,version,created_at,updated_at FROM transactions WHERE household_id = ? ORDER BY id').bind(auth.household_id)
        ]);
        return json({format:'couple-account-book',version:1,exported_at:new Date().toISOString(),categories:categories.results,transactions:transactions.results},200,{'Content-Disposition':'attachment; filename="account-book-backup.json"'});
      }
      if (path === '/api/session' && request.method === 'GET') return json({ok:true});
      if (path === '/api/session' && request.method === 'DELETE') { await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(cookie(request))).run(); return json({ok:true},200,{'Set-Cookie':`session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`}); }
      if (path === '/api/categories' && request.method === 'GET') { const all = url.searchParams.get('all') === '1'; const result = await db.prepare('SELECT id, type, name, sort_order, is_active FROM categories WHERE household_id = ? AND (? = 1 OR is_active = 1) ORDER BY type, sort_order, id').bind(auth.household_id,all ? 1 : 0).all(); return json({categories:result.results}); }
      if (path === '/api/categories' && request.method === 'POST') {
        const d = await body(request); if (!['income','expense'].includes(d.type) || typeof d.name !== 'string' || !d.name.trim() || d.name.trim().length > 50) return json({error:'카테고리 정보를 확인해 주세요.'},400);
        const exists = await db.prepare('SELECT id FROM categories WHERE household_id = ? AND type = ? AND name = ?').bind(auth.household_id,d.type,d.name.trim()).first(); if (exists) return json({error:'같은 이름의 카테고리가 이미 있습니다.'},409);
        const result = await db.prepare('INSERT INTO categories (household_id,type,name,sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM categories WHERE household_id = ? AND type = ?), 0))').bind(auth.household_id,d.type,d.name.trim(),auth.household_id,d.type).run(); return json({id:result.meta.last_row_id},201);
      }
      const categoryMatch = path.match(/^\/api\/categories\/(\d+)$/);
      if (categoryMatch && request.method === 'PATCH') {
        const id=Number(categoryMatch[1]), d=await body(request); if (!Number.isSafeInteger(id) || id < 1 || typeof d.name !== 'string' || !d.name.trim() || d.name.trim().length > 50 || !Number.isSafeInteger(d.sort_order) || d.sort_order < 0 || d.sort_order > 100000 || ![0,1].includes(d.is_active)) return json({error:'카테고리 정보를 확인해 주세요.'},400);
        const current=await db.prepare('SELECT type FROM categories WHERE id = ? AND household_id = ?').bind(id,auth.household_id).first(); if (!current) return json({error:'카테고리를 찾을 수 없습니다.'},404);
        const exists=await db.prepare('SELECT id FROM categories WHERE household_id = ? AND type = ? AND name = ? AND id != ?').bind(auth.household_id,current.type,d.name.trim(),id).first(); if (exists) return json({error:'같은 이름의 카테고리가 이미 있습니다.'},409);
        await db.prepare('UPDATE categories SET name = ?, sort_order = ?, is_active = ? WHERE id = ? AND household_id = ?').bind(d.name.trim(),d.sort_order,d.is_active,id,auth.household_id).run(); return json({ok:true});
      }
      if (path === '/api/transactions' && request.method === 'GET') {
        const date = url.searchParams.get('date'); if (!date || !validDate(date)) return json({error:'올바른 날짜가 필요합니다.'},400);
        const result = await db.prepare('SELECT t.id, t.type, t.amount, t.transaction_date, t.memo, t.subject, t.payment_method, t.version, c.id AS category_id, c.name AS category_name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.household_id = ? AND t.transaction_date = ? ORDER BY t.id DESC').bind(auth.household_id,date).all(); return json({transactions:result.results});
      }
      if (path === '/api/calendar' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({error:'올바른 월이 필요합니다.'},400);
        const result = await db.prepare("SELECT transaction_date, type, SUM(amount) AS total FROM transactions WHERE household_id = ? AND transaction_date >= ? AND transaction_date < date(?, '+1 month') GROUP BY transaction_date, type").bind(auth.household_id,month+'-01',month+'-01').all();
        return json({days:result.results});
      }
      const match = path.match(/^\/api\/transactions\/(\d+)$/);
      if (match && ['PATCH','DELETE'].includes(request.method)) {
        const id = Number(match[1]), d = await body(request);
        if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(d.version) || d.version < 1) return json({error:'버전을 확인해 주세요.'},400);
        const current = await db.prepare('SELECT version FROM transactions WHERE id = ? AND household_id = ?').bind(id,auth.household_id).first();
        if (!current) return json({error:'거래를 찾을 수 없습니다.'},404);
        if (current.version !== d.version) return json({error:'다른 곳에서 변경된 거래입니다. 최신 내용을 다시 불러와 주세요.'},409);
        let result;
        if (request.method === 'DELETE') {
          result = await db.prepare('DELETE FROM transactions WHERE id = ? AND household_id = ? AND version = ?').bind(id,auth.household_id,d.version).run();
        } else {
          if (!['income','expense'].includes(d.type) || !Number.isSafeInteger(d.amount) || d.amount <= 0 || !Number.isSafeInteger(d.category_id) || d.category_id <= 0 || typeof d.transaction_date !== 'string' || !validDate(d.transaction_date) || (d.memo !== undefined && (typeof d.memo !== 'string' || d.memo.length > 1000)) || (d.subject != null && (typeof d.subject !== 'string' || d.subject.length > 100)) || (d.payment_method != null && (typeof d.payment_method !== 'string' || d.payment_method.length > 100))) return json({error:'거래 입력값을 확인해 주세요.'},400);
          const category = await db.prepare('SELECT id FROM categories WHERE id = ? AND household_id = ? AND type = ? AND (is_active = 1 OR id = (SELECT category_id FROM transactions WHERE id = ? AND household_id = ?))').bind(d.category_id,auth.household_id,d.type,id,auth.household_id).first();
          if (!category) return json({error:'카테고리를 확인해 주세요.'},400);
          result = await db.prepare("UPDATE transactions SET category_id = ?, type = ?, amount = ?, transaction_date = ?, memo = ?, subject = ?, payment_method = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND household_id = ? AND version = ?").bind(d.category_id,d.type,d.amount,d.transaction_date,d.memo ?? '',d.subject ?? null,d.payment_method ?? null,id,auth.household_id,d.version).run();
        }
        if (!result.meta.changes) return json({error:'다른 곳에서 변경된 거래입니다. 최신 내용을 다시 불러와 주세요.'},409);
        return json({ok:true});
      }
      if (path === '/api/transactions' && request.method === 'POST') {
        const d = await body(request);
        if (!['income','expense'].includes(d.type) || !Number.isSafeInteger(d.amount) || d.amount <= 0 || !Number.isSafeInteger(d.category_id) || d.category_id <= 0 || typeof d.transaction_date !== 'string' || !validDate(d.transaction_date) || (d.memo !== undefined && (typeof d.memo !== 'string' || d.memo.length > 1000)) || (d.subject != null && (typeof d.subject !== 'string' || d.subject.length > 100)) || (d.payment_method != null && (typeof d.payment_method !== 'string' || d.payment_method.length > 100))) return json({error:'거래 입력값을 확인해 주세요.'},400);
        const category = await db.prepare('SELECT id FROM categories WHERE id = ? AND household_id = ? AND type = ? AND is_active = 1').bind(d.category_id,auth.household_id,d.type).first(); if (!category) return json({error:'카테고리를 확인해 주세요.'},400);
        const result = await db.prepare('INSERT INTO transactions (household_id, category_id, type, amount, transaction_date, memo, subject, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(auth.household_id,d.category_id,d.type,d.amount,d.transaction_date,d.memo ?? '',d.subject ?? null,d.payment_method ?? null).run();
        return json({id:result.meta.last_row_id},201);
      }
      return json({error:'찾을 수 없습니다.'},404);
    } catch (error) { if (error instanceof SyntaxError || error.message === 'too large' || error.message === 'invalid') return json({error:'요청 형식이 올바르지 않습니다.'},400); console.error('Request failed', error); return json({error:'요청을 처리하지 못했습니다.'},500); }
  }
};
