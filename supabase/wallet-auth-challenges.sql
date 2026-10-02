-- Shared challenge storage for serverless deployments. The nonce can be
-- issued by one function instance and verified/consumed by another.
CREATE TABLE IF NOT EXISTS public.wallet_auth_challenges (
  nonce text PRIMARY KEY,
  wallet_address text NOT NULL,
  ip_address text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS wallet_auth_challenges_wallet_expiry_idx
  ON public.wallet_auth_challenges (wallet_address, expires_at);

CREATE INDEX IF NOT EXISTS wallet_auth_challenges_expiry_idx
  ON public.wallet_auth_challenges (expires_at);

ALTER TABLE public.wallet_auth_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wallet_auth_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.wallet_auth_challenges TO service_role;
