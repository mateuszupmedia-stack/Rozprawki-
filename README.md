# Sprawdzacz rozprawek

Aplikacja w przeglądarce dla nauczycieli języka polskiego. Sprawdza rozprawki uczniów (wklejony tekst, zdjęcia stron, skany, PDF) według wybranych kryteriów. Pokazuje:

- punkty za każde kryterium wraz z uzasadnieniem, sumę i proponowaną ocenę,
- listę błędów (ortografia, interpunkcja, język, styl, błędy rzeczowe…) z poprawkami,
- tekst pracy z zaznaczonymi błędami,
- mocne strony, elementy do poprawy i gotowy komentarz dla ucznia.

Nauczyciel może ręcznie poprawić każdy wynik. Historia prac zapisuje się w przeglądarce i można ją wyeksportować do pliku CSV (Excel).

## Uruchomienie

1. Załóż konto na <https://console.anthropic.com>, doładuj je (Billing) i utwórz klucz w **API Keys**.
2. Otwórz `index.html` w przeglądarce (Chrome, Edge, Firefox), albo opublikuj repozytorium przez **GitHub Pages**: Settings → Pages → Deploy from branch.
3. W zakładce **Ustawienia** wklej klucz API i kliknij **Zapisz**.
4. W zakładce **Sprawdź** wpisz temat, wklej pracę albo dodaj zdjęcia i kliknij **Sprawdź rozprawkę**.

## Struktura

| Plik | Co zawiera |
|---|---|
| `index.html` | układ strony: formularz, historia, ustawienia |
| `style.css` | wygląd (tryb jasny i ciemny, wersja mobilna, wydruk) |
| `script.js` | logika: wysyłanie do Claude API, ocena, historia, edytor kryteriów |

## Kryteria

- **Egzamin ósmoklasisty – rozprawka (20 pkt):** 8 kryteriów, od realizacji tematu po interpunkcję.
- **Szkolna – uproszczona (20 pkt):** do bieżących sprawdzianów.
- Możesz dodać własne zestawy i zmienić progi ocen w Ustawieniach.

> Domyślne kryteria egzaminacyjne opisano na podstawie zasad CKE. Przed użyciem porównaj je z aktualnym informatorem CKE i w razie potrzeby popraw w Ustawieniach.

## Koszt i prywatność

- Za każdą sprawdzoną pracę płacisz z konta Anthropic. Na modelu Opus 5.5 jedna praca kosztuje szacunkowo kilkadziesiąt groszy. Sonnet 5.5 jest mniej więcej o połowę tańszy.
- Treść pracy trafia do API Anthropic. Nie wpisuj imion i nazwisk uczniów, używaj inicjałów albo numerów z dziennika.
- Klucz API i historia są zapisane tylko w tej przeglądarce. Nie udostępniaj strony z wpisanym kluczem innym osobom.
- Wynik AI jest tylko propozycją. Ocenę zawsze wystawia nauczyciel.
