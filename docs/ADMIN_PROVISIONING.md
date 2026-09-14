# Admin provisioning

Administrator privileges are never granted through public registration or by matching an e-mail address from environment configuration.

## Provision an existing account

Provisioning requires direct operator access to the application database environment:

```bash
npm run provision:admin -- admin@example.pl
```

The command:

- requires an already existing account,
- validates and normalizes the e-mail argument,
- promotes exactly that account to `ADMIN`,
- records `ADMIN_PROVISIONED_OUT_OF_BAND` in `audit_logs`,
- performs the role change and audit record in one SQLite transaction,
- exposes no public HTTP endpoint for privilege elevation.

For a non-default data location, set the same `DATABASE_PATH` / `DATA_DIR` values used by the application before running the command.

## Security boundary

Public registration always receives the effective non-admin configuration. `ADMIN_EMAILS` is intentionally not supported as a privilege-grant mechanism because the current MVP does not verify ownership of an e-mail address before account creation.

The protected `/api/admin/diagnostics` endpoint authorizes against the persisted `users.role` value. Direct database/operator access is therefore the trust boundary for provisioning in the current single-instance architecture.

Before broad public launch, administrator MFA and a stronger operational identity/provisioning model remain required by the Master Implementation Plan.
