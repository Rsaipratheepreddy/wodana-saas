-- §0.3 P8 (guide J): the design fee is invoiced before any project exists (the design deal is its own sale). A tax
-- invoice keeps its project when it has one; an invoice for an accepted design quotation may have none. Idempotent.
ALTER TABLE client_invoices ALTER COLUMN project_id DROP NOT NULL;
