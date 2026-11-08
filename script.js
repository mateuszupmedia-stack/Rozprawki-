/* =====================================================================
   Sprawdzacz rozprawek – logika aplikacji
   Działa w całości w przeglądarce. Tekst/zdjęcia pracy są wysyłane
   bezpośrednio do Claude API (Anthropic) z kluczem nauczyciela.
   ===================================================================== */
'use strict';

/* ---------- Stałe ---------- */
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const STORAGE_SETTINGS = 'rozprawki.settings.v1';
const STORAGE_HISTORY = 'rozprawki.history.v1';
const MAX_IMAGE_SIDE = 2000;           // px – dłuższy bok zdjęcia po zmniejszeniu
const MAX_FILES = 10;

const ERROR_TYPES = ['ortografia', 'interpunkcja', 'jezyk', 'styl', 'rzeczowy', 'kompozycja', 'logika'];
const ERROR_LABELS = {
  ortografia: 'ortografia', interpunkcja: 'interpunkcja', jezyk: 'język',
  styl: 'styl', rzeczowy: 'błąd rzeczowy', kompozycja: 'kompozycja', logika: 'logika',
};

/* Wbudowane zestawy kryteriów. Nauczyciel może je edytować w Ustawieniach. */
const DEFAULT_PRESETS = {
  e8: {
    name: 'Egzamin ósmoklasisty – rozprawka (20 pkt)',
    rules:
      'Praca powinna mieć co najmniej 200 słów. Jeśli ma mniej niż 200 słów, oceniaj wyłącznie realizację tematu, ' +
      'elementy retoryczne i kompetencje literackie, a pozostałe kryteria oceń na 0 pkt. ' +
      'Jeśli praca nie jest rozprawką lub jest całkowicie niezgodna z tematem, wszystkie kryteria = 0 pkt. ' +
      'Uczeń musi odwołać się do lektury obowiązkowej (jeśli temat tego wymaga) i ewentualnie innego tekstu kultury. ' +
      'Kryteria ortografii, interpunkcji i języka: przy pracy krótszej niż 250 słów stosuj progi błędów proporcjonalnie surowiej.',
    criteria: [
      { id: 'c1', name: 'I. Realizacja tematu wypowiedzi', max: 2, desc: 'Forma rozprawki zachowana, wypowiedź w całości dotyczy problemu z tematu.' },
      { id: 'c2', name: 'II. Elementy retoryczne', max: 5, desc: 'Teza/stanowisko, argumenty pogłębione i rozwinięte, przykłady, logiczne wnioskowanie, podsumowanie. 5 pkt – pogłębiona argumentacja; 3 pkt – powierzchowna; 1 pkt – próba argumentowania.' },
      { id: 'c3', name: 'III. Kompetencje literackie i kulturowe', max: 2, desc: 'Funkcjonalne wykorzystanie znajomości lektury obowiązkowej i innego tekstu kultury, bez błędów rzeczowych.' },
      { id: 'c4', name: 'IV. Kompozycja tekstu', max: 2, desc: 'Kompozycja zgodna z formą, spójna i logiczna, właściwy podział na akapity.' },
      { id: 'c5', name: 'V. Styl', max: 2, desc: 'Styl odpowiedni do treści i formy, jednolity.' },
      { id: 'c6', name: 'VI. Język', max: 4, desc: 'Szeroki zakres środków językowych. Błędy językowe (składniowe, fleksyjne, leksykalne, frazeologiczne): 0–1 błąd = 4 pkt, 2–3 = 3 pkt, 4 = 2 pkt, 5–6 = 1 pkt (przy szerokim zakresie środków), więcej = 0 pkt.' },
      { id: 'c7', name: 'VII. Ortografia', max: 2, desc: '0–1 błąd = 2 pkt, 2–3 błędy = 1 pkt, 4 i więcej = 0 pkt.' },
      { id: 'c8', name: 'VIII. Interpunkcja', max: 1, desc: '0–5 błędów = 1 pkt, 6 i więcej = 0 pkt.' },
    ],
  },
  school: {
    name: 'Szkolna – uproszczona (20 pkt)',
    rules: 'Ocena bieżąca w klasie. Bądź wymagający, ale życzliwy. Oceniaj adekwatnie do poziomu klasy.',
    criteria: [
      { id: 's1', name: 'Teza / stanowisko', max: 2, desc: 'Jasno sformułowana teza lub hipoteza zgodna z tematem.' },
      { id: 's2', name: 'Argumentacja', max: 6, desc: 'Co najmniej 2–3 trafne, rozwinięte argumenty, logicznie uporządkowane.' },
      { id: 's3', name: 'Przykłady z lektur i tekstów kultury', max: 4, desc: 'Trafne, poprawne rzeczowo przykłady, powiązane z argumentami.' },
      { id: 's4', name: 'Kompozycja', max: 3, desc: 'Wstęp, rozwinięcie, zakończenie; akapity; spójność.' },
      { id: 's5', name: 'Język i styl', max: 3, desc: 'Poprawność językowa, bogate słownictwo, styl odpowiedni do formy.' },
      { id: 's6', name: 'Ortografia i interpunkcja', max: 2, desc: 'Do 2 błędów = 2 pkt, 3–5 = 1 pkt, więcej = 0 pkt.' },
    ],
  },
};

const DEFAULT_THRESHOLDS = { 2: 30, 3: 50, 4: 70, 5: 86, 6: 96 }; // minimalny % na daną ocenę
const GRADE_NAMES = { 1: 'niedostateczny', 2: 'dopuszczający', 3: 'dostateczny', 4: 'dobry', 5: 'bardzo dobry', 6: 'celujący' };

/* ---------- Pamięć przeglądarki (bezpieczne odczyty/zapisy) ---------- */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- Stan aplikacji ---------- */
const settings = Object.assign(
  { apiKey: '', model: 'claude-opus-5-5', effort: 'high', thresholds: { ...DEFAULT_THRESHOLDS }, presets: {}, lastPreset: 'e8' },
  loadJSON(STORAGE_SETTINGS, {})
);
let history = loadJSON(STORAGE_HISTORY, []);
let attachedFiles = [];      // { name, kind: 'image'|'pdf', mediaType, data(base64), preview }
let currentResult = null;    // ostatnio wyświetlony wynik (do edycji punktów)

/** Zwraca wszystkie zestawy: wbudowane (ew. nadpisane) + własne. */
function allPresets() {
  const merged = structuredClone(DEFAULT_PRESETS);
  for (const [id, preset] of Object.entries(settings.presets || {})) merged[id] = preset;
  return merged;
}

/* ---------- Skróty DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const countWords = (text) => (text.trim().match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;

/* =====================================================================
   NAWIGACJA
   ===================================================================== */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  if (name === 'history') renderHistory();
  if (name === 'check') updateKeyBanner();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));

function updateKeyBanner() {
  $('#no-key-banner').hidden = Boolean(settings.apiKey);
}

/* =====================================================================
   FORMULARZ: tryb tekst / plik
   ===================================================================== */
function fillPresetSelect(select, selectedId) {
  const presets = allPresets();
  select.innerHTML = Object.entries(presets)
    .map(([id, p]) => `<option value="${escapeHTML(id)}">${escapeHTML(p.name)}</option>`)
    .join('');
  select.value = presets[selectedId] ? selectedId : Object.keys(presets)[0];
}

document.querySelectorAll('input[name="input-mode"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="input-mode"]:checked').value;
    $('#mode-text').hidden = mode !== 'text';
    $('#mode-file').hidden = mode !== 'file';
  })
);

$('#essay-text').addEventListener('input', (e) => { $('#word-count').textContent = countWords(e.target.value); });

/* ----- Pliki ----- */
const dropzone = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
$('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

async function addFiles(fileList) {
  for (const file of fileList) {
    if (attachedFiles.length >= MAX_FILES) { showFormError(`Maksymalnie ${MAX_FILES} plików na jedną pracę.`); break; }
    try {
      if (file.type === 'text/plain') {
        // Plik TXT – wstawiamy do pola tekstowego i przełączamy tryb.
        $('#essay-text').value = await file.text();
        $('#essay-text').dispatchEvent(new Event('input'));
        document.querySelector('input[name="input-mode"][value="text"]').click();
      } else if (file.type === 'application/pdf') {
        if (file.size > 25 * 1024 * 1024) throw new Error('PDF jest za duży (max ok. 25 MB).');
        attachedFiles.push({ name: file.name, kind: 'pdf', mediaType: 'application/pdf', data: await fileToBase64(file) });
      } else if (file.type.startsWith('image/')) {
        const { data, mediaType, preview } = await prepareImage(file);
        attachedFiles.push({ name: file.name, kind: 'image', mediaType, data, preview });
      } else {
        throw new Error(`Nieobsługiwany typ pliku: ${file.name}`);
      }
    } catch (err) {
      showFormError(err.message);
    }
  }
  renderFileList();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`Nie udało się wczytać pliku ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Zmniejsza duże zdjęcia z telefonu (limit API ~5 MB na obraz) i zapisuje jako JPEG. */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl };
}

function renderFileList() {
  $('#file-list').innerHTML = attachedFiles.map((f, i) => `
    <li>
      ${f.kind === 'image' ? `<img src="${f.preview}" alt="Strona ${i + 1}: ${escapeHTML(f.name)}">` : '📄'}
      <span>${i + 1}. ${escapeHTML(f.name)}</span>
      <button type="button" class="btn btn--ghost btn--small" data-remove="${i}" aria-label="Usuń ${escapeHTML(f.name)}">✕</button>
    </li>`).join('');
  $('#file-list').querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => { attachedFiles.splice(Number(b.dataset.remove), 1); renderFileList(); }));
}

function showFormError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
}

$('#essay-form').addEventListener('reset', () => {
  attachedFiles = [];
  renderFileList();
  showFormError('');
  setTimeout(() => {
    $('#word-count').textContent = '0';
    $('#criteria-preset').value = settings.lastPreset in allPresets() ? settings.lastPreset : 'e8';
  });
});

/* =====================================================================
   WYSYŁANIE DO CLAUDE
   ===================================================================== */
$('#essay-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showFormError('');

  const mode = document.querySelector('input[name="input-mode"]:checked').value;
  const input = {
    student: $('#student').value.trim(),
    className: $('#class-name').value.trim(),
    topic: $('#topic').value.trim(),
    readings: $('#readings').value.trim(),
    extra: $('#extra').value.trim(),
    presetId: $('#criteria-preset').value,
    text: mode === 'text' ? $('#essay-text').value.trim() : '',
    files: mode === 'file' ? attachedFiles.slice() : [],
  };

  // --- Walidacja ---
  if (!settings.apiKey) return showFormError('Brak klucza API – uzupełnij go w Ustawieniach.');
  if (!input.topic) return showFormError('Wpisz temat rozprawki.');
  if (mode === 'text' && countWords(input.text) < 20) return showFormError('Wklej tekst pracy (co najmniej kilka zdań).');
  if (mode === 'file' && input.files.length === 0) return showFormError('Dodaj zdjęcie, skan lub PDF z pracą.');

  const preset = allPresets()[input.presetId];
  settings.lastPreset = input.presetId;
  saveJSON(STORAGE_SETTINGS, settings);

  setLoading(true);
  try {
    const assessment = await assessEssay(input, preset);
    const record = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      student: input.student,
      className: input.className,
      topic: input.topic,
      presetName: preset.name,
      essayText: input.text || assessment.transcription || '',
      wordCount: input.text ? countWords(input.text) : assessment.word_count,
      model: assessment._model,
      assessment,
      criteriaDef: preset.criteria,
    };
    history.unshift(record);
    if (!saveJSON(STORAGE_HISTORY, history)) {
      history = history.slice(0, 50); // pamięć pełna – zostawiamy ostatnie 50
      saveJSON(STORAGE_HISTORY, history);
    }
    renderResult(record);
  } catch (err) {
    showFormError(err.message || String(err));
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  $('#loading').hidden = !on;
  $('#submit-btn').disabled = on;
  $('#submit-btn').textContent = on ? 'Sprawdzam…' : 'Sprawdź rozprawkę';
  if (on) { $('#result').innerHTML = ''; $('#loading').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

/** Schemat JSON odpowiedzi – wymusza uporządkowany wynik (structured outputs). */
function buildSchema(preset) {
  const str = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['transcription', 'word_count', 'thesis', 'summary', 'criteria', 'errors', 'strengths', 'improvements', 'feedback_for_student', 'teacher_notes'],
    properties: {
      transcription: { type: 'string', description: 'Dokładna transkrypcja pracy, jeśli przesłano zdjęcie/PDF (z zachowaniem błędów ucznia i akapitów). Pusty string, jeśli przesłano tekst.' },
      word_count: { type: 'integer', description: 'Liczba słów w pracy.' },
      thesis: { type: 'string', description: 'Teza/stanowisko ucznia własnymi słowami; "brak tezy", jeśli jej nie ma.' },
      summary: { type: 'string', description: 'Ogólna ocena pracy w 2–4 zdaniach dla nauczyciela.' },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'points', 'justification'],
          properties: {
            id: { type: 'string', enum: preset.criteria.map((c) => c.id) },
            points: { type: 'integer' },
            justification: str,
          },
        },
      },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'quote', 'correction', 'explanation'],
          properties: {
            type: { type: 'string', enum: ERROR_TYPES },
            quote: { type: 'string', description: 'Fragment DOKŁADNIE skopiowany z pracy (kilka słów), zawierający błąd.' },
            correction: { type: 'string', description: 'Poprawiona wersja fragmentu.' },
            explanation: { type: 'string', description: 'Krótkie wyjaśnienie zasady.' },
          },
        },
      },
      strengths: { type: 'array', items: str },
      improvements: { type: 'array', items: str },
      feedback_for_student: { type: 'string', description: 'Komentarz do ucznia: życzliwy, konkretny, 4–8 zdań, w 2. osobie.' },
      teacher_notes: { type: 'string', description: 'Uwagi/wątpliwości dla nauczyciela (np. nieczytelne fragmenty, sporne punkty). Pusty string, jeśli brak.' },
    },
  };
}

function buildSystemPrompt() {
  return [
    'Jesteś doświadczonym egzaminatorem i nauczycielem języka polskiego. Sprawdzasz rozprawki uczniów polskiej szkoły rzetelnie, sprawiedliwie i zgodnie z podanymi kryteriami.',
    'Zasady:',
    '- Oceniaj wyłącznie według podanych kryteriów i zasad zestawu. Dla każdego kryterium podaj liczbę punktów (liczba całkowita od 0 do maksimum) i konkretne uzasadnienie odwołujące się do treści pracy.',
    '- Licz błędy starannie i wypisz każdy błąd ortograficzny, interpunkcyjny i językowy osobno. Pole "quote" musi być dosłownym fragmentem pracy (kopiuj znak w znak, łącznie z błędem), aby nauczyciel mógł go odnaleźć.',
    '- Nie wymyślaj błędów. Jeśli coś jest dopuszczalne według normy wzorcowej lub użytkowej, nie zaznaczaj tego jako błąd.',
    '- Sprawdź poprawność rzeczową odwołań do lektur (bohaterowie, wydarzenia). Błędy rzeczowe oznacz typem "rzeczowy".',
    '- Jeśli praca jest na zdjęciu lub w PDF, najpierw dokładnie ją przepisz (pole "transcription"), zachowując oryginalną pisownię ucznia. Fragmenty nieczytelne oznacz jako [nieczytelne] i wspomnij o nich w "teacher_notes"; nie licz ich jako błędów.',
    '- Komentarz dla ucznia pisz życzliwie i konkretnie: co wyszło dobrze, co poprawić i jak.',
    '- Wszystkie odpowiedzi pisz po polsku.',
  ].join('\n');
}

function buildUserText(input, preset) {
  const criteriaText = preset.criteria
    .map((c) => `- [${c.id}] ${c.name} (0–${c.max} pkt): ${c.desc}`)
    .join('\n');
  return [
    `TEMAT ROZPRAWKI:\n${input.topic}`,
    input.readings ? `WYMAGANE LEKTURY / TEKSTY:\n${input.readings}` : '',
    input.className ? `KLASA: ${input.className}` : '',
    `ZESTAW KRYTERIÓW: ${preset.name}\nZasady ogólne: ${preset.rules || 'brak'}\nKryteria:\n${criteriaText}`,
    input.extra ? `DODATKOWE WSKAZÓWKI NAUCZYCIELA:\n${input.extra}` : '',
    input.text
      ? `PRACA UCZNIA (liczba słów policzona automatycznie: ${countWords(input.text)}):\n"""\n${input.text}\n"""`
      : `PRACA UCZNIA znajduje się w załączonych plikach (${input.files.length} – kolejne strony w podanej kolejności). Najpierw ją przepisz, potem oceń.`,
    'Oceń pracę i zwróć wynik w wymaganym formacie JSON. Uwzględnij każde kryterium dokładnie raz.',
  ].filter(Boolean).join('\n\n');
}

async function assessEssay(input, preset) {
  // Treść wiadomości: najpierw pliki (zdjęcia/PDF), potem polecenie.
  const content = input.files.map((f) =>
    f.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: f.mediaType, data: f.data } }
      : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } }
  );
  content.push({ type: 'text', text: buildUserText(input, preset) });

  const body = {
    model: settings.model,
    max_tokens: 16000,
    system: buildSystemPrompt(),
    output_config: {
      effort: settings.effort,
      format: { type: 'json_schema', schema: buildSchema(preset) },
    },
    fallbacks: 'default', // gdy filtr bezpieczeństwa odmówi – API samo spróbuje innym modelem
    messages: [{ role: 'user', content }],
  };

  let response = await postToClaude(body, true);

  // Gdyby konto nie obsługiwało funkcji "fallbacks" – ponów bez niej.
  if (response.status === 400) {
    const errText = await response.clone().text();
    if (/fallback/i.test(errText)) {
      delete body.fallbacks;
      response = await postToClaude(body, false);
    }
  }

  if (!response.ok) throw new Error(await describeApiError(response));

  const message = await response.json();
  if (message.stop_reason === 'refusal') {
    throw new Error('Model odmówił sprawdzenia tej pracy (filtr bezpieczeństwa). Spróbuj ponownie lub zmień model w Ustawieniach.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('Odpowiedź została ucięta (zbyt długa praca). Spróbuj niższej staranności analizy lub podziel pracę.');
  }

  const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Nie udało się odczytać odpowiedzi modelu. Spróbuj ponownie.');
  }
  data._model = message.model;
  return normalizeAssessment(data, preset);
}

function postToClaude(body, withFallbackBeta) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (withFallbackBeta) headers['anthropic-beta'] = FALLBACK_BETA;
  return fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => {
    throw new Error('Brak połączenia z serwerem Anthropic. Sprawdź internet.');
  });
}

async function describeApiError(response) {
  let detail = '';
  try { detail = (await response.json())?.error?.message || ''; } catch { /* brak treści */ }
  const known = {
    401: 'Nieprawidłowy klucz API – sprawdź go w Ustawieniach.',
    403: 'Klucz API nie ma uprawnień do tego modelu.',
    413: 'Pliki są za duże. Zmniejsz liczbę lub rozmiar zdjęć.',
    429: 'Zbyt wiele zapytań lub wyczerpany limit – odczekaj chwilę.',
    529: 'Serwery Anthropic są przeciążone – spróbuj za minutę.',
  };
  if (/credit balance/i.test(detail)) return 'Brak środków na koncie Anthropic – doładuj konto w console.anthropic.com (Billing).';
  return `${known[response.status] || `Błąd API (${response.status}).`}${detail ? ` Szczegóły: ${detail}` : ''}`;
}

/** Porządkuje wynik: kolejność kryteriów, zakres punktów, brakujące pola. */
function normalizeAssessment(data, preset) {
  const byId = new Map((data.criteria || []).map((c) => [c.id, c]));
  data.criteria = preset.criteria.map((def) => {
    const got = byId.get(def.id) || { points: 0, justification: 'Model nie ocenił tego kryterium – uzupełnij ręcznie.' };
    const points = Math.max(0, Math.min(def.max, Math.round(Number(got.points) || 0)));
    return { id: def.id, points, justification: got.justification || '' };
  });
  data.errors = Array.isArray(data.errors) ? data.errors : [];
  data.strengths = Array.isArray(data.strengths) ? data.strengths : [];
  data.improvements = Array.isArray(data.improvements) ? data.improvements : [];
  return data;
}

/* =====================================================================
   PREZENTACJA WYNIKU
   ===================================================================== */
function gradeFor(percent) {
  const t = settings.thresholds;
  for (let g = 6; g >= 2; g--) if (percent >= Number(t[g])) return g;
  return 1;
}

function totals(record) {
  const max = record.criteriaDef.reduce((s, c) => s + Number(c.max), 0);
  const got = record.assessment.criteria.reduce((s, c) => s + Number(c.points), 0);
  const percent = max ? Math.round((got / max) * 100) : 0;
  return { got, max, percent, grade: gradeFor(percent) };
}

/** Zaznacza w tekście fragmenty z błędami (<mark> z podpowiedzią). */
function highlightEssay(text, errors) {
  const ranges = [];
  for (const err of errors) {
    const quote = (err.quote || '').trim();
    if (quote.length < 2) continue;
    let from = 0, idx;
    // Szukamy pierwszego wolnego (niezaznaczonego) wystąpienia; najpierw dokładnie, potem bez wielkości liter.
    const haystack = text.includes(quote) ? text : text.toLowerCase();
    const needle = haystack === text ? quote : quote.toLowerCase();
    while ((idx = haystack.indexOf(needle, from)) !== -1) {
      const end = idx + quote.length;
      if (!ranges.some((r) => idx < r.end && end > r.start)) { ranges.push({ start: idx, end, err }); break; }
      from = idx + 1;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let html = '', pos = 0;
  for (const r of ranges) {
    html += escapeHTML(text.slice(pos, r.start));
    const tip = `${ERROR_LABELS[r.err.type] || r.err.type}: ${r.err.correction} – ${r.err.explanation}`;
    html += `<mark class="t-${escapeHTML(r.err.type)}" title="${escapeHTML(tip)}">${escapeHTML(text.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  }
  return html + escapeHTML(text.slice(pos));
}

function renderResult(record) {
  currentResult = record;
  const a = record.assessment;
  const t = totals(record);
  const defs = new Map(record.criteriaDef.map((c) => [c.id, c]));
  const errorCounts = ERROR_TYPES
    .map((type) => [type, a.errors.filter((e) => e.type === type).length])
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `<span class="pill pill--${type}">${ERROR_LABELS[type]}: ${n}</span>`).join(' ');

  $('#result').innerHTML = `
    <div class="card">
      <div class="row-between">
        <div class="score">
          <div class="score__big"><span id="total-got">${t.got}</span> / ${t.max} pkt</div>
          <div class="score__grade" id="total-grade">${t.percent}% · ${t.grade} (${GRADE_NAMES[t.grade]})</div>
        </div>
        <div class="actions no-print">
          <button type="button" class="btn btn--ghost" id="copy-feedback">Kopiuj komentarz</button>
          <button type="button" class="btn btn--ghost" onclick="window.print()">Drukuj / PDF</button>
        </div>
      </div>
      <p class="score__meta">
        ${record.student ? `Uczeń: <strong>${escapeHTML(record.student)}</strong> · ` : ''}${record.className ? `Klasa: ${escapeHTML(record.className)} · ` : ''}
        Słów: ${record.wordCount ?? '–'} · ${escapeHTML(record.presetName)} · ${new Date(record.date).toLocaleString('pl-PL')}
      </p>
      <p><strong>Temat:</strong> ${escapeHTML(record.topic)}</p>
      <p><strong>Teza ucznia:</strong> ${escapeHTML(a.thesis)}</p>
      <p>${escapeHTML(a.summary)}</p>
      ${a.teacher_notes ? `<div class="notes"><strong>Uwagi dla nauczyciela:</strong> ${escapeHTML(a.teacher_notes)}</div>` : ''}
    </div>

    <div class="card">
      <h2>Punktacja</h2>
      <p class="hint no-print">Możesz poprawić punkty – suma i ocena przeliczą się automatycznie, a zmiana zapisze się w historii.</p>
      <div class="table-scroll">
      <table class="criteria-table">
        <thead><tr><th>Kryterium</th><th>Punkty</th><th>Uzasadnienie</th></tr></thead>
        <tbody>
          ${a.criteria.map((c) => {
            const def = defs.get(c.id) || { name: c.id, max: 0 };
            return `<tr>
              <td><strong>${escapeHTML(def.name)}</strong>
                <div class="bar"><i style="width:${def.max ? (c.points / def.max) * 100 : 0}%"></i></div></td>
              <td class="pts"><input type="number" min="0" max="${def.max}" step="1" value="${c.points}" data-crit="${escapeHTML(c.id)}" aria-label="Punkty: ${escapeHTML(def.name)}"> / ${def.max}</td>
              <td>${escapeHTML(c.justification)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>

    <div class="card">
      <div class="cols">
        <div><h2>Mocne strony</h2><ul>${a.strengths.map((s) => `<li>${escapeHTML(s)}</li>`).join('') || '<li>–</li>'}</ul></div>
        <div><h2>Do poprawy</h2><ul>${a.improvements.map((s) => `<li>${escapeHTML(s)}</li>`).join('') || '<li>–</li>'}</ul></div>
      </div>
    </div>

    <div class="card">
      <h2>Komentarz dla ucznia</h2>
      <div class="feedback" id="feedback-text">${escapeHTML(a.feedback_for_student)}</div>
    </div>

    <div class="card">
      <h2>Błędy (${a.errors.length})</h2>
      <p>${errorCounts || 'Nie znaleziono błędów.'}</p>
      <ul class="errors-list">
        ${a.errors.map((e) => `<li>
          <span class="pill pill--${escapeHTML(e.type)}">${escapeHTML(ERROR_LABELS[e.type] || e.type)}</span>
          <q>${escapeHTML(e.quote)}</q> → <span class="fix">${escapeHTML(e.correction)}</span>
          <div class="hint">${escapeHTML(e.explanation)}</div>
        </li>`).join('')}
      </ul>
    </div>

    ${record.essayText ? `
    <div class="card">
      <h2>Praca ucznia z zaznaczonymi błędami</h2>
      <p class="hint">Najedź na zaznaczenie, aby zobaczyć poprawkę.</p>
      <div class="essay">${highlightEssay(record.essayText, a.errors)}</div>
    </div>` : ''}
  `;

  // Ręczna korekta punktów przez nauczyciela.
  $('#result').querySelectorAll('input[data-crit]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const def = defs.get(inp.dataset.crit);
      const value = Math.max(0, Math.min(def.max, Math.round(Number(inp.value) || 0)));
      inp.value = value;
      currentResult.assessment.criteria.find((c) => c.id === inp.dataset.crit).points = value;
      inp.closest('tr').querySelector('.bar > i').style.width = `${def.max ? (value / def.max) * 100 : 0}%`;
      const nt = totals(currentResult);
      $('#total-got').textContent = nt.got;
      $('#total-grade').textContent = `${nt.percent}% · ${nt.grade} (${GRADE_NAMES[nt.grade]})`;
      saveJSON(STORAGE_HISTORY, history);
    }));

  $('#copy-feedback').addEventListener('click', async (e) => {
    const nt = totals(currentResult);
    const text = `Wynik: ${nt.got}/${nt.max} pkt (${nt.percent}%), ocena: ${nt.grade}\n\n${a.feedback_for_student}`;
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'Skopiowano ✓'; }
    catch { e.target.textContent = 'Nie udało się skopiować'; }
  });

  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* =====================================================================
   HISTORIA
   ===================================================================== */
function renderHistory() {
  if (!history.length) { $('#history-list').innerHTML = '<p class="hint">Brak sprawdzonych prac.</p>'; return; }
  $('#history-list').innerHTML = `
    <div class="table-scroll"><table class="history-table">
      <thead><tr><th>Data</th><th>Uczeń</th><th>Klasa</th><th>Temat</th><th>Wynik</th><th>Ocena</th><th></th></tr></thead>
      <tbody>${history.map((r) => {
        const t = totals(r);
        return `<tr>
          <td>${new Date(r.date).toLocaleDateString('pl-PL')}</td>
          <td>${escapeHTML(r.student || '–')}</td>
          <td>${escapeHTML(r.className || '–')}</td>
          <td>${escapeHTML(r.topic.length > 60 ? r.topic.slice(0, 60) + '…' : r.topic)}</td>
          <td>${t.got}/${t.max}</td>
          <td>${t.grade}</td>
          <td><button type="button" class="btn btn--ghost btn--small" data-open="${r.id}">Otwórz</button>
              <button type="button" class="btn btn--ghost btn--small danger" data-del="${r.id}" aria-label="Usuń">✕</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

  $('#history-list').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const rec = history.find((r) => r.id === b.dataset.open);
    showView('check');
    renderResult(rec);
  }));
  $('#history-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Usunąć tę pracę z historii?')) return;
    history = history.filter((r) => r.id !== b.dataset.del);
    saveJSON(STORAGE_HISTORY, history);
    renderHistory();
  }));
}

$('#clear-history').addEventListener('click', () => {
  if (!history.length || !confirm('Usunąć całą historię? Tej operacji nie można cofnąć.')) return;
  history = [];
  saveJSON(STORAGE_HISTORY, history);
  renderHistory();
});

$('#export-csv').addEventListener('click', () => {
  if (!history.length) return;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data', 'Uczeń', 'Klasa', 'Temat', 'Kryteria', 'Punkty', 'Maks.', 'Procent', 'Ocena', 'Liczba błędów', 'Komentarz']];
  for (const r of history) {
    const t = totals(r);
    rows.push([new Date(r.date).toLocaleString('pl-PL'), r.student, r.className, r.topic, r.presetName,
      t.got, t.max, t.percent, t.grade, r.assessment.errors.length, r.assessment.feedback_for_student]);
  }
  // BOM (﻿) – żeby Excel poprawnie pokazał polskie znaki; średnik – separator dla polskiego Excela.
  const csv = '﻿' + rows.map((row) => row.map(cell).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `rozprawki-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

/* =====================================================================
   USTAWIENIA
   ===================================================================== */
let editingPresetId = settings.lastPreset;
let editingPreset = null; // kopia robocza edytowanego zestawu

function loadSettingsForm() {
  $('#api-key').value = settings.apiKey;
  $('#model').value = settings.model;
  $('#effort').value = settings.effort;
  $('#grade-thresholds').innerHTML = [2, 3, 4, 5, 6].map((g) => `
    <label>${g} – ${GRADE_NAMES[g]} od
      <input type="number" min="0" max="100" data-grade="${g}" value="${settings.thresholds[g]}"> %
    </label>`).join('') + '<label>1 – poniżej progu na 2</label>';
  fillPresetSelect($('#criteria-edit-preset'), editingPresetId);
  editingPresetId = $('#criteria-edit-preset').value;
  loadPresetEditor();
}

function loadPresetEditor() {
  editingPreset = structuredClone(allPresets()[editingPresetId]);
  $('#preset-name').value = editingPreset.name;
  $('#preset-rules').value = editingPreset.rules || '';
  $('#reset-preset').hidden = !(editingPresetId in DEFAULT_PRESETS);
  renderCriteriaEditor();
}

function renderCriteriaEditor() {
  $('#criteria-editor').innerHTML = editingPreset.criteria.map((c, i) => `
    <div class="crit-row">
      <input type="text" value="${escapeHTML(c.name)}" data-i="${i}" data-k="name" aria-label="Nazwa kryterium">
      <input type="number" min="1" value="${c.max}" data-i="${i}" data-k="max" aria-label="Maks. punktów">
      <button type="button" class="btn btn--ghost btn--small danger" data-del-crit="${i}" aria-label="Usuń kryterium">✕</button>
      <textarea rows="2" data-i="${i}" data-k="desc" aria-label="Opis kryterium">${escapeHTML(c.desc)}</textarea>
    </div>`).join('');
  $('#criteria-total').textContent = editingPreset.criteria.reduce((s, c) => s + Number(c.max), 0);

  $('#criteria-editor').querySelectorAll('[data-k]').forEach((el) => el.addEventListener('input', () => {
    const c = editingPreset.criteria[Number(el.dataset.i)];
    c[el.dataset.k] = el.dataset.k === 'max' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value;
    $('#criteria-total').textContent = editingPreset.criteria.reduce((s, x) => s + Number(x.max), 0);
  }));
  $('#criteria-editor').querySelectorAll('[data-del-crit]').forEach((b) => b.addEventListener('click', () => {
    if (editingPreset.criteria.length <= 1) return;
    editingPreset.criteria.splice(Number(b.dataset.delCrit), 1);
    renderCriteriaEditor();
  }));
}

$('#criteria-edit-preset').addEventListener('change', (e) => { editingPresetId = e.target.value; loadPresetEditor(); });

$('#add-criterion').addEventListener('click', () => {
  editingPreset.criteria.push({ id: `k${Date.now().toString(36)}`, name: 'Nowe kryterium', max: 2, desc: '' });
  renderCriteriaEditor();
});

$('#add-preset').addEventListener('click', () => {
  const id = `own_${Date.now().toString(36)}`;
  settings.presets[id] = {
    name: 'Mój zestaw',
    rules: '',
    criteria: [{ id: 'k1', name: 'Nowe kryterium', max: 5, desc: '' }],
  };
  editingPresetId = id;
  saveJSON(STORAGE_SETTINGS, settings);
  loadSettingsForm();
  fillPresetSelect($('#criteria-preset'), settings.lastPreset);
});

$('#reset-preset').addEventListener('click', () => {
  if (!confirm('Przywrócić domyślne kryteria tego zestawu?')) return;
  delete settings.presets[editingPresetId];
  saveJSON(STORAGE_SETTINGS, settings);
  loadSettingsForm();
  fillPresetSelect($('#criteria-preset'), settings.lastPreset);
});

$('#save-settings').addEventListener('click', () => {
  settings.apiKey = $('#api-key').value.trim();
  settings.model = $('#model').value;
  settings.effort = $('#effort').value;
  document.querySelectorAll('[data-grade]').forEach((inp) => {
    settings.thresholds[inp.dataset.grade] = Math.max(0, Math.min(100, Number(inp.value) || 0));
  });
  editingPreset.name = $('#preset-name').value.trim() || 'Bez nazwy';
  editingPreset.rules = $('#preset-rules').value.trim();
  settings.presets[editingPresetId] = editingPreset;

  const ok = saveJSON(STORAGE_SETTINGS, settings);
  fillPresetSelect($('#criteria-preset'), settings.lastPreset);
  fillPresetSelect($('#criteria-edit-preset'), editingPresetId);
  updateKeyBanner();
  const msg = $('#settings-saved');
  msg.textContent = ok ? 'Zapisano ✓' : 'Nie udało się zapisać (przeglądarka blokuje pamięć).';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 2500);
});

/* ---------- Start ---------- */
fillPresetSelect($('#criteria-preset'), settings.lastPreset);
loadSettingsForm();
updateKeyBanner();
