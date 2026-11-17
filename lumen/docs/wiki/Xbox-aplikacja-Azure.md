# Xbox — własna aplikacja Azure

**Zwykle niepotrzebna.** Lumen loguje do konta Xbox przez swoją aplikację **„Lumen Launcher”** — w **Konta i sklepy →
Xbox → Zaloguj kontem Microsoft**. Logujesz się na stronie Microsoft; Lumen nie widzi hasła.

Własna aplikacja Azure przydaje się tylko wtedy, gdy logowanie przez domyślną aplikację przestanie działać.

## Krok po kroku

1. Otwórz [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** →
   [Rejestracje aplikacji](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) →
   **Nowa rejestracja**.
2. Nazwa dowolna; **Obsługiwane typy kont: „Tylko osobiste konta Microsoft”**. Na razie bez adresu przekierowania →
   **Zarejestruj**.
3. W aplikacji: **Uwierzytelnianie** → **Dodaj platformę** → **Aplikacje mobilne i klasyczne** → zaznacz albo wpisz
   adres:

   ```
   https://login.microsoftonline.com/common/oauth2/nativeclient
   ```

   (w Lumenie: Ustawienia → Zaawansowane → Xbox → **Kopiuj adres**) → **Konfiguruj**.
4. Na stronie **Przegląd** skopiuj **Identyfikator aplikacji (klienta)** (format `xxxxxxxx-xxxx-…`).
5. W Lumenie: **Ustawienia → Zaawansowane → Xbox — własna aplikacja Azure** → wklej identyfikator → **Zapisz
   identyfikator**, potem **Konta i sklepy → Xbox → Zaloguj kontem Microsoft**.

## Gdy logowanie się nie udaje

- Brak adresu przekierowania z kroku 3: Microsoft pokazuje błąd dopiero **po** wpisaniu hasła — strona logowania
  nie sprawdza go wcześniej.
- Typ kont inny niż osobiste: konta Xbox to konta osobiste Microsoft.
- Pusty identyfikator w Zaawansowane przywraca domyślną aplikację „Lumen Launcher”.
