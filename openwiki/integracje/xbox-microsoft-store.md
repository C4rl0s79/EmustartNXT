---
type: integracja
title: "Xbox i Microsoft Store w Lumenie"
description: "Gry Xbox / Microsoft Store w bibliotece Lumena: zainstalowane pakiety (MicrosoftGame.config, start przez shell:AppsFolder), katalog PC Game Pass z katalogu Microsoft, konto Xbox (logowanie Microsoft z PKCE, XBL → XSTS, historia tytułów) i aplikacja Azure „Lumen Launcher”."
tags: [lumen, xbox, microsoft-store, game-pass, oauth, integration]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T21:56:42.171Z
sources:
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
  - id: openwiki-source-09cc82d5a5407fc108b34403
    resource: repo://lumen/src/main/xbox/account.ts
  - id: openwiki-source-01466423d3d9499a09b71cf6
    resource: repo://lumen/src/main/xbox/catalog.ts
  - id: openwiki-source-67e60d666767661b8cf70353
    resource: repo://lumen/src/main/xbox/installed.ts
  - id: openwiki-source-34523804e7fa18e29878403b
    resource: repo://lumen/src/main/xbox/provider.ts
generated: { by: "claude-code", at: "2026-11-17T21:56:42.171Z" }
---

# Xbox i Microsoft Store w Lumenie

Moduł `lumen/src/main/xbox/` dodaje do biblioteki Lumena gry z trzech źródeł; wszystkie trafiają do grupy PC
(Xbox / Game Pass) i — jak inne źródła — **nie są łączone** z wydaniami Steam / GOG o tym samym tytule
(`XboxProvider`, `provider.ts`). Gra ma id `xbox:<StoreId>` (StoreId = 12 znaków `[0-9A-Z]`, `isStoreId` w
`catalog.ts`); jedna pozycja na StoreId, a pole `provenance` mówi, skąd jest (`xboxLocal`, `xboxAccount`,
`xboxGamePass`).

## Gry zainstalowane (`installed.ts`)

Skrypt PowerShell (`Get-AppxPackage`) przegląda pakiety Sklepu z plikiem `MicrosoftGame.config`, który ma plik
wykonywalny — pakiety bez niego (DLC) są pomijane — i bierze z `AppxManifest.xml` identyfikator aplikacji. Wynik:
nazwa rodziny pakietu (`pfn`), identyfikator uruchomienia `<rodzina>!<aplikacja>` (`aumid`), StoreId, TitleId,
nazwa i folder. Nie wymaga logowania.

**Uruchamianie** (`playXbox` w `lumen/src/main/index.ts`): `explorer.exe shell:AppsFolder\<aumid>` — Eksplorator
przekazuje polecenie powłoce, więc gra startuje bez uprawnień administratora, jak z menu Start. Lumen nie śledzi
procesu gry Xbox, dlatego się nie minimalizuje. Gra spoza tego komputera: „Zainstaluj” otwiera stronę produktu
w Sklepie (`ms-windows-store://pdp/?ProductId=<StoreId>`, `installXbox`); instalacją zarządza Sklep / aplikacja
Xbox.

## Katalog Microsoft i PC Game Pass (`catalog.ts`)

- Lista gier PC Game Pass: `catalog.gamepass.com/sigls/v2` (identyfikator listy `GAMEPASS_PC`, rynek PL).
- Nazwy, grafiki (tylko `https`), rodzina pakietu, TitleId i rok: `displaycatalog.mp.microsoft.com/v7.0/products`
  porcjami po 20 identyfikatorów.
- Kopia na dysku, odświeżana raz na dobę; bez sieci działa ostatnia kopia. Zła odpowiedź (pusty katalog, brak
  produktów) to błąd, a nie pusta lista — stara kopia zostaje (`tests/xbox.test.ts`).
- Ustawienie „Pokazuj katalog PC Game Pass” (`xboxGamePass`) ukrywa gry z Game Pass spoza komputera i konta.

## Opis gry (strona gry, od Lumena 1.0.77)

Opis nie jest pobierany razem z katalogiem, tylko przy otwarciu strony gry (`xboxDetails` w
`lumen/src/main/index.ts`):

- `productDetails` (`catalog.ts`) pyta `displaycatalog.mp.microsoft.com/v7.0/products` o jeden StoreId (rynek PL,
  języki `pl-pl`, potem `en-us`); `detailsOf` bierze z pierwszego języka, który ma treść: opis
  (`ProductDescription`), krótki opis, producenta (`DeveloperName`), wydawcę (`PublisherName`), gatunki
  (`Categories` / `Category`) i datę premiery (`OriginalReleaseDate`; „1601-01-01” to w katalogu brak daty).
  Katalog nie zawsze ma tekst polski — wtedy opis jest angielski.
- `XboxProvider.productDetails` (`provider.ts`) zapisuje wynik w `xbox-catalog-details.json` obok kopii katalogu:
  opis — na 30 dni, produkt, którego katalog nie zna — na 7 dni (strona gry nie czeka za każdym razem na katalog);
  bez sieci zostaje ostatni zapis; odświeżenie wymuszone (`force`) omija zapis.
- Czego katalog nie ma, uzupełnia LaunchBox (Windows, potem MS-DOS); bez opisu po obu — Wikipedia, jak dla każdej
  gry ([Lumen — opis i szczegóły gry](../architektura/lumen.md)). Gra zainstalowana bez StoreId (`PFN-…`) od razu
  idzie do LaunchBox i Wikipedii.

Wcześniej gry Xbox trafiały na ścieżkę gier Steam i strona pokazywała „Brak danych dla pozycji demonstracyjnej”.
Testy: `lumen/tests/details.test.ts`.

## Konto Xbox (`account.ts`)

1. **Logowanie** w osobnym oknie (`loginWindow`, sesja `persist:xbox-login`) na stronie Microsoft — Lumen nie widzi
   hasła. OAuth 2.0 z PKCE na `login.microsoftonline.com/consumers`, zakres `XboxLive.signin offline_access`,
   przekierowanie klienta publicznego `https://login.microsoftonline.com/common/oauth2/nativeclient`.
2. **Xbox Live:** `user.auth.xboxlive.com/user/authenticate` (bilet RPS — Lumen próbuje kolejno form `d=`, `t=` i
   bez przedrostka, `rpsCandidates`), potem `xsts.auth.xboxlive.com/xsts/authorize`.
3. **Gry konta:** historia tytułów `titlehub.xboxlive.com/users/xuid(<xuid>)/titles/titlehistory` — tylko gry na PC;
   StoreId z dostępności produktu albo z rodziny pakietu (`parseTitles`). Gry kupione, a nigdy nieuruchomione,
   w historii nie występują.
4. **Zapis:** tylko token odświeżania, zaszyfrowany jak inne sekrety (`xboxRefreshToken`), razem z identyfikatorem
   aplikacji (`<identyfikator>|<token>`) — zmiana identyfikatora wymaga ponownego logowania. Nowe logowanie zapisuje
   token dopiero, gdy Xbox Live go przyjął; odświeżenie zapisanego logowania zapisuje nowy token od razu (Microsoft
   unieważnia stary). Synchronizacja przy starcie i co 6 godzin (`XBOX_EVERY`); wylogowanie w trakcie przerywa ją
   (`xboxGen`).

**Aplikacja:** domyślnie „Lumen Launcher” zarejestrowana w Azure przez autora (`LUMEN_CLIENT`; identyfikator
klienta publicznego nie jest tajny). Xbox Live odrzuca publiczne identyfikatory cudzych aplikacji (dawna aplikacja
Xbox: HTTP 403, kod `00000005`). Własną aplikację Azure podaje się w Ustawienia → Zaawansowane → „Xbox — własna
aplikacja Azure” (`xboxClientId`); musi mieć konta osobiste Microsoft i adres przekierowania `nativeclient`.

**Błędy:** odmowa Xbox Live (nagłówek `x-err` albo pole `XErr`) jest tłumaczona na przyczynę po polsku (`xerrText`:
konto bez profilu Xbox, konto dziecka, warunki, kraj, weryfikacja wieku…); nieznany kod — „kod Xbox <kod>”.

## Testy

`lumen/tests/xbox.test.ts`: parsowanie listy zainstalowanych gier, produkt z katalogu, jedna pozycja na grę
z kilku źródeł, adres logowania z PKCE i obsługa powrotu (kod, błąd, obcy `state`), historia tytułów, zła
odpowiedź katalogu, kolejne formy biletu RPS i czytelna odmowa XSTS. Logowanie i lista z prawdziwego konta nie są
pokryte testami automatycznymi.

## Powiązane

- [Lumen — launcher Electron](../architektura/lumen.md)
- [Rozwiązywanie problemów](../operacje/rozwiazywanie-problemow.md)
- Poradnik dla gracza: wiki GitHub „Xbox-aplikacja-Azure” (`lumen/docs/wiki/Xbox-aplikacja-Azure.md`)
