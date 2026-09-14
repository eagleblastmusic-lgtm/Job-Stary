# Admin instructions

Administrator privileges are provisioned out of band. Public registration never grants `ADMIN` based on an e-mail allow-list.

## Provision an existing account

1. Register the account normally through the application.
2. From an operator environment with direct access to the same database, run:

```bash
DATABASE_PATH=/app/data/job.sqlite npm run provision:admin -- admin@example.pl
```

The command promotes the existing account and records `ADMIN_PROVISIONED_OUT_OF_BAND` in `audit_logs` in the same transaction.

There is no public privilege-elevation endpoint and `ADMIN_EMAILS` is intentionally not a supported authorization mechanism.

Protected endpoint:

`GET /api/admin/diagnostics`

It reports aggregate counts, recent AI failures and feature-flag state. It intentionally does not expose raw CVs or sensitive user content.

See `docs/ADMIN_PROVISIONING.md` for the security boundary and operational details. Administrator MFA remains required before broad public launch.
