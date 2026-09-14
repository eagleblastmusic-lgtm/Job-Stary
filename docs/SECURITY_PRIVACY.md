# Security and privacy notes

Implemented controls:

- password hashing: `scrypt` + unique salt,
- session token stored in cookie as HttpOnly/SameSite; only SHA-256 hash stored in DB,
- origin check for mutating browser requests when `Origin` is present,
- CSP, `X-Frame-Options`, `nosniff`, permissions policy,
- rate limits for login/registration and offer parsing,
- upload allowlist and size limit,
- uploads stored outside the public directory with restrictive filesystem permissions,
- sensitive audit events,
- account export and deletion,
- analytics property redaction for fields that resemble CV/raw text/name/email,
- AI request logging stores input hash, not raw prompt content,
- Career Truth blocks inferred facts from generated CVs.

Before external beta / large-scale launch still required:

- PostgreSQL + encrypted managed backups and restore test,
- S3-compatible private object storage with signed access,
- malware scanning service for uploads,
- production-grade distributed rate limiter if horizontally scaled,
- formal privacy policy / terms / consent versions reviewed for Poland/EU,
- dependency and secret scanning in CI,
- CSP hardening if third-party telemetry/payments are introduced,
- admin MFA once managed authentication is introduced,
- penetration test before broad public launch.

The product must never derive career matching from health, religion, ethnicity, political views, sexual orientation, family plans, or other protected/sensitive traits.
