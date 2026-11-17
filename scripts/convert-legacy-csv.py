"""Convert a reviewed legacy CSV into the app's version-1 backup format.

This is offline only. It does not change the source or any database.
"""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path

FIELDS = ['날짜', '입금/출금', '입력자', '주체', '카테고리', '지불 방식', '메모', '금액', '원본파일', '원본행']
TYPES = {'입금': 'income', '지출': 'expense'}
MAX_SAFE = 9007199254740991


def convert(path):
    categories, transactions, category_ids = [], [], {}
    totals = {'income': 0, 'expense': 0}
    with path.open('r', encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != FIELDS:
            raise ValueError('CSV 열 이름이나 순서가 예상 형식과 다릅니다.')
        for line, row in enumerate(reader, start=2):
            try:
                if None in row or any(value is None for value in row.values()):
                    raise ValueError('열 개수가 맞지 않습니다.')
                date = dt.date.fromisoformat(row['날짜'])
                if date.isoformat() != row['날짜']:
                    raise ValueError('날짜 형식이 올바르지 않습니다.')
                kind = TYPES.get(row['입금/출금'])
                if not kind:
                    raise ValueError('수입/지출 구분을 확인하세요.')
                raw_amount = row['금액']
                if not raw_amount.isascii() or not raw_amount.isdigit():
                    raise ValueError('금액이 정수가 아닙니다.')
                amount = int(raw_amount)
                if amount < 1 or amount > MAX_SAFE:
                    raise ValueError('금액이 허용 범위를 벗어났습니다.')
                name = row['카테고리']
                if not name or name != name.strip() or len(name) > 50:
                    raise ValueError('카테고리 이름을 확인하세요.')
                limits = {'메모': 1000, '주체': 100, '지불 방식': 100, '입력자': 1000, '원본파일': 1000, '원본행': 1000}
                if any(len(row[key]) > limit for key, limit in limits.items()):
                    raise ValueError('텍스트 길이가 허용 범위를 벗어났습니다.')
                key = (kind, name)
                if key not in category_ids:
                    category_ids[key] = len(categories) + 1
                    categories.append({'id': category_ids[key], 'type': kind, 'name': name, 'sort_order': len(categories), 'is_active': 1})
                # Source data does not contain creation or modification timestamps.
                timestamp = date.isoformat() + 'T00:00:00.000Z'
                transactions.append({'id': len(transactions)+1, 'category_id': category_ids[key], 'type': kind, 'amount': amount, 'transaction_date': date.isoformat(), 'memo': row['메모'], 'subject': row['주체'] or None, 'payment_method': row['지불 방식'] or None, 'recorded_by': row['입력자'] or None, 'source_file': row['원본파일'] or None, 'source_row': row['원본행'] or None, 'version': 1, 'created_at': timestamp, 'updated_at': timestamp})
                totals[kind] += amount
                if totals[kind] > MAX_SAFE:
                    raise ValueError('합계가 안전한 정수 범위를 벗어났습니다.')
            except (ValueError, KeyError) as exc:
                raise ValueError(f'CSV {line}행: {exc}') from exc
    if not transactions:
        raise ValueError('거래가 없습니다.')
    return {'format': 'couple-account-book', 'version': 1, 'exported_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'categories': categories, 'transactions': transactions}, totals


def main():
    parser = argparse.ArgumentParser(description='기존 가계부 CSV를 복원 가능한 JSON으로 변환합니다.')
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path, help='새로 만들 파일 경로 (기존 파일 덮어쓰기 불가)')
    args = parser.parse_args()
    try:
        backup, totals = convert(args.source)
        with args.output.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(backup, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        print(f"거래 {len(backup['transactions'])}건, 카테고리 {len(backup['categories'])}개, 수입 {totals['income']}원, 지출 {totals['expense']}원")
        print(f'저장: {args.output}')
    except (OSError, ValueError, csv.Error) as exc:
        parser.exit(1, f'변환 실패: {exc}\n')


if __name__ == '__main__':
    main()
