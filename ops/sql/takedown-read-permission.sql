-- The takedown trigger runs with the application's invoker privileges.
-- Permit hash checks without granting writes to the suppression ledger.
GRANT SELECT ON TABLE public.dj_takedown_hashes TO evryvibe;
