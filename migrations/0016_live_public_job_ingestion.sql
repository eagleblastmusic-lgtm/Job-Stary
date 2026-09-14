UPDATE job_source_registry
SET enabled=1,
    terms_metadata='{"searchMode":"AUTO_IMPORT","ingestionStatus":"PUBLIC_WEB_ACTIVE","checkedAt":"2026-09-13","notes":"Bounded automatic read of public HTML pages only. No login, CAPTCHA bypass, private endpoints or access-control circumvention. Source may block requests and then fails closed."}',
    health_status='UNKNOWN',
    health_message='Public-page ingestion enabled; health is checked at runtime.',
    updated_at=datetime('now')
WHERE key IN ('pracuj','rocketjobs','justjoinit','olx','indeed','linkedin');

UPDATE job_source_registry
SET terms_metadata='{"searchMode":"DIRECT_CAREER_PAGES","ingestionStatus":"PERMITTED_SOURCE_REQUIRED","checkedAt":"2026-09-13","notes":"Employer career pages require an explicit allowlist/feed configuration before automatic ingestion."}',
    updated_at=datetime('now')
WHERE key='employer_careers';
