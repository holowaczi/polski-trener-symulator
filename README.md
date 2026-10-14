# Polski Trener Symulator (alpha)

> Wersja 0.1.0-alpha: gra działa od początku do końca kariery, ale balans i dane lig są jeszcze dopracowywane.

Przeglądarkowa gra o karierze trenera piłkarskiego, od B-klasy do Ekstraklasy. Inspiracja: Polski Piłkarz Simulator i okręgówka.pl, ale grasz trenerem.

Zagraj w przeglądarce: https://holowaczi.github.io/polski-trener-symulator/

## Jak grać

1. Tworzysz trenera (imię, wiek, województwo) i wybierasz jedną z trzech ofert z B-klasy.
2. Przed sezonem i w przerwie zimowej otwiera się okno transferowe.
3. Ustawiasz taktykę w trzech decyzjach (ustawienie, nastawienie, styl) i rozgrywasz mecze.
4. Między kolejkami wpadają zdarzenia z wyborem: wesela, dziki na boisku, syn prezesa, sponsor-masarnia.
5. Pilnujesz trzech pasków zaufania: zarząd, szatnia, kibice. Zarząd poniżej 12 oznacza zwolnienie.
6. Na koniec sezonu: awanse i spadki, kursy licencyjne (UEFA C → B → A → Pro), oferty z innych klubów.
7. Po zakończeniu kariery dostajesz kartę trenera do pobrania jako PNG.

## Co jest w środku

- Prawdziwe kluby sezonu 2026/27: Ekstraklasa, I liga, II liga, grupa III ligi zależna od województwa oraz po jednej grupie z IV ligi i trzech poziomów niżej w każdym województwie (tam, gdzie jest V liga, najniższa w grze jest A-klasa). Gdy prawdziwa grupa jest mniejsza niż liga w grze, brakujące miejsca dopełniają fikcyjne kluby. Zawodnicy są fikcyjni.
- 8 poziomów rozgrywkowych z awansami i spadkami we wszystkich ligach (baraże uproszczone do miejsc premiowanych).
- Ręczny wybór pierwszej jedenastki i 7 rezerwowych albo automatyczny skład.
- Mecz liczony minuta po minucie: dyspozycja dnia zawodników decyduje o wyniku i o ich ocenach, są kartki, zawieszenia (czerwona kartka albo 4 żółte), kontuzje na konkretną liczbę meczów i zmiany.
- Najwyżej jedno zdarzenie meczowe (sędzia za kombajnem, pies na boisku…) i jedno zdarzenie między meczami, zawsze z realnym skutkiem.
- Forma wynika z ostatnich ocen, a rozwój z ocen, wieku i potencjału.
- Limit pensji klubu, oferty innych klubów za Twoich zawodników (sprzedaj, negocjuj, odrzuć).
- Zdarzenia reagują na to, co dzieje się w sezonie (ławka, czerwone kartki, serie, stres trenera) i mają trwałe skutki: efekty czasowe dla drużyny, morale i forma zawodników, obietnice do dotrzymania.
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
BALANCE=1 npx vitest run src/game/balance.test.ts   # pomiar balansu na 16 karierach
```

## Struktura

- `src/game/` – logika gry w czystym TypeScripcie, bez Reacta
  - `engine.ts` – sezon, tabela, puchar, zdarzenia, oferty pracy, licencje
  - `match.ts` – skład, siła drużyny, symulacja meczu, oceny, rozwój
  - `market.ts` – transfery, pensje, oferty za zawodników
  - `realData.ts` – prawdziwe ligi centralne 2026/27 i miejscowości województw
  - `lowerData.ts` – prawdziwe kluby IV ligi i niższych lig w każdym województwie
  - `world.ts` – generowanie klubów, zawodników, terminarza i pucharu
  - `events.ts` – zdarzenia losowe (tu najłatwiej dopisywać humor)
  - `commentary.ts` – zdarzenia meczowe ze skutkami
  - `data.ts` – ligi, imiona, nazwy, cechy, cytaty
  - `rng.ts` – deterministyczny generator losowy
- `src/ui/` – ekrany Reacta

## Dopisywanie zdarzeń

Każde zdarzenie w `src/game/events.ts` ma tekst, opcjonalne warunki (poziom ligi, cecha zawodnika) i 2–3 opcje. Opcja dostaje stan gry i zwraca tekst wyniku. W tekstach działają `{p}`, `{ps}`, `{ocena}`, `{mecze}`, `{klub}`, `{miasto}`, `{trener}`. Zdarzenie może dotyczyć zawodnika spełniającego warunek (np. długo na ławce), a opcja może dodać efekt czasowy dla drużyny.

## Pomysły na dalej

- Europejskie puchary, praca w reprezentacji, wyjazd za granicę.
- Konta i ranking online (np. Supabase).
- Więcej zdarzeń i komentarzy, także od społeczności.
- Więcej grup w niższych ligach i pełne rozmiary lig zgodne z rzeczywistością.
