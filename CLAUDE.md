# Zasady projektu

- Cała komunikacja w grze jest po polsku i lekko humorystyczna.
- Gotowe zmiany idą prosto na `main`; każdy push publikuje grę na GitHub Pages.

## Numer wersji

Wersja jest tylko w `package.json` (pole `version`, format `0.X.Y-alpha`); ekran startowy czyta ją stamtąd.
Przy każdej wypuszczanej zmianie podbij wersję automatycznie:

- **małe zmiany i poprawki** (bugfix, balans, teksty, drobne UI): trzecia cyfra, np. 0.2.0 → 0.2.1
- **większe zmiany** (nowa mechanika, nowy ekran, przebudowa systemu): druga cyfra i zero na końcu, np. 0.2.3 → 0.3.0

Za każdym razem dopisz wpis na górze `CHANGELOG.md` (po polsku, w tym samym stylu) i zaktualizuj numer w `package-lock.json` (`npm install --package-lock-only`).

## Sprawdzanie

- typy: `npx tsc --noEmit -p tsconfig.app.json` (samo `-p .` niczego nie sprawdza)
- testy: `npx vitest run`, build: `npm run build`
