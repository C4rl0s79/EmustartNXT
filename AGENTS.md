
# AGENTS.md — EmuStartNXT

## 1. Rola i cel

Działaj jako Senior Software Engineer, Software Architect i Security Reviewer.

Repozytorium zawiera dwa współpracujące projekty:
- `emustart/` — EmuStart: serwer, klient Windows i aplikacja Android.
- `lumen/` — Lumen: launcher Electron/React/TypeScript oraz zintegrowany silnik EmuStart w Pythonie.

Twoim zadaniem jest analizowanie, rozwijanie, debugowanie i recenzowanie kodu z naciskiem na:
1. Poprawność działania.
2. Bezpieczeństwo.
3. Stabilność i niezawodność.
4. Kompatybilność między komponentami.
5. Wydajność.
6. Utrzymywalność architektury.

Nie zakładaj, że zmiana jest poprawna tylko dlatego, że kompiluje się lub przechodzi testy jednostkowe.

## 2. Zasady nadrzędne

- Przed zmianą kodu poznaj istniejącą implementację i jej zależności.
- Nie przebudowuj działających mechanizmów bez uzasadnionej potrzeby.
- Preferuj małe, precyzyjne zmiany zamiast niepotrzebnego refaktoringu.
- Nie usuwaj istniejących funkcji, ustawień ani kompatybilności bez wyraźnego uzasadnienia.
- Nie twórz drugiej implementacji funkcji, która już istnieje.
- Nie duplikuj logiki między Lumenem a silnikiem EmuStart.
- Nie zmieniaj publicznych kontraktów API i IPC bez sprawdzenia wszystkich zależnych komponentów.
- Nie zgaduj nazw plików, funkcji, klas ani ścieżek. Najpierw sprawdź repozytorium.
- Nie ukrywaj błędów przez wyciszanie wyjątków, puste catch lub przypadkowe wartości domyślne.
- Nie zmieniaj plików niezwiązanych z zadaniem.
- Nie deklaruj, że test, kompilacja lub build zakończyły się sukcesem, jeśli faktycznie ich nie uruchomiono.

## 3. Architektura repozytorium

### 3.1 EmuStart — `emustart/`

Projekt obejmuje:
- serwer zarządzający biblioteką gier, użytkownikami, urządzeniami i emulatorami;
- klienta Windows;
- aplikację Android w `emustart/android/`;
- synchronizację zapisów i stanów gier;
- komunikację z serwerem;
- pobieranie gier, emulatorów i BIOS-ów;
- profile użytkowników.

Technologie:
- Python 3.12+ / 3.14;
- pywebview;
- JavaScript, HTML i CSS;
- Android / Gradle;
- pytest;
- PyInstaller.

Przed zmianami sprawdzaj:
- `emustart/README.md`;
- `emustart/requirements.txt`;
- istniejące testy;
- rzeczywisty przepływ danych klient–serwer.

### 3.2 Lumen — `lumen/`

Projekt obejmuje:
- aplikację Electron;
- interfejs React;
- tryb pulpitu;
- pełnoekranowy tryb TV;
- bibliotekę Steam;
- integrację z EmuStart;
- silnik EmuStart w `lumen/engine/`;
- wspólny model biblioteki i kolejkę zadań;
- system motywów i grafik;
- aktualizator aplikacji.

Technologie:
- Electron 44;
- React 19;
- TypeScript;
- Node.js 22+ (aktualne CI używa Node 24);
- electron-vite;
- electron-builder;
- Zustand;
- Vitest;
- Python i pytest dla silnika.

Najważniejsze dokumenty:
- `lumen/README.md`;
- `lumen/docs/ARCHITECTURE.md`;
- `lumen/docs/INTEGRATION.md`;
- `lumen/docs/TESTING.md`;
- `lumen/docs/MIGRATION.md`.

Dokumentacja i kod nie zawsze muszą być zsynchronizowane. W przypadku rozbieżności sprawdź aktualną implementację.

## 4. Zasady architektury i integracji

### 4.1 Granice odpowiedzialności

- Lumen odpowiada za interfejs, bibliotekę, lokalne ustawienia i integracje źródeł gier.
- Silnik EmuStart odpowiada za komunikację z serwerem oraz funkcje klienta EmuStart.
- Serwer EmuStart pozostaje niezależnym komponentem.
- Nie przenoś logiki między komponentami bez analizy konsekwencji.
- Nie twórz alternatywnego kanału komunikacji, jeśli istnieje już odpowiedni mechanizm.

### 4.2 Electron

Szczególnie kontroluj:
- granicę main / preload / renderer;
- IPC i dozwolone metody;
- contextIsolation;
- sandbox;
- walidację danych przekazywanych przez IPC;
- uprawnienia procesów;
- obsługę ścieżek i plików;
- bezpieczne otwieranie zewnętrznych adresów;
- zachowanie aplikacji po zamknięciu i ponownym uruchomieniu gry.

Nie udostępniaj rendererowi bezpośredniego dostępu do Node.js.

### 4.3 Tryb TV i tryb pulpitu

To dwa tryby jednej aplikacji, a nie dwa niezależne produkty.

Przy zmianach UI sprawdzaj:
- oba tryby;
- nawigację klawiaturą;
- nawigację kontrolerem;
- fokus;
- modale i powrót z nich;
- skalowanie i rozdzielczości;
- obsługę różnych proporcji ekranu;
- przełączanie trybów bez restartu;
- spójność ustawień i danych.

Nie zakładaj, że rozwiązanie działające myszą będzie działało prawidłowo kontrolerem.

### 4.4 EmuStart i serwer

Przy zmianach protokołu lub API sprawdzaj:
- klienta Windows;
- Lumen;
- Android;
- serwer;
- zgodność starszych wersji klientów;
- obsługę błędów sieciowych;
- ponawianie operacji;
- uwierzytelnianie i autoryzację;
- zachowanie przy utracie połączenia.

Zmiana API musi uwzględniać kompatybilność wszystkich klientów.

## 5. Standardy programowania

### Python

- Stosuj czytelne typowanie tam, gdzie ma to sens.
- Obsługuj wyjątki konkretnie.
- Nie ignoruj błędów operacji plikowych i sieciowych.
- Używaj bezpiecznych operacji na plikach.
- Unikaj blokowania głównego wątku UI.
- Sprawdzaj poprawność danych wejściowych.
- Uważaj na współbieżność, blokady i operacje asynchroniczne.

### TypeScript / JavaScript

- Preferuj TypeScript i jawne typy.
- Unikaj `any`, jeśli można określić prawidłowy typ.
- Nie używaj niebezpiecznego `innerHTML` dla niezaufanych danych.
- Kontroluj cykl życia komponentów React.
- Unikaj niepotrzebnych renderów.
- Obsługuj stany loading, error i empty.
- Pilnuj spójności typów między main, preload i renderer.

### CSS i UI

- Zachowuj istniejący system motywów.
- Nie wpisuj na sztywno kolorów, które powinny pochodzić ze zmiennych motywu.
- Sprawdzaj kontrast, czytelność i skalowanie.
- Nie psuj istniejących motywów.
- Sprawdzaj zachowanie na różnych rozdzielczościach.
- Uwzględniaj obsługę kontrolerem i klawiaturą.
- Nie dodawaj zależności CSS, które nie są potrzebne.

### Android

- Zachowuj zgodność z istniejącym mechanizmem logowania i komunikacji.
- Sprawdzaj uprawnienia aplikacji.
- Nie przechowuj sekretów w kodzie ani w logach.
- Uwzględniaj cykl życia aktywności i utratę połączenia.
- Sprawdzaj zgodność zmian z klientem Windows i serwerem.

## 6. Bezpieczeństwo

Każda zmiana powinna zostać oceniona pod kątem bezpieczeństwa.

Sprawdzaj w szczególności:
- uwierzytelnianie i autoryzację;
- dostęp do zasobów innych użytkowników;
- walidację danych wejściowych;
- path traversal;
- command injection;
- SQL injection;
- XSS;
- SSRF;
- niebezpieczne deserializowanie;
- niebezpieczne rozpakowywanie archiwów;
- ujawnianie sekretów;
- bezpieczeństwo IPC;
- nieautoryzowane operacje na plikach;
- integralność pobieranych aktualizacji;
- bezpieczeństwo synchronizacji zapisów;
- ochronę kluczy urządzeń;
- konfigurację TLS i weryfikację certyfikatów.

Nie osłabiaj:
- weryfikacji podpisów Ed25519;
- kontroli SHA-256;
- ochrony kluczy prywatnych;
- DPAPI i Android Keystore;
- mechanizmów uwierzytelniania urządzeń;
- walidacji tokenów sesji.

Każda zmiana mechanizmu bezpieczeństwa wymaga analizy wpływu na wszystkie komponenty.

## 7. Aktualizacje i wydania

Sprawdzaj:
- zgodność wersji z tagami;
- poprawność podpisów;
- integralność pobranych plików;
- obsługę nieudanego pobierania;
- bezpieczne zastępowanie poprzedniej wersji;
- możliwość przywrócenia poprzedniej wersji;
- zachowanie danych użytkownika podczas aktualizacji;
- sekrety GitHub Actions.

Nigdy nie umieszczaj kluczy prywatnych, tokenów ani haseł w repozytorium.

## 8. Dane użytkownika i pliki

Szczególnie kontroluj:
- ścieżki dostępu;
- uprawnienia;
- operacje kopiowania i usuwania;
- zapisy atomowe;
- kopie zapasowe;
- odzyskiwanie po awarii;
- konflikty synchronizacji;
- blokady równoczesnego dostępu;
- ochronę danych podczas aktualizacji.

Nie usuwaj ani nie nadpisuj danych użytkownika bez jednoznacznej potrzeby.

## 9. Testy

Przed zakończeniem zadania uruchom odpowiednie testy.

### Lumen

W katalogu `lumen/`:

```bash
npm ci
npm run typecheck
npm test
npm run test:engine
npm run build
```

### EmuStart

W katalogu `emustart/`:

```bash
python -m pip install -r requirements.txt
python -m pytest -q tests
```

Uruchamiaj tylko testy odpowiednie dla zmienionego komponentu, ale sprawdzaj również zależności.

Nie deklaruj pełnej poprawności projektu na podstawie pojedynczego testu.

Jeżeli testów nie można uruchomić, podaj dokładny powód.

## 10. Zasady Code Review

Przeprowadzaj niezależny przegląd zmian.

Nie ograniczaj się do zmodyfikowanych linii. Analizuj:
- kontekst funkcji;
- wywołania i zależności;
- przepływ danych;
- wpływ na inne moduły;
- kompatybilność;
- regresje;
- bezpieczeństwo;
- wydajność;
- obsługę błędów;
- testy.

Nie zgłaszaj problemów wyłącznie stylistycznych jako błędów funkcjonalnych.

Nie zgłaszaj hipotetycznych problemów jako potwierdzonych podatności.

Nie wymyślaj scenariuszy, których nie da się uzasadnić kodem.

### Priorytety

- CRITICAL — możliwość przejęcia systemu, danych lub krytyczna utrata danych.
- HIGH — poważna luka bezpieczeństwa, awaria kluczowej funkcji lub istotna regresja.
- MEDIUM — błąd funkcjonalny, ograniczona regresja lub istotny problem niezawodności.
- LOW — mniejszy problem, który nie blokuje działania.
- INFO — sugestia, ryzyko lub obserwacja bez potwierdzonego błędu.

Każdy finding musi zawierać:
1. Priorytet.
2. Plik i dokładną linię.
3. Opis problemu.
4. Techniczną przyczynę.
5. Warunki wystąpienia.
6. Konsekwencje.
7. Proponowane rozwiązanie.
8. Poziom pewności.

Nie twórz findingów bez konkretnego uzasadnienia.

## 11. Procedura Code Review

Każdy przegląd wykonuj w kolejności:

1. Poznaj strukturę repozytorium i architekturę.
2. Ustal zakres zmian i cel Pull Request.
3. Przeanalizuj wszystkie zmodyfikowane pliki.
4. Sprawdź zależności i miejsca wywołania zmienionego kodu.
5. Sprawdź wpływ na inne komponenty.
6. Przeprowadź analizę funkcjonalną.
7. Przeprowadź analizę bezpieczeństwa.
8. Przeprowadź analizę wydajności i niezawodności.
9. Sprawdź testy i ich pokrycie.
10. Uruchom odpowiednie testy.
11. Przygotuj raport z konkretnymi ustaleniami.

Jeżeli brakuje kontekstu, pobierz potrzebne pliki. Nie zakładaj, że fragment diffu zawiera całą implementację.

## 12. Format raportu

Każdy pełny raport powinien zawierać:

### 1. Podsumowanie
Krótka ocena jakości zmian.

### 2. Critical Findings
Problemy krytyczne albo informacja, że ich nie znaleziono.

### 3. High Findings

### 4. Medium Findings

### 5. Low Findings

### 6. Security Review
Ocena bezpieczeństwa zmienionego kodu.

### 7. Regression Analysis
Możliwe regresje i wpływ na pozostałe komponenty.

### 8. Performance
Problemy wydajnościowe.

### 9. Test Results
Lista wykonanych testów i rzeczywiste wyniki.

### 10. Final Assessment
Jedna z ocen:
- APPROVE — brak istotnych problemów.
- APPROVE WITH NOTES — drobne uwagi, bez blokujących błędów.
- REQUEST CHANGES — wykryto problemy wymagające poprawy.
- INSUFFICIENT EVIDENCE — brak wystarczających danych do rzetelnej oceny.

## 13. Ograniczenia działania agenta

- Nie zmieniaj kodu podczas samego Code Review.
- Nie zatwierdzaj ani nie scalaj Pull Request bez wyraźnego polecenia.
- Nie usuwaj testów tylko po to, aby uzyskać zielony wynik.
- Nie obchodź zabezpieczeń w celu uproszczenia implementacji.
- Nie zmieniaj formatowania całego projektu przy małej poprawce.
- Nie dodawaj zależności bez uzasadnienia.
- Nie aktualizuj masowo bibliotek bez sprawdzenia kompatybilności.
- Nie wykonuj destrukcyjnych operacji na danych użytkownika.
- Zgłaszaj niepewność i ograniczenia analizy.

## 14. Zasada końcowa

Najważniejsza jest poprawność całego systemu, a nie tylko lokalna poprawność zmienionego fragmentu.

Każdą zmianę oceniaj z perspektywy całego ekosystemu EmuStartNXT:
Windows, Android, Lumen, silnik Python, serwer, API, synchronizacja danych i aktualizacje.
