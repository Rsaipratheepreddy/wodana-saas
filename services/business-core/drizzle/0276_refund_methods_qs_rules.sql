-- Palm's second-round answers (plan §0.5 item 13), generic product, values entered by each firm.
--
-- 1. Refund methods with their own timeline (PLM-109). Each payment method (Finance › Requests › Settings) carries
--    the days a refund paid back that way usually takes, after approval (calendar days, as before; empty: no date
--    shown). The single workspace-wide figure becomes every method's starting value. A refund request keeps the
--    days of the method chosen when it was raised, so a later change to the method never moves a promised date.
--    finance_request_settings.refund_days is no longer read; it stays only so a rollback keeps working.
-- 2. QS review only where it applies (PLM-082/083/084). The firm's existing switch stays the master switch; the new
--    scope says whether the QS prices every quotation (as before) or only where the rules apply: the deal's path
--    needs a BOQ, or the quotation has a line in a work package marked for QS review or a catalogue item of a kind
--    marked for QS review. Design Fee proposals and quotations of standard items only skip the QS under the rules.
ALTER TABLE finance_payment_methods ADD COLUMN refund_days integer CHECK (refund_days IS NULL OR refund_days BETWEEN 1 AND 365);
--> statement-breakpoint
UPDATE finance_payment_methods method SET refund_days = settings.refund_days, version = method.version + 1
  FROM finance_request_settings settings
 WHERE settings.workspace_id = method.workspace_id AND settings.refund_days IS NOT NULL AND method.refund_days IS NULL;
--> statement-breakpoint
ALTER TABLE finance_requests ADD COLUMN refund_days integer CHECK (refund_days IS NULL OR refund_days BETWEEN 1 AND 365);
--> statement-breakpoint
ALTER TABLE finance_requests ADD CONSTRAINT finance_requests_refund_days_kind_check CHECK (refund_days IS NULL OR kind = 'refund');
--> statement-breakpoint
-- Refunds raised before keep the workspace figure they were shown.
UPDATE finance_requests request SET refund_days = settings.refund_days
  FROM finance_request_settings settings
 WHERE request.kind = 'refund' AND settings.workspace_id = request.workspace_id AND settings.refund_days IS NOT NULL AND request.refund_days IS NULL;
--> statement-breakpoint
COMMENT ON COLUMN finance_request_settings.refund_days IS 'Superseded by finance_payment_methods.refund_days (0276); not read.';
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings
  ADD COLUMN qs_review_scope varchar(8) NOT NULL DEFAULT 'all' CHECK (qs_review_scope IN ('all', 'rules')),
  ADD COLUMN qs_review_item_types varchar(16)[] NOT NULL DEFAULT '{}'
    CHECK (qs_review_item_types <@ ARRAY['product', 'material', 'assembly', 'service', 'package', 'ready_made']::varchar(16)[]);
--> statement-breakpoint
ALTER TABLE workspace_work_packages ADD COLUMN qs_review boolean NOT NULL DEFAULT false;
