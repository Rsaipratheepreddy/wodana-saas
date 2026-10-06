-- A catalogue import link's prices can be approved list prices (a supplier's or the firm's official price list):
-- imported by a member who may approve prices, they go live in the catalogue's default price book instead of waiting
-- in draft for review. Configuration on an existing tenant table (forced RLS and its policy unchanged); off for every
-- existing link. Idempotent; never disables RLS.
ALTER TABLE import_links ADD COLUMN IF NOT EXISTS approved_prices boolean NOT NULL DEFAULT false;
