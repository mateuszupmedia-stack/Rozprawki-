# Sprawdzacz rozprawek

Aplikacja w przeglądarce dla nauczycieli języka polskiego. AI przejmuje część **merytoryczną** sprawdzania rozprawki, a nauczyciel sam sprawdza język, ortografię, interpunkcję i styl.

AI:
- **odczytuje pracę ze zdjęć** (także pismo odręczne), skanów lub PDF i pokazuje transkrypcję do porównania z oryginałem;
- ocenia **argumenty i przykłady**: czy są funkcjonalne, częściowo funkcjonalne czy niefunkcjonalne, skąd pochodzą i czy nie ma w nich błędów rzeczowych;
- ocenia **konteksty** (historyczny, biograficzny, filozoficzny…) i ich funkcjonalność;
- przyznaje punkty w kryteriach merytorycznych (realizacja tematu, elementy retoryczne, kompetencje literackie, kompozycja);
- pisze **komentarz dla ucznia**, który można edytować i skopiować.

Nauczyciel wpisuje punkty za styl, język, ortografię i interpunkcję. Suma i ocena przeliczają się automatycznie. Podział między AI a nauczyciela można zmienić w Ustawieniach (przełącznik „ocenia AI” przy każdym kryterium).

Historia prac zapisuje się w przeglądarce i można ją wyeksportować do pliku CSV (Excel).

## Uruchomienie

1. Załóż konto na <https://console.anthropic.com>, doładuj je (Billing) i utwórz klucz w **API Keys**.
2. Otwórz `index.html` w przeglądarce (Chrome, Edge, Firefox), albo opublikuj repozytorium przez **GitHub Pages**: Settings → Pages → Deploy from branch.
3. W zakładce **Ustawienia** wklej klucz API i kliknij **Zapisz**.
4. W zakładce **Sprawdź** wpisz temat, dodaj zdjęcia kolejnych stron (w kolejności) i kliknij **Sprawdź rozprawkę**. Na telefonie można od razu zrobić zdjęcie.
5. Porównaj transkrypcję z oryginałem, uzupełnij punkty za kryteria językowe i w razie potrzeby popraw komentarz.

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
