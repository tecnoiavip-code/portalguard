# Architecture rules

- Keep emergency alert creation and staff notification atomic in the database RPC; a failed notification must not produce a false success or silently omit the alarm.
- Keep external-database repair SQL as explicit scripts for the user's current database; this preview's managed backend is not the external production database.
- Resolve portal access through the authenticated database RPC and fail closed in both portal guards and every login continuation; missing resident roles must never imply staff access.
- Enforce staff eligibility and resident linkage server-side in role validation and has_role, never through client email comparisons or stored flags.
- Keep external resident extension fields typed locally without modifying generated database types, so preview schema differences do not break compilation.
- Keep Control iD identification responses in a pure function-local module: database grants override local unknown events, database denials never actuate relays, and contingency requires an explicit device grant.