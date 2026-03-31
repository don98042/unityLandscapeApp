CREATE TABLE IF NOT EXISTS quotes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT,
  photo_s3_key   TEXT,
  status         TEXT NOT NULL DEFAULT 'draft',
  subtotal       NUMERIC(10,2),
  discount_type  TEXT,
  discount_value NUMERIC(10,2),
  discount_amt   NUMERIC(10,2),
  discount_note  TEXT,
  total          NUMERIC(10,2),
  submitted_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_code  TEXT NOT NULL,
  description   TEXT,
  qty           NUMERIC(10,2),
  unit          TEXT,
  tier          TEXT,
  unit_price    NUMERIC(10,2),
  total         NUMERIC(10,2),
  confidence    NUMERIC(3,2),
  ai_suggested  BOOLEAN DEFAULT true,
  user_modified BOOLEAN DEFAULT false
);
