import type { License, Position, TraitId } from './types'

export const LEVELS = [
  { name: 'B-klasa', size: 12, base: 24, budget: 2_500, salary: 6_000, license: 'brak' as License },
  { name: 'A-klasa', size: 12, base: 31, budget: 6_000, salary: 12_000, license: 'UEFA C' as License },
  { name: 'Klasa okręgowa', size: 14, base: 38, budget: 15_000, salary: 24_000, license: 'UEFA C' as License },
  { name: 'IV liga', size: 16, base: 45, budget: 40_000, salary: 48_000, license: 'UEFA B' as License },
  { name: 'III liga', size: 16, base: 51, budget: 100_000, salary: 90_000, license: 'UEFA B' as License },
  { name: 'II liga', size: 16, base: 57, budget: 250_000, salary: 180_000, license: 'UEFA A' as License },
  { name: 'I liga', size: 16, base: 63, budget: 600_000, salary: 400_000, license: 'UEFA A' as License },
  { name: 'Ekstraklasa', size: 16, base: 69, budget: 1_500_000, salary: 1_200_000, license: 'UEFA Pro' as License },
]

export const LICENSES: License[] = ['brak', 'UEFA C', 'UEFA B', 'UEFA A', 'UEFA Pro']

/** koszt kursu i wymagana reputacja dla kolejnej licencji */
export const LICENSE_COURSES: Partial<Record<License, { cost: number; rep: number }>> = {
  'UEFA C': { cost: 3_000, rep: 0 },
  'UEFA B': { cost: 9_000, rep: 15 },
  'UEFA A': { cost: 25_000, rep: 35 },
  'UEFA Pro': { cost: 60_000, rep: 55 },
}

export const REGIONS = [
  'dolnośląskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie', 'łódzkie', 'małopolskie',
  'mazowieckie', 'opolskie', 'podkarpackie', 'podlaskie', 'pomorskie', 'śląskie',
  'świętokrzyskie', 'warmińsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie',
]

export const FIRST_NAMES = [
  'Adam', 'Bartek', 'Damian', 'Dawid', 'Grzegorz', 'Hubert', 'Jakub', 'Janusz', 'Kamil', 'Karol',
  'Krystian', 'Łukasz', 'Maciej', 'Marcin', 'Mariusz', 'Mateusz', 'Michał', 'Paweł', 'Patryk', 'Piotr',
  'Przemek', 'Radek', 'Rafał', 'Robert', 'Sebastian', 'Seweryn', 'Szymon', 'Tomasz', 'Wiktor', 'Wojtek',
  'Zbigniew', 'Arkadiusz', 'Dariusz', 'Emil', 'Filip', 'Igor', 'Jarek', 'Konrad', 'Norbert', 'Oskar',
]

export const LAST_NAMES = [
  'Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński',
  'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk',
  'Piotrowski', 'Grabowski', 'Pawłowski', 'Michalski', 'Król', 'Wieczorek', 'Jabłoński', 'Wróbel',
  'Nowakowski', 'Majewski', 'Olszewski', 'Stępień', 'Malinowski', 'Jaworski', 'Adamczyk', 'Dudek',
  'Nowicki', 'Pawlak', 'Górski', 'Witkowski', 'Walczak', 'Sikora', 'Baran', 'Rutkowski', 'Michalak',
  'Szewczyk', 'Ostrowski', 'Tomaszewski', 'Pietrzak', 'Zalewski', 'Wróblewski', 'Jasiński', 'Bąk',
  'Kaczmarek', 'Zając', 'Kubiak', 'Sowa', 'Pająk', 'Kogut', 'Kapusta', 'Gołąb', 'Ziemniak',
]

export const NICKNAMES = [
  'Bocian', 'Kafar', 'Młody', 'Profesor', 'Czołg', 'Zając', 'Szwagier', 'Dziadek', 'Sołtys', 'Rakieta',
  'Ksiądz', 'Kuzyn', 'Pancerny', 'Wiewiór', 'Kotlet', 'Dyzio', 'Łysy', 'Bombowiec', 'Mecenas', 'Grajek',
]

export const FOREIGN_NAMES: [string, string][] = [
  ['Joao', 'Silva'], ['Bogdan', 'Petrenko'], ['Ivan', 'Horvat'], ['Lukas', 'Novák'], ['Mamadou', 'Diallo'],
  ['Sergio', 'Pereira'], ['Andriy', 'Kovalenko'], ['Marko', 'Jovanović'], ['Kwame', 'Mensah'], ['Darko', 'Ilić'],
]

export const CLUB_PREFIXES = [
  'LZS', 'KS', 'GKS', 'Sparta', 'Orzeł', 'Grom', 'Victoria', 'Unia', 'Pogoń', 'Start', 'Huragan',
  'Błękitni', 'Iskra', 'Kłos', 'Plon', 'Burza', 'Zryw', 'Tęcza', 'Czarni', 'Strażak', 'Sokół', 'Polonia',
  'Wisła', 'Olimpia', 'Hetman', 'Rolnik', 'Avia', 'Górnik', 'Stal', 'Warta', 'Pilica', 'Ruch', 'Lechia',
]

const TOWN_A = ['Wólka', 'Dąbrowa', 'Nowa Wieś', 'Stara Wieś', 'Wola', 'Kozia', 'Psia', 'Wielka', 'Mała', 'Górna', 'Dolna', 'Ruda']
const TOWN_B = ['Kozłowska', 'Szlachecka', 'Błotna', 'Leśna', 'Kurza', 'Mokra', 'Pańska', 'Zapiecka', 'Gęsia', 'Kapuściana', 'Sołecka', 'Ogórkowa']
const SMALL_TOWNS = [
  'Pcim', 'Bździszewo', 'Ciućmy', 'Kłębowo', 'Bęczków', 'Pupki', 'Swornegacie', 'Kluczbork', 'Łęczna', 'Mielec',
  'Ostrołęka', 'Biała Podlaska', 'Kutno', 'Żyrardów', 'Sanok', 'Krosno', 'Nysa', 'Brzeg', 'Ełk', 'Pisz',
  'Siedlce', 'Puławy', 'Chojnice', 'Kalisz', 'Ostrów', 'Zawiercie', 'Wadowice', 'Bochnia', 'Tarnobrzeg', 'Głogów',
]
const CITIES = [
  'Wrocław', 'Poznań', 'Gdańsk', 'Szczecin', 'Lublin', 'Białystok', 'Kielce', 'Rzeszów', 'Olsztyn', 'Opole',
  'Katowice', 'Bydgoszcz', 'Łódź', 'Kraków', 'Warszawa', 'Gliwice', 'Radom', 'Toruń', 'Płock', 'Zabrze',
]

export const TOWNS = { villageA: TOWN_A, villageB: TOWN_B, small: SMALL_TOWNS, cities: CITIES }

export const TRAITS: Record<TraitId, { name: string; desc: string }> = {
  imprezowicz: { name: 'Imprezowicz', desc: 'Forma skacze po weekendach.' },
  szklany: { name: 'Szklany', desc: 'Łapie kontuzje od patrzenia.' },
  lider: { name: 'Lider szatni', desc: 'Podnosi morale całej drużyny.' },
  syn_prezesa: { name: 'Syn prezesa', desc: 'Posadzisz go na ławce, prezes to zapamięta.' },
  weteran: { name: 'Weteran', desc: 'Wolniejszy, ale wie, gdzie stanąć.' },
  talent: { name: 'Talent', desc: 'Szybko rośnie, jeśli gra.' },
  leniwy: { name: 'Leniwy', desc: 'Trening to dla niego sugestia.' },
  pracus: { name: 'Pracuś', desc: 'Zostaje po treningu. Rośnie stabilnie.' },
  krol_strzalow: { name: 'Król strzałów', desc: 'Strzela z każdej pozycji. Czasem trafia.' },
  kibic_z_mlyna: { name: 'Kibic z młyna', desc: 'Kibice go kochają, co by nie zrobił.' },
}

export const POSITION_NAMES: Record<Position, string> = {
  BR: 'Bramkarz',
  OBR: 'Obrońca',
  POM: 'Pomocnik',
  NAP: 'Napastnik',
}

export const FORMATIONS: Record<string, Record<Position, number>> = {
  '4-4-2': { BR: 1, OBR: 4, POM: 4, NAP: 2 },
  '4-3-3': { BR: 1, OBR: 4, POM: 3, NAP: 3 },
  '5-3-2': { BR: 1, OBR: 5, POM: 3, NAP: 2 },
  '4-5-1': { BR: 1, OBR: 4, POM: 5, NAP: 1 },
  '3-5-2': { BR: 1, OBR: 3, POM: 5, NAP: 2 },
}

export const STYLE_INFO = {
  laga: 'Długa piłka na napastnika. W niższych ligach działa zaskakująco dobrze.',
  pressing: 'Wysoki pressing. Wymaga młodej, wybieganej kadry.',
  posiadanie: 'Klepanie piłki. Wymaga dobrych pomocników, inaczej to tylko klepanie.',
  kontra: 'Cofnij się i kontruj. Najlepsze przeciw silniejszym.',
}

export const COACH_QUOTES = [
  'Piłka jest okrągła, a bramki są dwie.',
  'Zagraliśmy dobrze, tylko wynik nie ten.',
  'Taktyka była prosta: strzelić więcej niż oni.',
  'Chłopaki zostawili serce na boisku. Płuca chyba też.',
  'Nie ma słabych drużyn, są tylko słabo przygotowane murawy.',
  'Ja się nie boję żadnego prezesa. No, może jednego.',
  'Trzeba szanować punkt, nawet jak się go nie zdobyło.',
  'Mamy swój styl. Nikt nie wie jaki, i to jest nasza siła.',
]
