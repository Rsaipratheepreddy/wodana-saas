-- Petty cash reaches the accounting system: a claim, once reimbursed, posts as an expense from the company's
-- petty cash account (or whichever account it's paid from) to its petty cash expense account.
ALTER TABLE accounting_links ADD COLUMN petty_cash_account_id varchar(120), ADD COLUMN petty_cash_paid_from_id varchar(120);
--> statement-breakpoint
ALTER TABLE accounting_postings DROP CONSTRAINT accounting_postings_kind_check;
--> statement-breakpoint
ALTER TABLE accounting_postings ADD CONSTRAINT accounting_postings_kind_check
  CHECK (kind IN ('invoice', 'credit_note', 'invoice_payment', 'bill', 'bill_payment', 'bill_payment_void', 'expense'));
