# Job — Polski system zdobywania pracy

**Job** jest kandydackim systemem podejmowania decyzji i nawigacji kariery. Podstawowy przepływ to:

`konto → profil/Career Truth → oferta → decyzja → pakiet aplikacyjny → CV PDF → tracker → outcome`

Interfejs jest po polsku i mobile-first. System nie może wpisywać do CV faktów wywnioskowanych bez potwierdzenia użytkownika, a późniejsze rekomendacje pokazują niepewność zamiast udawać pewność.

## Zaimplementowany zakres

### Rdzeń MVP

- rejestracja/logowanie z `scrypt` i sesjami HttpOnly;
- onboarding, Career Truth, doświadczenie, edukacja i prywatny upload CV;
- deterministyczny parser polskich ofert i explainable Decision Engine;
- Decision Card z niepewnością i możliwością override;
- Application Package i CV PDF tylko z potwierdzonych faktów;
- tracker aplikacji, outcome capture, eksport danych i usuwanie konta;
- trial/plany lokalne, diagnostyka administratora, PWA i zabezpieczenia HTTP.

### Późniejsze etapy roadmapy

- **Today / Action Priority** — ranking działań w budżecie czasu;
- **Notifications** — użyteczne powiadomienia in-app;
- **Interview Prep Pack**;
- **Job Sources / Feed / deduplication** z oficjalnym Jooble Polska API, wieloźródłowym wyszukiwaniem i granicą legalnych źródeł;
- **Bottleneck Engine** z progami pewności;
- **Local Labour Intelligence** z pochodzeniem danych;
- **Effective Wage** z jawnymi założeniami;
- **Skill ROI** i **Just-in-Time Learning**;
- **Career Transition Engine**;
- **Outcome Inbox** — sugestia wyniku nigdy nie zmienia statusu bez potwierdzenia użytkownika;
- **Strategy Engine** — brak rekomendacji przy zbyt małej próbce.

Duże moduły są za feature flagami i domyślnie wyłączone. Szczegółowy stan oraz granice wdrożenia są w `IMPLEMENTATION_STATUS.md`.

## Lokalny start

Wymagania:

- Node.js 22+
- `python3 + ReportLab` dla PDF
- `pdftotext` (`poppler-utils`) dla PDF CV
- `unzip` dla DOCX

```bash
cp .env.example .env
npm ci
npm run check
npm start
```

Następnie otwórz `http://localhost:3000`.

## Konfiguracja

Zobacz `.env.example`. Sekrety nie mogą trafić do repozytorium.

Najważniejsze wartości:

- `DATABASE_PATH` — plik SQLite obecnego runtime;
- `DATA_DIR` — prywatne pliki i dane runtime;
- `APP_ORIGIN` — dozwolony origin dla mutujących żądań;
- `AI_*` — opcjonalny OpenAI-compatible AI Gateway; krytyczny rdzeń działa deterministycznie bez AI;
- `JOOBLE_API_KEY_PL` — opcjonalny klucz oficjalnego Jooble REST API dla rynku polskiego; po ustawieniu zasila wspólną wyszukiwarkę ofert przez kanał API;
- `JOOBLE_TIMEOUT_MS` — timeout Jooble API, domyślnie 8000 ms;
- `PDF_RENDERER_BIN` — interpreter Python dla renderera PDF;
- ustawienia malware scanning — opcjonalne lokalnie, możliwe do ustawienia jako wymagane/fail-closed w docelowym środowisku.

Klucz Jooble uzyskuje się przez formularz na `https://pl.jooble.org/api/about`. Klucza nie należy commitować; wpisuje się go wyłącznie do lokalnego/produkcyjnego środowiska jako `JOOBLE_API_KEY_PL`.

Publiczna rejestracja nie może nadać roli `ADMIN`. Administrator jest provisionowany poza publicznym flow zgodnie z `docs/ADMIN_PROVISIONING.md`.

## Testy i CI

```bash
npm run lint
npm run typecheck
npm run validate:migrations
npm test
npm run test:browser
```

CI dodatkowo wykonuje semantyczny backup/restore, mobilny i desktopowy Playwright + axe, build obrazu produkcyjnego oraz smoke test uruchomionego kontenera.

## Architektura

Aplikacja jest modularnym monolitem:

- `src/domain` — reguły domenowe i silniki;
- `src/server` — HTTP, auth, persistence, upload, PDF i integracje;
- `src/client` + `public` — PWA/UI;
- `migrations` — wykonywalne migracje danych.

Reguły biznesowe pozostają poza komponentami prezentacji. Szczegóły: `docs/ARCHITECTURE.md`.

## Persistence i skalowanie

Obecny wykonywalny runtime używa `node:sqlite`. Jest to świadoma decyzja dla pojedynczej instancji/zamkniętych testów i nie jest przedstawiana jako dowód gotowości do dużego publicznego wdrożenia. Plan przejścia do zarządzanego PostgreSQL i prywatnego object storage należy zamknąć wraz z docelową topologią produkcyjną.

## Deployment

Obecna ścieżka kontenerowa:

```bash
docker build -t job-app .
docker run --rm -p 3000:3000 -v job-data:/app/data --env-file .env job-app
```

Repozytorium może przejść CI i być użyte do staging/closed beta, ale szeroki publiczny launch nadal wymaga zewnętrznych bramek z `docs/PRODUCTION_READINESS.md`: legal, live payment/provider, monitoring/backups, manual accessibility, security review i reprezentatywne testy użytkowników.

## Roadmap boundary

- **V2.5 native mobile**: zgodnie z planem dopiero po potwierdzeniu PWA product-market fit; domeny nie należy duplikować.
- **V3 cross-user intelligence**: dopiero po privacy/legal review, minimalnych kohortach, agregacji i fairness monitoring.

## Dokumentacja

- `IMPLEMENTATION_STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_PRIVACY.md`
- `docs/DEPLOYMENT.md`
- `docs/AI_EVALUATION.md`
- `docs/ADMIN.md`
- `docs/FEATURE_FLAGS.md`
- `docs/FEDERATED_JOB_SEARCH.md`
- `docs/V2_RELEASE_NOTES.md`
- `docs/PRODUCTION_READINESS.md`
