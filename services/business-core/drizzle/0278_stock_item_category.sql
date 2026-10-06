-- A stock item's category (a materials list's tab, block title or category column), so the stock list can show and
-- filter by it. Empty when the item has none. A column on an existing tenant table (forced RLS unchanged); nothing is
-- backfilled: refreshing an import fills it. Idempotent; never disables RLS.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS category varchar(160) NOT NULL DEFAULT '';
