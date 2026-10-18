-- Guide M (16 Oct 2026): a discount is approved by the firm's chosen role (the Creative Director at the firm that asked)
-- before the proposal goes out, and Finance confirms it before Received / Approved. The firm's choice of role; unset keeps
-- "anyone who approves quotes". Configuration column; idempotent.
ALTER TABLE workspace_quotation_settings ADD COLUMN IF NOT EXISTS discount_approver_role varchar(60)
  CHECK (discount_approver_role IS NULL OR discount_approver_role ~ '^[a-z][a-z0-9_]{1,59}$');
