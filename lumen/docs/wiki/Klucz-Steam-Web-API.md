# Klucz Steam Web API

**Co daje:** Lumen widzi wszystkie gry Twojego konta Steam — także te niezainstalowane — i czas gry zapisany
na koncie. Bez klucza Lumen zna tylko gry zainstalowane na tym komputerze.

## Krok po kroku

1. Zaloguj się na [steamcommunity.com](https://steamcommunity.com) kontem, którego biblioteki używasz. Steam wydaje
   klucze kontom, które mają co najmniej jeden zakup (konta ograniczone go nie dostaną).
2. Otwórz stronę [Register Steam Web API Key](https://steamcommunity.com/dev/apikey).
3. W polu **Domain Name** wpisz dowolną nazwę, np. `localhost`. Zaznacz zgodę na warunki i naciśnij **Register**.
4. Skopiuj klucz (32 znaki, litery i cyfry).
5. W Lumenie: **Ustawienia → Zaawansowane → Steam → Klucz Steam Web API** → wklej → **Zapisz**.
6. **Konta i sklepy → Steam → Odśwież bibliotekę.** W wierszu „Biblioteka konta” pojawi się liczba gier.

## Gdy lista gier konta jest pusta

- „Profil prywatny”: w profilu Steam → Edytuj profil → **Ustawienia prywatności** → „Szczegóły gier” ustaw na
  **Publiczne**.
- Lumen bierze konto zalogowane w kliencie Steam. Inne konto: Zaawansowane → **Inne SteamID64** (17 cyfr; znajdziesz
  je np. w adresie swojego profilu).

## Bezpieczeństwo

Klucz pozwala czytać dane Steam w Twoim imieniu. Nie podawaj go nikomu. Gdy wycieknie: na tej samej stronie
**Revoke My Steam Web API Key**, potem nowy klucz w Lumenie.

Rodzina Steam (Family Sharing) nie korzysta z klucza — działa po zalogowaniu do Steam w **Konta i sklepy → Steam**.
