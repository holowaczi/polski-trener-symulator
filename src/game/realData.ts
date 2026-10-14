/**
 * Prawdziwe kluby sezonu 2026/27 (szczebel centralny).
 * Źródło składów lig: Wikipedia, strony sezonów 2026–27 Ekstraklasy, I, II i III ligi.
 * Siła to nasza własna ocena na start, potem zmienia się w trakcie gry.
 */

export interface RealClub {
  name: string
  town: string
  strength: number
  reserve?: boolean
}

export const EKSTRAKLASA: RealClub[] = [
  { name: 'Lech Poznań', town: 'Poznań', strength: 76 },
  { name: 'Legia Warszawa', town: 'Warszawa', strength: 75 },
  { name: 'Raków Częstochowa', town: 'Częstochowa', strength: 75 },
  { name: 'Jagiellonia Białystok', town: 'Białystok', strength: 74 },
  { name: 'Pogoń Szczecin', town: 'Szczecin', strength: 71 },
  { name: 'Górnik Zabrze', town: 'Zabrze', strength: 70 },
  { name: 'Widzew Łódź', town: 'Łódź', strength: 70 },
  { name: 'Cracovia', town: 'Kraków', strength: 69 },
  { name: 'GKS Katowice', town: 'Katowice', strength: 68 },
  { name: 'Motor Lublin', town: 'Lublin', strength: 68 },
  { name: 'Zagłębie Lubin', town: 'Lubin', strength: 67 },
  { name: 'Korona Kielce', town: 'Kielce', strength: 67 },
  { name: 'Piast Gliwice', town: 'Gliwice', strength: 67 },
  { name: 'Radomiak Radom', town: 'Radom', strength: 67 },
  { name: 'Wisła Płock', town: 'Płock', strength: 67 },
  { name: 'Wieczysta Kraków', town: 'Kraków', strength: 67 },
  { name: 'Wisła Kraków', town: 'Kraków', strength: 66 },
  { name: 'Śląsk Wrocław', town: 'Wrocław', strength: 66 },
]

export const I_LIGA: RealClub[] = [
  { name: 'Lechia Gdańsk', town: 'Gdańsk', strength: 66 },
  { name: 'Arka Gdynia', town: 'Gdynia', strength: 65 },
  { name: 'Bruk-Bet Termalica Nieciecza', town: 'Nieciecza', strength: 65 },
  { name: 'ŁKS Łódź', town: 'Łódź', strength: 64 },
  { name: 'Miedź Legnica', town: 'Legnica', strength: 64 },
  { name: 'Ruch Chorzów', town: 'Chorzów', strength: 63 },
  { name: 'Polonia Warszawa', town: 'Warszawa', strength: 63 },
  { name: 'Stal Mielec', town: 'Mielec', strength: 63 },
  { name: 'Puszcza Niepołomice', town: 'Niepołomice', strength: 62 },
  { name: 'Odra Opole', town: 'Opole', strength: 62 },
  { name: 'Polonia Bytom', town: 'Bytom', strength: 62 },
  { name: 'Pogoń Grodzisk Mazowiecki', town: 'Grodzisk Mazowiecki', strength: 61 },
  { name: 'Podbeskidzie Bielsko-Biała', town: 'Bielsko-Biała', strength: 61 },
  { name: 'Chrobry Głogów', town: 'Głogów', strength: 61 },
  { name: 'Stal Rzeszów', town: 'Rzeszów', strength: 61 },
  { name: 'Pogoń Siedlce', town: 'Siedlce', strength: 60 },
  { name: 'Warta Poznań', town: 'Poznań', strength: 60 },
  { name: 'Unia Skierniewice', town: 'Skierniewice', strength: 59 },
]

export const II_LIGA: RealClub[] = [
  { name: 'GKS Tychy', town: 'Tychy', strength: 59 },
  { name: 'Górnik Łęczna', town: 'Łęczna', strength: 58 },
  { name: 'Zawisza Bydgoszcz', town: 'Bydgoszcz', strength: 58 },
  { name: 'Hutnik Kraków', town: 'Kraków', strength: 57 },
  { name: 'Resovia Rzeszów', town: 'Rzeszów', strength: 57 },
  { name: 'Chojniczanka Chojnice', town: 'Chojnice', strength: 57 },
  { name: 'Olimpia Grudziądz', town: 'Grudziądz', strength: 57 },
  { name: 'Sandecja Nowy Sącz', town: 'Nowy Sącz', strength: 57 },
  { name: 'Stal Stalowa Wola', town: 'Stalowa Wola', strength: 57 },
  { name: 'Znicz Pruszków', town: 'Pruszków', strength: 56 },
  { name: 'Avia Świdnik', town: 'Świdnik', strength: 56 },
  { name: 'Rekord Bielsko-Biała', town: 'Bielsko-Biała', strength: 56 },
  { name: 'Świt Szczecin', town: 'Szczecin', strength: 56 },
  { name: 'Lechia Zielona Góra', town: 'Zielona Góra', strength: 56 },
  { name: 'Podhale Nowy Targ', town: 'Nowy Targ', strength: 55 },
  { name: 'Sokół Kleczew', town: 'Kleczew', strength: 55 },
  { name: 'Legia Warszawa II', town: 'Warszawa', strength: 55, reserve: true },
  { name: 'Śląsk Wrocław II', town: 'Wrocław', strength: 54, reserve: true },
]

const g = (names: string[], strong: string[] = []): RealClub[] =>
  names.map((name) => {
    const reserve = / II$/.test(name)
    const town = name.replace(/ II$/, '').split(' ').slice(1).join(' ') || name
    return { name, town, reserve, strength: strong.includes(name) ? 53 : reserve ? 50 : 51 }
  })

/** III liga 2026/27, cztery grupy */
export const III_LIGA: Record<'I' | 'II' | 'III' | 'IV', RealClub[]> = {
  I: g(
    [
      'Jagiellonia Białystok II', 'KS CK Troszyn', 'KTS Weszło', 'Lechia Tomaszów Mazowiecki', 'ŁKS Łomża',
      'ŁKS Łódź II', 'Mazovia Mińsk Mazowiecki', 'Mławianka Mława', 'Olimpia Elbląg', 'Olimpia Zambrów',
      'Pelikan Łowicz', 'Polonia Lidzbark Warmiński', 'Świt Nowy Dwór Mazowiecki', 'Warta Sieradz',
      'Widzew Łódź II', 'Wigry Suwałki', 'Wisła Płock II', 'Ząbkovia Ząbki',
    ],
    ['Olimpia Elbląg', 'Wigry Suwałki', 'KTS Weszło'],
  ),
  II: g(
    [
      'Bałtyk Koszalin', 'Błękitni Stargard', 'Chemik Bydgoszcz', 'Elana Toruń', 'Flota Świnoujście',
      'Gedania Gdańsk', 'Grom Nowy Staw', 'KKS 1925 Kalisz', 'Kluczevia Stargard', 'Kotwica Kórnik',
      'Lech Poznań II', 'Lipno Stęszew', 'Noteć Czarnków', 'Polonia Środa Wielkopolska', 'Unia Swarzędz',
      'Victoria Września', 'Wda Świecie', 'Wikęd Luzino',
    ],
    ['KKS 1925 Kalisz', 'Błękitni Stargard', 'Elana Toruń'],
  ),
  III: g(
    [
      'Barycz Sułów', 'Carina Gubin', 'Górnik Polkowice', 'Karkonosze Jelenia Góra', 'KS Goczałkowice-Zdrój',
      'Miedź Legnica II', 'MKS Kluczbork', 'Odra Bytom Odrzański', 'Polonia Nysa', 'Raków Częstochowa II',
      'ROW 1964 Rybnik', 'Sparta Katowice', 'Stal Brzeg', 'Stilon Gorzów Wielkopolski', 'Ślęza Wrocław',
      'Warta Gorzów Wielkopolski', 'Zagłębie Lubin II', 'Zagłębie Sosnowiec',
    ],
    ['Zagłębie Sosnowiec', 'Górnik Polkowice', 'ROW 1964 Rybnik'],
  ),
  IV: g(
    [
      'AKS 1947 Busko-Zdrój', 'Chełmianka Chełm', 'Czarni Połaniec', 'Hetman Zamość', 'JKS Jarosław',
      'Korona Kielce II', 'KSZO Ostrowiec Świętokrzyski', 'Moravia Morawica', 'Naprzód Jędrzejów',
      'Podlasie Biała Podlaska', 'Pogoń-Sokół Lubaczów', 'Siarka Tarnobrzeg', 'Sokół Kolbuszowa Dolna',
      'Star Starachowice', 'Wieczysta Kraków II', 'Wisła Kraków II', 'Wisłoka Dębica', 'Wiślanie Skawina',
    ],
    ['KSZO Ostrowiec Świętokrzyski', 'Siarka Tarnobrzeg', 'Wisłoka Dębica'],
  ),
}

/** grupy III ligi według województw (podział PZPN) */
export const REGION_GROUP: Record<string, 'I' | 'II' | 'III' | 'IV'> = {
  podlaskie: 'I',
  mazowieckie: 'I',
  'warmińsko-mazurskie': 'I',
  łódzkie: 'I',
  zachodniopomorskie: 'II',
  pomorskie: 'II',
  'kujawsko-pomorskie': 'II',
  wielkopolskie: 'II',
  lubuskie: 'III',
  dolnośląskie: 'III',
  opolskie: 'III',
  śląskie: 'III',
  lubelskie: 'IV',
  podkarpackie: 'IV',
  świętokrzyskie: 'IV',
  małopolskie: 'IV',
}

/** prawdziwe miejscowości województw dla fikcyjnych klubów, którymi dopełniamy niepełne grupy */
export const REGION_TOWNS: Record<string, string[]> = {
  dolnośląskie: [
    'Oleśnica', 'Trzebnica', 'Milicz', 'Strzelin', 'Oława', 'Brzeg Dolny', 'Wołów', 'Środa Śląska', 'Jawor',
    'Złotoryja', 'Chojnów', 'Bolków', 'Kamienna Góra', 'Lubawka', 'Ząbkowice Śląskie', 'Bardo', 'Ziębice',
    'Sobótka', 'Kąty Wrocławskie', 'Prusice', 'Żmigród', 'Wąsosz', 'Góra', 'Polanica-Zdrój', 'Lądek-Zdrój',
  ],
  'kujawsko-pomorskie': [
    'Ciechocinek', 'Aleksandrów Kujawski', 'Radziejów', 'Kruszwica', 'Strzelno', 'Mogilno', 'Żnin', 'Barcin',
    'Łabiszyn', 'Nakło nad Notecią', 'Sępólno Krajeńskie', 'Więcbork', 'Tuchola', 'Koronowo', 'Chełmża',
    'Golub-Dobrzyń', 'Rypin', 'Brodnica', 'Lubień Kujawski', 'Kowal', 'Choceń', 'Lubraniec', 'Izbica Kujawska',
  ],
  lubelskie: [
    'Kraśnik', 'Janów Lubelski', 'Biłgoraj', 'Tomaszów Lubelski', 'Hrubieszów', 'Krasnystaw', 'Łęczna',
    'Lubartów', 'Kock', 'Radzyń Podlaski', 'Parczew', 'Włodawa', 'Ryki', 'Dęblin', 'Opole Lubelskie',
    'Bełżyce', 'Nałęczów', 'Kazimierz Dolny', 'Szczebrzeszyn', 'Frampol', 'Tyszowce', 'Łaszczów', 'Turobin',
  ],
  lubuskie: [
    'Sulechów', 'Świebodzin', 'Międzyrzecz', 'Skwierzyna', 'Drezdenko', 'Strzelce Krajeńskie', 'Kostrzyn',
    'Słubice', 'Rzepin', 'Sulęcin', 'Krosno Odrzańskie', 'Lubsko', 'Żary', 'Żagań', 'Szprotawa', 'Nowa Sól',
    'Kożuchów', 'Wschowa', 'Sława', 'Babimost', 'Zbąszynek', 'Trzciel', 'Witnica',
  ],
  łódzkie: [
    'Zgierz', 'Ozorków', 'Łęczyca', 'Kutno', 'Żychlin', 'Głowno', 'Stryków', 'Brzeziny', 'Koluszki', 'Rawa Mazowiecka',
    'Opoczno', 'Drzewica', 'Przedbórz', 'Radomsko', 'Bełchatów', 'Zelów', 'Pabianice', 'Konstantynów Łódzki',
    'Aleksandrów Łódzki', 'Poddębice', 'Uniejów', 'Wieluń', 'Działoszyn', 'Pajęczno',
  ],
  małopolskie: [
    'Myślenice', 'Dobczyce', 'Limanowa', 'Mszana Dolna', 'Rabka-Zdrój', 'Jordanów', 'Sucha Beskidzka', 'Maków Podhalański',
    'Kalwaria Zebrzydowska', 'Andrychów', 'Kęty', 'Chrzanów', 'Trzebinia', 'Olkusz', 'Wolbrom', 'Miechów',
    'Proszowice', 'Słomniki', 'Bochnia', 'Brzesko', 'Wojnicz', 'Dąbrowa Tarnowska', 'Pcim', 'Szczawnica',
  ],
  mazowieckie: [
    'Mszczonów', 'Grójec', 'Warka', 'Białobrzegi', 'Góra Kalwaria', 'Garwolin', 'Łaskarzew', 'Żelechów',
    'Sokołów Podlaski', 'Węgrów', 'Łochów', 'Tłuszcz', 'Wyszków', 'Pułtusk', 'Nasielsk', 'Serock', 'Płońsk',
    'Raciąż', 'Sierpc', 'Gostynin', 'Sochaczew', 'Błonie', 'Żyrardów', 'Przasnysz', 'Maków Mazowiecki',
  ],
  opolskie: [
    'Krapkowice', 'Gogolin', 'Zdzieszowice', 'Strzelce Opolskie', 'Kolonowskie', 'Ozimek', 'Dobrodzień',
    'Olesno', 'Praszka', 'Gorzów Śląski', 'Byczyna', 'Wołczyn', 'Namysłów', 'Grodków', 'Lewin Brzeski',
    'Niemodlin', 'Prószków', 'Głuchołazy', 'Otmuchów', 'Paczków', 'Prudnik', 'Biała', 'Głogówek',
  ],
  podkarpackie: [
    'Łańcut', 'Przeworsk', 'Leżajsk', 'Nisko', 'Rudnik nad Sanem', 'Kolbuszowa', 'Ropczyce', 'Sędziszów Małopolski',
    'Strzyżów', 'Brzozów', 'Dynów', 'Sanok', 'Lesko', 'Ustrzyki Dolne', 'Jasło', 'Krosno', 'Dukla', 'Rymanów',
    'Iwonicz-Zdrój', 'Gorlice', 'Mielec', 'Radomyśl Wielki', 'Pruchnik', 'Kańczuga',
  ],
  podlaskie: [
    'Sokółka', 'Dąbrowa Białostocka', 'Augustów', 'Sejny', 'Grajewo', 'Mońki', 'Knyszyn', 'Choroszcz',
    'Łapy', 'Wysokie Mazowieckie', 'Ciechanowiec', 'Bielsk Podlaski', 'Hajnówka', 'Siemiatycze', 'Zabłudów',
    'Supraśl', 'Czarna Białostocka', 'Kolno', 'Stawiski', 'Tykocin', 'Goniądz', 'Michałowo',
  ],
  pomorskie: [
    'Kartuzy', 'Żukowo', 'Kościerzyna', 'Bytów', 'Miastko', 'Człuchów', 'Czersk', 'Brusy', 'Kępice', 'Lębork',
    'Łeba', 'Puck', 'Władysławowo', 'Wejherowo', 'Rumia', 'Pruszcz Gdański', 'Tczew', 'Pelplin', 'Gniew',
    'Kwidzyn', 'Prabuty', 'Sztum', 'Malbork', 'Nowy Dwór Gdański',
  ],
  śląskie: [
    'Pszczyna', 'Czechowice-Dziedzice', 'Żywiec', 'Węgierska Górka', 'Wisła', 'Ustroń', 'Skoczów', 'Strumień',
    'Wodzisław Śląski', 'Pszów', 'Radlin', 'Racibórz', 'Kuźnia Raciborska', 'Mikołów', 'Orzesze', 'Łaziska Górne',
    'Lubliniec', 'Kalety', 'Koziegłowy', 'Myszków', 'Żarki', 'Zawiercie', 'Pilica', 'Szczekociny',
  ],
  świętokrzyskie: [
    'Chęciny', 'Małogoszcz', 'Włoszczowa', 'Końskie', 'Stąporków', 'Skarżysko-Kamienna', 'Suchedniów',
    'Bodzentyn', 'Daleszyce', 'Chmielnik', 'Pińczów', 'Kazimierza Wielka', 'Opatów', 'Ćmielów', 'Kunów',
    'Sandomierz', 'Koprzywnica', 'Staszów', 'Osiek', 'Wąchock', 'Sędziszów', 'Wodzisław',
  ],
  'warmińsko-mazurskie': [
    'Ostróda', 'Morąg', 'Miłomłyn', 'Iława', 'Lubawa', 'Nowe Miasto Lubawskie', 'Działdowo', 'Nidzica',
    'Szczytno', 'Pasym', 'Mrągowo', 'Mikołajki', 'Pisz', 'Ruciane-Nida', 'Giżycko', 'Węgorzewo', 'Gołdap',
    'Olecko', 'Ełk', 'Biskupiec', 'Barczewo', 'Dobre Miasto', 'Orneta', 'Pieniężno',
  ],
  wielkopolskie: [
    'Wronki', 'Szamotuły', 'Oborniki', 'Rogoźno', 'Wągrowiec', 'Skoki', 'Murowana Goślina', 'Pobiedziska',
    'Kostrzyn', 'Środa', 'Śrem', 'Mosina', 'Grodzisk Wielkopolski', 'Nowy Tomyśl', 'Wolsztyn', 'Kościan',
    'Gostyń', 'Krotoszyn', 'Jarocin', 'Pleszew', 'Witkowo', 'Słupca', 'Koło', 'Turek', 'Kłodawa',
  ],
  zachodniopomorskie: [
    'Gryfino', 'Chojna', 'Pyrzyce', 'Choszczno', 'Recz', 'Drawsko Pomorskie', 'Złocieniec', 'Czaplinek',
    'Wałcz', 'Mirosławiec', 'Szczecinek', 'Barwice', 'Białogard', 'Karlino', 'Kołobrzeg', 'Trzebiatów',
    'Gryfice', 'Płoty', 'Nowogard', 'Goleniów', 'Kamień Pomorski', 'Wolin', 'Police', 'Darłowo',
  ],
}
