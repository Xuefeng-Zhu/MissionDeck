CREATE TABLE IF NOT EXISTS public_demo_model_usage (
  period_start date PRIMARY KEY,
  model_calls integer NOT NULL CHECK (model_calls >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
