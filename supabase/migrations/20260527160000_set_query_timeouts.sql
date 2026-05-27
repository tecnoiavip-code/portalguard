-- Avoid runaway API queries exhausting the project during unstable network/database periods.

ALTER ROLE anon SET statement_timeout = '20s';
ALTER ROLE authenticated SET statement_timeout = '20s';

ALTER ROLE anon SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE authenticated SET idle_in_transaction_session_timeout = '30s';
