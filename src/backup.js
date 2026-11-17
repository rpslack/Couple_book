const fail = message => { throw new Error(message); };
const isId = x => Number.isSafeInteger(x) && x > 0;
const text = (x, max, nullable = false) => (nullable && x === null) || (typeof x === 'string' && x.length <= max);
const validDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function validateBackup(backup) {
  if (!backup || backup.format !== 'couple-account-book' || backup.version !== 1 || !Array.isArray(backup.categories) || !Array.isArray(backup.transactions)) fail('지원하지 않는 백업 형식입니다.');
  const categories = new Map(), names = new Set(), transactions = new Set();
  for (const c of backup.categories) {
    if (!isId(c.id) || categories.has(c.id) || !['income','expense'].includes(c.type) || !text(c.name,50) || !c.name.trim() || c.name!==c.name.trim() || !Number.isSafeInteger(c.sort_order) || c.sort_order<0 || c.sort_order>100000 || ![0,1].includes(c.is_active)) fail('잘못된 카테고리가 있습니다.');
    const key=JSON.stringify([c.type,c.name]); if(names.has(key)) fail('중복 카테고리가 있습니다.'); names.add(key);categories.set(c.id,c);
  }
  let income=0,expense=0;
  for (const t of backup.transactions) {
    const c=categories.get(t.category_id);
    if (!isId(t.id) || transactions.has(t.id) || !c || c.type!==t.type || !Number.isSafeInteger(t.amount) || t.amount<=0 || !validDate(t.transaction_date) || !text(t.memo,1000) || !text(t.subject,100,true) || !text(t.payment_method,100,true) || !text(t.recorded_by,1000,true) || !text(t.source_file,1000,true) || !text(t.source_row,1000,true) || !isId(t.version) || !text(t.created_at,100) || !text(t.updated_at,100)) fail('잘못된 거래 또는 카테고리 연결이 있습니다.');
    transactions.add(t.id); if(t.type==='income')income+=t.amount; else expense+=t.amount;
    if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense)) fail('합계가 안전한 정수 범위를 벗어났습니다.');
  }
  return {valid:true,categories:categories.size,transactions:transactions.size,income,expense,exported_at:backup.exported_at};
}
