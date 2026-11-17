# Klucze IGDB (Twitch)

**Co daje:** [IGDB](https://www.igdb.com) — dodatkowe źródło grafik w oknie „Grafiki” gry. Te same klucze wpisane
w panelu **serwera EmuStart** pozwalają serwerowi rozpoznawać **serie gier**.

IGDB należy do Twitcha, dlatego klucze to dane aplikacji Twitch: **Client ID** i **Client Secret**.

## Krok po kroku

1. Potrzebne jest konto [Twitch](https://www.twitch.tv) z włączonym **uwierzytelnianiem dwuskładnikowym**
   (Twitch → Ustawienia → Bezpieczeństwo i prywatność).
2. Otwórz [konsolę deweloperów Twitch](https://dev.twitch.tv/console/apps) i zaloguj się.
3. **Register Your Application**:
   - **Name:** dowolna, unikalna nazwa (np. `Lumen-twoja-nazwa`),
   - **OAuth Redirect URLs:** `http://localhost`,
   - **Category:** Application Integration,
   - **Client Type:** Confidential,
   - **Create**.
4. Przy aplikacji **Manage**: skopiuj **Client ID**. Potem **New Secret** i skopiuj **Client Secret** (widoczny tylko
   raz — gdy go zgubisz, wygeneruj nowy).
5. W Lumenie: **Ustawienia → Zaawansowane → IGDB i TheGamesDB** → „IGDB: Client ID” i „IGDB: Client Secret” →
   wklej każde → **Zapisz**.

Szczegóły po stronie IGDB: [dokumentacja — Account Creation](https://api-docs.igdb.com/#account-creation).
