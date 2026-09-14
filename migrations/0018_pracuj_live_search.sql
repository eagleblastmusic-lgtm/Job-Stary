UPDATE job_source_registry
SET enabled=1,
    terms_metadata='{"searchMode":"AUTO_IMPORT","ingestionStatus":"PUBLIC_WEB_ACTIVE","checkedAt":"2026-09-13","referenceUrl":"https://www.pracuj.pl/robots.txt","notes":"Dedicated Pracuj.pl importer reads only public /praca/ result/detail pages. It checks robots.txt before every live network fetch cycle, follows bounded public pagination, never logs in or uses private endpoints, and fails closed on 401/403/429/CAPTCHA or a future robots.txt disallow for /praca/. A short cache may serve already-fetched records without another Pracuj request. No partnership or official API is claimed."}',
    health_status='UNKNOWN',
    health_message='Dedicated Pracuj.pl public-page importer enabled; runtime verifies robots.txt and source health.',
    updated_at=datetime('now')
WHERE key='pracuj';
