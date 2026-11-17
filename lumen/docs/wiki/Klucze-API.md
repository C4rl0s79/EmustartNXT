# Klucze API w Lumenie

Lumen działa bez żadnych kluczy. Klucze dają więcej danych z usług, które wymagają rejestracji. Wpisuje się je
w **Ustawienia → Zaawansowane** (w obu trybach — pulpit i TV). Klucze zostają na tym komputerze (szyfrowane przez
Windows, gdy to możliwe) i nie trafiają na serwer EmuStart.

| Usługa | Co daje | Koszt | Poradnik |
|---|---|---|---|
| Steam Web API | lista **wszystkich** gier konta Steam (także niezainstalowanych), czas gry z konta | bezpłatny | [Klucz Steam Web API](Klucz-Steam-Web-API) |
| SteamGridDB | plakaty, tła, logotypy i ikony gier | bezpłatny | [Klucz SteamGridDB](Klucz-SteamGridDB) |
| IGDB (Twitch) | dodatkowe grafiki w oknie „Grafiki” gry | bezpłatny | [Klucze IGDB](Klucze-IGDB) |
| TheGamesDB | dodatkowe grafiki w oknie „Grafiki” gry | bezpłatny, na prośbę | [Klucz TheGamesDB](Klucz-TheGamesDB) |
| Azure (Xbox) | własna aplikacja do logowania kontem Microsoft — tylko gdy domyślna nie działa | bezpłatny | [Xbox — własna aplikacja Azure](Xbox-aplikacja-Azure) |

## Jak wkleić klucz

1. Skopiuj klucz na stronie usługi (zaznacz i Ctrl+C albo przycisk „Copy”).
2. W Lumenie: Ustawienia → Zaawansowane → pole klucza → Ctrl+V (albo prawy przycisk myszy → Wklej; na klawiaturze
   ekranowej — klawisz **Wklej**).
3. Naciśnij **Zapisz**. Obok pola pojawi się „Zapisany”.

## Przenoszenie kluczy na inny komputer

Ustawienia → Zaawansowane → **Przenoszenie kluczy**: „Eksportuj do pliku” zapisuje klucze grafik w pliku
`klucze-grafik.emustart` zaszyfrowanym hasłem, „Importuj z pliku” wczytuje je na innym komputerze. „Importuj
z PyLinks” bierze klucze z programu PyLinks na tym samym komputerze.
