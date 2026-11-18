ALTER TABLE transactions DROP COLUMN payment_method;

WITH ranked AS MATERIALIZED (
  SELECT c.id, ROW_NUMBER() OVER (
    PARTITION BY c.household_id, c.type
    ORDER BY COUNT(t.id) DESC, c.sort_order ASC, c.name COLLATE NOCASE ASC, c.id ASC
  ) - 1 AS new_order
  FROM categories c
  LEFT JOIN transactions t ON t.category_id = c.id AND t.household_id = c.household_id
  GROUP BY c.id
)
UPDATE categories SET sort_order = (SELECT new_order FROM ranked WHERE ranked.id = categories.id);
