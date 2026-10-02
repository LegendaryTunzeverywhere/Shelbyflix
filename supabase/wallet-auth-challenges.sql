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

-- A verified wallet signature establishes a short-lived session so routine
-- interactions don't prompt the wallet to sign every individual action.
CREATE TABLE IF NOT EXISTS public.wallet_auth_sessions (
  session_hash text PRIMARY KEY,
  wallet_address text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_auth_sessions_wallet_expiry_idx
  ON public.wallet_auth_sessions (wallet_address, expires_at);

CREATE INDEX IF NOT EXISTS wallet_auth_sessions_expiry_idx
  ON public.wallet_auth_sessions (expires_at);

ALTER TABLE public.wallet_auth_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wallet_auth_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.wallet_auth_sessions TO service_role;
