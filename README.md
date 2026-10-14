# Polski Trener Symulator

Przeglądarkowa gra o karierze trenera piłkarskiego, od B-klasy do Ekstraklasy. Inspiracja: Polski Piłkarz Simulator i okręgówka.pl, ale grasz trenerem.

## Jak grać

1. Tworzysz trenera (imię, wiek, województwo) i wybierasz jedną z trzech ofert z B-klasy.
2. Przed sezonem i w przerwie zimowej otwiera się okno transferowe.
3. Ustawiasz taktykę w trzech decyzjach (ustawienie, nastawienie, styl) i rozgrywasz mecze.
4. Między kolejkami wpadają zdarzenia z wyborem: wesela, dziki na boisku, syn prezesa, sponsor-masarnia.
5. Pilnujesz trzech pasków zaufania: zarząd, szatnia, kibice. Zarząd poniżej 12 oznacza zwolnienie.
6. Na koniec sezonu: awanse i spadki, kursy licencyjne (UEFA C → B → A → Pro), oferty z innych klubów.
7. Po zakończeniu kariery dostajesz kartę trenera do pobrania jako PNG.

## Co jest w środku

- 8 poziomów rozgrywkowych z awansami i spadkami we wszystkich ligach.
- Puchar Polski (32 drużyny z różnych lig, gospodarzem niżej notowany).
- Licencje trenerskie blokujące wyższe ligi.
- Rozwój zawodników, juniorzy, emerytury, cechy (Imprezowicz, Szklany, Syn prezesa…).
- Ziarno świata: ta sama nazwa daje ten sam świat; „Wyzwanie dnia” to wspólny start dla wszystkich.
- Zapis gry w przeglądarce (localStorage).

## Uruchomienie

```bash
npm install
npm run dev      # tryb deweloperski
npm test         # testy logiki gry
npm run build    # wersja produkcyjna w dist/
```

## Struktura

- `src/game/` – logika gry w czystym TypeScripcie, bez Reacta
  - `engine.ts` – sezon, mecze, zaufanie, transfery, oferty, licencje
  - `world.ts` – generowanie klubów, zawodników, terminarza i pucharu
  - `events.ts` – zdarzenia losowe (tu najłatwiej dopisywać humor)
  - `commentary.ts` – komentarze meczowe
  - `data.ts` – ligi, imiona, nazwy, cechy, cytaty
  - `rng.ts` – deterministyczny generator losowy
- `src/ui/` – ekrany Reacta

## Dopisywanie zdarzeń

Każde zdarzenie w `src/game/events.ts` ma tekst, opcjonalne warunki (poziom ligi, cecha zawodnika) i 2–3 opcje. Opcja dostaje stan gry i zwraca tekst wyniku. W tekstach działają `{p}`, `{ps}`, `{klub}`, `{miasto}`, `{trener}`.

## Pomysły na dalej

- Europejskie puchary, praca w reprezentacji, wyjazd za granicę.
- Konta i ranking online (np. Supabase).
- Ręczne ustawianie składu.
- Więcej zdarzeń i komentarzy, także od społeczności.
