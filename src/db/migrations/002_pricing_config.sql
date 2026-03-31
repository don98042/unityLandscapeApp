CREATE TABLE IF NOT EXISTS pricing_config (
  service_code  TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('per_unit','per_tier','time_based')),
  unit_rate     NUMERIC(10,2),
  unit_label    TEXT,
  tier_sm       NUMERIC(10,2),
  tier_md       NUMERIC(10,2),
  tier_lg       NUMERIC(10,2),
  min_charge    NUMERIC(10,2),
  active        BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);

INSERT INTO pricing_config VALUES
  ('tree_removal',   'Tree removal',   'per_unit',   85.00, 'ft',    NULL,  NULL,   NULL,   NULL,  true, now(), 'system'),
  ('stump_grinding', 'Stump grinding', 'per_unit',    3.50, 'in',    NULL,  NULL,   NULL,  50.00,  true, now(), 'system'),
  ('hedge_shaping',  'Hedge shaping',  'per_unit',    4.50, 'lin_ft',NULL,  NULL,   NULL,   NULL,  true, now(), 'system'),
  ('lawn_mowing',    'Lawn mowing',    'per_unit',    0.04, 'sqft',  NULL,  NULL,   NULL,   NULL,  true, now(), 'system'),
  ('shrub_trimming', 'Shrub trimming', 'per_tier',    NULL,  NULL,  25.00, 45.00,  70.00,   NULL,  true, now(), 'system'),
  ('shrub_removal',  'Shrub removal',  'per_tier',    NULL,  NULL,  40.00, 75.00, 120.00,   NULL,  true, now(), 'system'),
  ('general_labor',  'General labor',  'time_based',  65.00, 'hr',   NULL,  NULL,   NULL,   NULL,  true, now(), 'system'),
  ('crew_2man',      '2-man crew',     'time_based', 110.00, 'hr',   NULL,  NULL,   NULL,   NULL,  true, now(), 'system')
ON CONFLICT (service_code) DO NOTHING;
