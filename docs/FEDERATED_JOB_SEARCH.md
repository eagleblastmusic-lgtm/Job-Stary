# Federated Job Search + Official API + Live Public Ingestion

Stan: 2026-09-13

## Cel

Job ma jedną wyszukiwarkę, która wykorzystuje Career Truth (rola, lokalizacja, promień), pobiera oferty przez oficjalne API tam, gdzie taki kanał jest dostępny, równolegle próbuje ograniczony odczyt publicznych ofert z aktywnych źródeł, normalizuje wszystko do wspólnego modelu i przekazuje do istniejącego kanonicznego Job Feed/deduplikacji. Użytkownik nie musi otwierać każdego portalu osobno, żeby zobaczyć wyniki w Job.

## Preferowana kolejność źródeł

1. **Oficjalne API / licencjonowane feedy** — stabilny kanał pierwszego wyboru.
2. **Dozwolone publiczne feedy / ATS / strony karier** — po jawnej konfiguracji konkretnego źródła.
3. **Ograniczony odczyt publicznego HTML** — kanał uzupełniający, zawsze fail-closed przy blokadzie.
4. **Ręczny link do portalu** — ostatni fallback, gdy automatyczny kanał dla danego serwisu jest niedostępny.

Nie próbujemy sprawiać, żeby portal „przestał blokować” przez obchodzenie jego mechanizmów. Zamiast tego zwiększamy pokrycie przez niezależne oficjalne i publicznie dostępne kanały danych.

## Pracuj.pl — dedykowany live importer

Pracuj.pl ma osobną ścieżkę importu zamiast ogólnego adaptera HTML.

Stan zweryfikowany 2026-09-13:

- publiczna wyszukiwarka `/praca/...` działa bez logowania i zawiera linki do publicznych stron szczegółów ofert;
- publiczne strony szczegółów zawierają tytuł, pracodawcę, lokalizację, typ umowy, tryb pracy, wynagrodzenie (jeśli opublikowane), obowiązki i wymagania;
- `https://www.pracuj.pl/robots.txt` nie blokuje `/praca/` i publikuje m.in. sitemapę bieżących ofert `SiteMaps/CurrentOffers/SiteMapIndexJobOffers.xml`;
- publiczna paginacja wyszukiwarki korzysta z parametru `pn`.

Przepływ w Job:

1. przed live odczytem backend pobiera `robots.txt`; jeśli wildcard zacznie blokować `/praca/`, importer kończy pracę dla Pracuj.pl;
2. Job buduje publiczny URL wyszukiwania na podstawie frazy i lokalizacji;
3. importer czyta do 3 publicznych stron wyników (`pn=1..3`), zgodnie z liczbą stron wykrytą w odpowiedzi;
4. z każdej strony pobiera Schema.org `JobPosting`, jeśli jest obecne, oraz publiczne linki szczegółów;
5. maksymalnie 24 szczegóły są pobierane w ograniczonej współbieżności 4 żądań;
6. szczegół jest parsowany najpierw z `application/ld+json`; jeśli structured data brak, używany jest ograniczony tekst publicznej strony;
7. rekord trafia przez istniejący `JobSourceConnector` do parsera, Decision Engine, provenance i deduplikacji;
8. ten sam external ID/URL nie tworzy kolejnej kanonicznej oferty;
9. cache 10 minut ogranicza ponowne odpytywanie Pracuj.pl. Cache przechowuje już pobrane rekordy i nie wykonuje kolejnego żądania do portalu.

Importer używa jawnego identyfikatora `JobCareerNavigator` zamiast podszywania się pod przeglądarkę. Nie loguje się, nie używa cookies użytkownika, nie korzysta z ukrytych/private API, nie rozwiązuje CAPTCHA i nie obchodzi 401/403/429.

Wyniki bieżącego zapytania są identyfikowane przez provenance (`query`, `location`, `radiusKm`), dzięki czemu np. oferta z Gdyni zwrócona przez wyszukiwanie `Puck + 30 km` nie jest odrzucana tylko dlatego, że tekst lokalizacji nie zawiera słowa „Puck”.

## Jooble Polska — oficjalny agregator API

Job obsługuje `jooble_pl` przez oficjalny Jooble REST API dla rynku polskiego:

- dokumentacja i wniosek o klucz: `https://pl.jooble.org/api/about`;
- klucz jest konfigurowany jako `JOOBLE_API_KEY_PL` i nigdy nie jest zapisywany w provenance ani logach;
- zapytanie wykorzystuje stanowisko, lokalizację i najbliższy wspierany promień;
- odpowiedź Jooble (`title`, `company`, `location`, `salary`, `type`, `snippet`, `link`, `updated`) jest mapowana do istniejącego `JobSourceConnector`;
- oferty z Jooble przechodzą przez ten sam parser, Decision Engine i deduplikację jak pozostałe źródła;
- cache 30 minut ogranicza liczbę powtarzanych zapytań do oficjalnego API;
- brak klucza nie psuje wyszukiwarki — źródło ma stan `DISABLED`, a pozostałe kanały działają dalej;
- błędny klucz, limit zapytań lub chwilowa awaria Jooble failują tylko to źródło.

Jooble jest dodatkowym agregatorem. Nie zakładamy ani nie komunikujemy, że gwarantuje kompletne pokrycie Pracuj.pl, LinkedIn, OLX, Indeed, RocketJobs lub Just Join IT.

## Pozostałe bezpośrednie źródła publiczne

Ograniczony ogólny odczyt publicznych stron jest dodatkowo skonfigurowany dla:

- LinkedIn Jobs
- OLX Praca
- Indeed
- RocketJobs
- Just Join IT

Pracuj.pl używa dedykowanego importera opisanego wyżej. Bezpośrednie strony karier pracodawców pozostają osobnym kanałem wymagającym jawnej allowlisty lub feedu konkretnego pracodawcy.

## Jak działa ogólny odczyt publicznego HTML

1. Job buduje URL wyszukiwania z frazą, lokalizacją i promieniem tam, gdzie źródło obsługuje te parametry.
2. Backend wykonuje zwykłe publiczne `GET` do strony wyników — bez logowania i bez prywatnych endpointów.
3. Najpierw szuka `application/ld+json` / Schema.org `JobPosting`.
4. Jeśli lista nie zawiera pełnego `JobPosting`, Job wyciąga ograniczoną liczbę publicznych linków do szczegółów i odczytuje ich strony.
5. `JobPosting` jest zamieniany na wspólny tekst źródłowy i przepuszczany przez istniejący `JobSourceConnector` → parser → Decision Engine → obserwacje źródłowe → deduplikację.
6. Odświeżenie tego samego wyniku jest idempotentne: ten sam URL/external ID nie tworzy kolejnej kanonicznej oferty.

## Granice bezpieczeństwa źródeł

Adaptery publicznych stron:

- nie logują się do serwisu;
- nie używają cudzych kont/cookies/tokenów;
- nie omijają CAPTCHA ani challenge typu „verify you are human”;
- nie obchodzą HTTP 401/403/429;
- nie próbują korzystać z nieudokumentowanych prywatnych API jako substytutu oficjalnego dostępu;
- mają timeout 8 s na żądanie i limit 2 MB HTML;
- awaria jednego źródła nie zatrzymuje pozostałych ani Jooble API.

Pracuj.pl dodatkowo sprawdza publiczny `robots.txt` przed live fetch cycle. Przy zmianie polityki źródło failuje zamknięcie.

## Oficjalne API a publiczne strony

Live ingestion nie oznacza, że Job otrzymał partnerski dostęp API do każdego portalu. To różne kanały.

- Jooble Polska: oficjalny REST API, aktywny po podaniu `JOOBLE_API_KEY_PL`.
- Pracuj.pl: dedykowany importer publicznych stron `/praca/`; nie twierdzimy, że mamy oficjalne API lub partnerstwo.
- LinkedIn Job Posting API pozostaje ograniczone do zatwierdzonych integracji partnerskich. Public-page adapter nie używa tego API.
- Indeed API wymaga odpowiedniego dostępu partnerskiego. Public-page adapter nie używa prywatnych endpointów jako obejścia.
- OLX Developer API nie jest używane do pobierania cudzych ogłoszeń; adapter czyta wyłącznie publiczne strony WWW i zatrzymuje się przy blokadzie.

## API Job

`GET /api/job-search?q=<fraza>&location=<lokalizacja>&radiusKm=<0..300>`

Endpoint jest chroniony przez feature flag `job_feed`. W czasie jednego żądania:

- waliduje kryteria;
- uruchamia Jooble API, Pracuj.pl i aktywne bezpośrednie źródła równolegle;
- importuje i deduplikuje wyniki per użytkownik;
- identyfikuje oferty należące do bieżącego wyszukiwania na podstawie provenance źródła;
- zwraca wspólny feed pasujących ofert;
- zwraca `sourceRefresh` dla każdego uruchomionego źródła;
- zwraca `importedCount` oraz `newCanonicalCount`.

## Stan źródeł w UI

Głównym przepływem jest przycisk **„Pobierz oferty ze wszystkich źródeł”**. Karty źródeł są diagnostyczne: pokazują ile rekordów pobrano albo dlaczego konkretny kanał nie odpowiedział. Jooble bez klucza pokazuje **„wymaga klucza API”**. Pracuj.pl po udanym live imporcie raportuje liczbę pobranych ofert; blokada jednego portalu nie usuwa wyników z pozostałych kanałów.

## Bezpośrednie strony pracodawców

`employer_careers` nadal wymaga jawnej konfiguracji pracodawców/ATS. Następny bezpieczny krok dla tego kanału to adaptery oficjalnych publicznych feedów (np. JSON/RSS/ATS) z allowlistą domen i testami kontraktowymi.
