# Architecture rules

- Keep emergency alert creation and staff notification atomic in the database RPC; a failed notification must not produce a false success or silently omit the alarm.
- Keep external-database repair SQL as explicit scripts for the user's current database; this preview's managed backend is not the external production database.