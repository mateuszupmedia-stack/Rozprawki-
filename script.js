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

/* Ocena funkcjonalności przykładów i kontekstów */
const FUNC_VALUES = ['funkcjonalny', 'częściowo funkcjonalny', 'niefunkcjonalny'];
const FUNC_CLASS = { 'funkcjonalny': 'good', 'częściowo funkcjonalny': 'mid', 'niefunkcjonalny': 'bad' };
const SOURCE_TYPES = ['lektura obowiązkowa', 'inny tekst kultury', 'wydarzenie historyczne', 'przykład z życia', 'brak przykładu'];
const CONTEXT_TYPES = ['historyczny', 'historycznoliteracki', 'biograficzny', 'filozoficzny', 'kulturowy', 'społeczny', 'religijny', 'biblijny', 'mitologiczny', 'egzystencjalny', 'inny'];

/* Wbudowane zestawy kryteriów. Nauczyciel może je edytować w Ustawieniach. */
const DEFAULT_PRESETS = {
  e8: {
    name: 'Egzamin ósmoklasisty – rozprawka (20 pkt)',
    rules:
      'Praca powinna mieć co najmniej 200 słów. Jeśli ma mniej niż 200 słów, oceniaj wyłącznie realizację tematu, ' +
      'elementy retoryczne i kompetencje literackie, a pozostałe kryteria oceń na 0 pkt. ' +
      'Jeśli praca nie jest rozprawką lub jest całkowicie niezgodna z tematem, wszystkie kryteria = 0 pkt. ' +
      'Uczeń musi odwołać się do lektury obowiązkowej (jeśli temat tego wymaga) i ewentualnie innego tekstu kultury.',
    criteria: [
      { id: 'c1', name: 'I. Realizacja tematu wypowiedzi', max: 2, desc: 'Forma rozprawki zachowana, wypowiedź w całości dotyczy problemu z tematu.', ai: true },
      { id: 'c2', name: 'II. Elementy retoryczne', max: 5, desc: 'Teza/stanowisko, argumenty pogłębione i rozwinięte, przykłady, logiczne wnioskowanie, podsumowanie. 5 pkt – pogłębiona argumentacja; 3 pkt – powierzchowna; 1 pkt – próba argumentowania.', ai: true },
      { id: 'c3', name: 'III. Kompetencje literackie i kulturowe', max: 2, desc: 'Funkcjonalne wykorzystanie znajomości lektury obowiązkowej i innego tekstu kultury, bez błędów rzeczowych.', ai: true },
      { id: 'c4', name: 'IV. Kompozycja tekstu', max: 2, desc: 'Kompozycja zgodna z formą, spójna i logiczna, właściwy podział na akapity.', ai: true },
      { id: 'c5', name: 'V. Styl', max: 2, desc: 'Styl odpowiedni do treści i formy, jednolity.', ai: false },
      { id: 'c6', name: 'VI. Język', max: 4, desc: 'Szeroki zakres środków językowych. Błędy językowe (składniowe, fleksyjne, leksykalne, frazeologiczne): 0–1 błąd = 4 pkt, 2–3 = 3 pkt, 4 = 2 pkt, 5–6 = 1 pkt (przy szerokim zakresie środków), więcej = 0 pkt.', ai: false },
      { id: 'c7', name: 'VII. Ortografia', max: 2, desc: '0–1 błąd = 2 pkt, 2–3 błędy = 1 pkt, 4 i więcej = 0 pkt.', ai: false },
      { id: 'c8', name: 'VIII. Interpunkcja', max: 1, desc: '0–5 błędów = 1 pkt, 6 i więcej = 0 pkt.', ai: false },
    ],
  },
  school: {
    name: 'Szkolna – uproszczona (20 pkt)',
    rules: 'Ocena bieżąca w klasie. Bądź wymagający, ale życzliwy. Oceniaj adekwatnie do poziomu klasy.',
    criteria: [
      { id: 's1', name: 'Teza / stanowisko', max: 2, desc: 'Jasno sformułowana teza lub hipoteza zgodna z tematem.', ai: true },
      { id: 's2', name: 'Argumentacja', max: 6, desc: 'Co najmniej 2–3 trafne, rozwinięte argumenty, logicznie uporządkowane.', ai: true },
      { id: 's3', name: 'Przykłady z lektur i tekstów kultury', max: 4, desc: 'Trafne, poprawne rzeczowo przykłady, powiązane z argumentami.', ai: true },
      { id: 's4', name: 'Kompozycja', max: 3, desc: 'Wstęp, rozwinięcie, zakończenie; akapity; spójność.', ai: true },
      { id: 's5', name: 'Język i styl', max: 3, desc: 'Poprawność językowa, bogate słownictwo, styl odpowiedni do formy.', ai: false },
      { id: 's6', name: 'Ortografia i interpunkcja', max: 2, desc: 'Do 2 błędów = 2 pkt, 3–5 = 1 pkt, więcej = 0 pkt.', ai: false },
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
  // Kopia listy – FileList jest "żywy" i znika po wyczyszczeniu pola wyboru plików.
  const files = Array.from(fileList);
  for (const file of files) {
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

/** Obraca przygotowane zdjęcie o 90° w prawo (gdy telefon zapisał je bokiem). */
async function rotateImage(file) {
  const img = new Image();
  img.src = file.preview;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.height;
  canvas.height = img.width;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  file.preview = dataUrl;
  file.data = dataUrl.split(',')[1];
}

function renderFileList() {
  const last = attachedFiles.length - 1;
  $('#file-list').innerHTML = attachedFiles.map((f, i) => `
    <li class="page">
      ${f.kind === 'image'
        ? `<a href="${f.preview}" target="_blank" rel="noopener" title="Otwórz w pełnym rozmiarze"><img src="${f.preview}" alt="Strona ${i + 1}: ${escapeHTML(f.name)}"></a>`
        : '<span class="page__pdf">PDF</span>'}
      <span class="page__name">Strona ${i + 1}</span>
      <span class="page__tools">
        <button type="button" class="btn btn--ghost btn--small" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Przesuń wcześniej">◀</button>
        ${f.kind === 'image' ? `<button type="button" class="btn btn--ghost btn--small" data-rotate="${i}" aria-label="Obróć o 90°">↻</button>` : ''}
        <button type="button" class="btn btn--ghost btn--small" data-move="${i}" data-dir="1" ${i === last ? 'disabled' : ''} aria-label="Przesuń później">▶</button>
        <button type="button" class="btn btn--ghost btn--small danger" data-remove="${i}" aria-label="Usuń stronę ${i + 1}">✕</button>
      </span>
    </li>`).join('');
  const list = $('#file-list');
  list.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => { attachedFiles.splice(Number(b.dataset.remove), 1); renderFileList(); }));
  list.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.move), j = i + Number(b.dataset.dir);
    [attachedFiles[i], attachedFiles[j]] = [attachedFiles[j], attachedFiles[i]];
    renderFileList();
  }));
  list.querySelectorAll('[data-rotate]').forEach((b) => b.addEventListener('click', async () => {
    await rotateImage(attachedFiles[Number(b.dataset.rotate)]);
    renderFileList();
  }));
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
      readings: input.readings,
      extra: input.extra,
      presetId: input.presetId,
      presetName: preset.name,
      handwritten: !input.text,
      essayText: input.text || assessment.transcription || '',
      wordCount: input.text ? countWords(input.text) : assessment.word_count,
      model: assessment._model,
      assessment,
      criteriaDef: preset.criteria,
    };
    history.unshift(record);
    saveHistory();
    renderResult(record);
  } catch (err) {
    showFormError(err.message || String(err));
  } finally {
    setLoading(false);
  }
});

function saveHistory() {
  if (!saveJSON(STORAGE_HISTORY, history)) {
    history = history.slice(0, 50); // pamięć pełna – zostawiamy ostatnie 50
    saveJSON(STORAGE_HISTORY, history);
  }
}

/**
 * Ponowna ocena na podstawie transkrypcji poprawionej przez nauczycielkę
 * (bez zdjęć – szybciej i taniej). Punkty wpisane przez nauczycielkę zostają.
 */
async function reassessFromText(record, correctedText, button, errorEl) {
  const presets = allPresets();
  const presetId = record.presetId && presets[record.presetId]
    ? record.presetId
    : Object.keys(presets).find((id) => presets[id].name === record.presetName) || 'e8';
  const preset = presets[presetId];
  const input = {
    student: record.student, className: record.className, topic: record.topic,
    readings: record.readings || '', extra: record.extra || '', presetId,
    text: correctedText, files: [], fromHandwriting: true,
  };
  button.disabled = true;
  button.textContent = 'Oceniam ponownie…';
  errorEl.hidden = true;
  try {
    const assessment = await assessEssay(input, preset);
    // Zachowaj punkty nauczycielki z poprzedniej wersji.
    const teacherPoints = new Map(record.assessment.criteria.filter((c) => c.byTeacher).map((c) => [c.id, c.points]));
    assessment.criteria.forEach((c) => { if (c.byTeacher && teacherPoints.has(c.id)) c.points = teacherPoints.get(c.id); });
    assessment.transcription = correctedText;
    Object.assign(record, {
      essayText: correctedText, wordCount: countWords(correctedText), assessment,
      criteriaDef: preset.criteria, presetId, presetName: preset.name, model: assessment._model,
    });
    saveHistory();
    renderResult(record);
  } catch (err) {
    errorEl.textContent = err.message || String(err);
    errorEl.hidden = false;
    button.disabled = false;
    button.textContent = 'Oceń ponownie na podstawie poprawionego tekstu';
  }
}

function setLoading(on) {
  $('#loading').hidden = !on;
  $('#submit-btn').disabled = on;
  $('#submit-btn').textContent = on ? 'Sprawdzam…' : 'Sprawdź rozprawkę';
  if (on) { $('#result').innerHTML = ''; $('#loading').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

/** Kryteria oceniane przez AI (pozostałe uzupełnia nauczyciel). */
const aiCriteria = (preset) => preset.criteria.filter((c) => c.ai !== false);
const teacherCriteria = (preset) => preset.criteria.filter((c) => c.ai === false);

/** Schemat JSON odpowiedzi – wymusza uporządkowany wynik (structured outputs). */
function buildSchema(preset) {
  const str = { type: 'string' };
  const funcField = { type: 'string', enum: FUNC_VALUES };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['transcription', 'word_count', 'thesis', 'summary', 'reading_check', 'arguments', 'contexts', 'criteria', 'strengths', 'improvements', 'feedback_for_student', 'teacher_notes'],
    properties: {
      transcription: { type: 'string', description: 'Dokładna transkrypcja pracy ze zdjęć/PDF, znak w znak, z zachowaniem pisowni ucznia i podziału na akapity (pusta linia między akapitami). Pusty string, jeśli praca została wklejona jako tekst.' },
      word_count: { type: 'integer', description: 'Liczba słów w pracy.' },
      thesis: { type: 'string', description: 'Teza/stanowisko ucznia; "brak tezy", jeśli jej nie ma.' },
      summary: { type: 'string', description: 'Ogólna ocena merytoryczna pracy w 2–4 zdaniach dla nauczyciela.' },
      reading_check: { type: 'string', description: 'Czy uczeń odwołał się do wymaganej lektury/tekstów, czy poprawnie rzeczowo i czy funkcjonalnie (1–3 zdania).' },
      arguments: {
        type: 'array',
        description: 'Każdy argument z pracy po kolei, z przykładem, który go ilustruje.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['argument', 'example', 'source', 'source_type', 'functionality', 'factual_errors', 'comment'],
          properties: {
            argument: { type: 'string', description: 'Argument własnymi słowami, krótko.' },
            example: { type: 'string', description: 'Przykład użyty przez ucznia (np. postać, sytuacja z lektury).' },
            source: { type: 'string', description: 'Tytuł i autor tekstu/źródła przykładu; pusty, jeśli brak.' },
            source_type: { type: 'string', enum: SOURCE_TYPES },
            functionality: funcField,
            factual_errors: { type: 'string', description: 'Błędy rzeczowe w przykładzie (np. pomylone postacie, wydarzenia). Pusty string, jeśli brak.' },
            comment: { type: 'string', description: 'Dlaczego przykład jest/nie jest funkcjonalny: czy uczeń go zinterpretował i powiązał z tezą, czy tylko streścił.' },
          },
        },
      },
      contexts: {
        type: 'array',
        description: 'Konteksty wykorzystane przez ucznia. Pusta tablica, jeśli brak.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'content', 'functionality', 'comment'],
          properties: {
            type: { type: 'string', enum: CONTEXT_TYPES },
            content: { type: 'string', description: 'Na czym polega kontekst w pracy.' },
            functionality: funcField,
            comment: str,
          },
        },
      },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'points', 'justification'],
          properties: {
            id: aiCriteria(preset).length ? { type: 'string', enum: aiCriteria(preset).map((c) => c.id) } : str,
            points: { type: 'integer' },
            justification: str,
          },
        },
      },
      strengths: { type: 'array', items: str },
      improvements: { type: 'array', items: str },
      feedback_for_student: { type: 'string', description: 'Komentarz do ucznia: życzliwy, konkretny, 4–8 zdań, w 2. osobie. Dotyczy treści: tezy, argumentów, przykładów, kontekstów i kompozycji.' },
      teacher_notes: { type: 'string', description: 'Uwagi dla nauczyciela: nieczytelne fragmenty, niepewny odczyt, sporne punkty. Pusty string, jeśli brak.' },
    },
  };
}

function buildSystemPrompt() {
  return [
    'Jesteś doświadczonym egzaminatorem i nauczycielem języka polskiego. Pomagasz nauczycielce sprawdzać rozprawki uczniów polskiej szkoły. Ona sama sprawdza poprawność językową, ortografię, interpunkcję i styl – Ty zajmujesz się treścią.',
    'Twoje zadania:',
    '1. Odczytanie pracy. Prace są pisane ODRĘCZNIE przez uczniów (różne charaktery pisma, czasem niewyraźne). Jeśli praca jest na zdjęciach lub w PDF, przepisz ją dokładnie, strona po stronie, w podanej kolejności:',
    '   - zachowaj oryginalną pisownię i interpunkcję ucznia – nie poprawiaj błędów, nie dopisuj brakujących słów, nie wygładzaj stylu;',
    '   - przy niewyraźnych słowach korzystaj z kontekstu zdania, ale jeśli nie masz pewności, zapisz najbardziej prawdopodobną wersję ze znakiem zapytania w nawiasie kwadratowym, np. [poświęcenie?]; fragmenty zupełnie nieczytelne zapisz jako [nieczytelne];',
    '   - pomiń wyrazy skreślone przez ucznia; wstawki dopisane nad linią lub na marginesie ze strzałką wstaw w odpowiednie miejsce;',
    '   - zachowaj podział na akapity (nowy akapit = wcięcie lub nowa linia po krótszej linii); oddziel akapity pustą linią;',
    '   - pomiń nagłówki kartki, numery stron, uwagi nauczyciela pisane innym kolorem;',
    '   - w "teacher_notes" podaj, które fragmenty były niepewne lub nieczytelne i czy strony wyglądają na kompletne (np. urwane zdanie na końcu strony).',
    '   Niepewny odczyt nie może obniżać oceny merytorycznej – oceniaj to, co uczeń najprawdopodobniej napisał.',
    '2. Analiza argumentów i przykładów. Dla każdego argumentu oceń przykład: "funkcjonalny" – uczeń przywołuje konkretną sytuację/postać, interpretuje ją i jasno wiąże z tezą; "częściowo funkcjonalny" – przykład trafny, ale głównie streszczony albo słabo powiązany z tezą; "niefunkcjonalny" – przykład niezwiązany z tezą, ogólnikowy, błędny rzeczowo lub sama wzmianka. Sprawdź poprawność rzeczową odwołań do lektur (postacie, wydarzenia, autorzy).',
    '3. Konteksty. Wskaż konteksty (np. historyczny, biograficzny, filozoficzny, kulturowy) i oceń, czy są funkcjonalne, czyli czy pogłębiają argumentację, a nie są tylko ozdobnikiem.',
    '4. Punktacja wyłącznie podanych kryteriów merytorycznych – liczba całkowita od 0 do maksimum, z uzasadnieniem odwołującym się do treści pracy.',
    '5. Komentarz dla ucznia: życzliwy i konkretny – co wyszło dobrze, które przykłady/konteksty warto pogłębić i jak.',
    'Nie oceniaj i nie wypisuj błędów językowych, ortograficznych, interpunkcyjnych ani stylistycznych – nie wspominaj o nich również w komentarzu dla ucznia, bo zrobi to nauczycielka.',
    'Wszystkie odpowiedzi pisz po polsku.',
  ].join('\n');
}

function buildUserText(input, preset) {
  const criteriaText = aiCriteria(preset)
    .map((c) => `- [${c.id}] ${c.name} (0–${c.max} pkt): ${c.desc}`)
    .join('\n');
  return [
    `TEMAT ROZPRAWKI:\n${input.topic}`,
    input.readings ? `WYMAGANE LEKTURY / TEKSTY:\n${input.readings}` : '',
    input.className ? `KLASA: ${input.className}` : '',
    `ZESTAW KRYTERIÓW: ${preset.name}\nZasady ogólne: ${preset.rules || 'brak'}\nKryteria do oceny przez Ciebie:\n${criteriaText}`,
    input.extra ? `DODATKOWE WSKAZÓWKI NAUCZYCIELKI:\n${input.extra}` : '',
    input.text
      ? `PRACA UCZNIA${input.fromHandwriting ? ' (transkrypcja pracy odręcznej, sprawdzona i poprawiona przez nauczycielkę – zwróć pusty "transcription")' : ''} (liczba słów policzona automatycznie: ${countWords(input.text)}):\n"""\n${input.text}\n"""`
      : `PRACA UCZNIA znajduje się w załączonych plikach (${input.files.length} – kolejne strony w podanej kolejności). Najpierw ją dokładnie przepisz, potem oceń.`,
    'Zwróć wynik w wymaganym formacie JSON. Uwzględnij każde z podanych kryteriów dokładnie raz.',
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

/** Porządkuje wynik: wszystkie kryteria w kolejności zestawu; kryteria nauczyciela puste (null). */
function normalizeAssessment(data, preset) {
  const byId = new Map((data.criteria || []).map((c) => [c.id, c]));
  data.criteria = preset.criteria.map((def) => {
    if (def.ai === false) return { id: def.id, points: null, justification: '', byTeacher: true };
    const got = byId.get(def.id) || { points: 0, justification: 'Model nie ocenił tego kryterium – uzupełnij ręcznie.' };
    const points = Math.max(0, Math.min(def.max, Math.round(Number(got.points) || 0)));
    return { id: def.id, points, justification: got.justification || '' };
  });
  for (const key of ['arguments', 'contexts', 'strengths', 'improvements']) {
    data[key] = Array.isArray(data[key]) ? data[key] : [];
  }
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

/** Suma punktów; "pending" = liczba kryteriów, których nauczyciel jeszcze nie uzupełnił. */
function totals(record) {
  const max = record.criteriaDef.reduce((s, c) => s + Number(c.max), 0);
  const scored = record.assessment.criteria.filter((c) => c.points !== null && c.points !== undefined);
  const got = scored.reduce((s, c) => s + Number(c.points), 0);
  const pending = record.assessment.criteria.length - scored.length;
  const percent = max ? Math.round((got / max) * 100) : 0;
  return { got, max, percent, pending, grade: pending ? null : gradeFor(percent) };
}

function gradeLabel(t) {
  if (t.pending) return `Uzupełnij ${t.pending} ${t.pending === 1 ? 'kryterium' : 'kryteria'}, aby zobaczyć ocenę`;
  return `${t.percent}% · ${t.grade} (${GRADE_NAMES[t.grade]})`;
}

const funcPill = (value) => `<span class="pill pill--${FUNC_CLASS[value] || 'mid'}">${escapeHTML(value)}</span>`;

/** Wyróżnia niepewne fragmenty odczytu: [nieczytelne], [słowo?]. Działa na już zabezpieczonym HTML. */
const markUncertain = (html) => html.replace(/\[[^\]\n]{1,60}\]/g, (m) => `<mark class="uncertain">${m}</mark>`);

/** Tekst z akapitami (pusta linia = nowy akapit). */
const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => `<p>${escapeHTML(p.trim())}</p>`).join('');

function renderResult(record) {
  currentResult = record;
  const a = record.assessment;
  const t = totals(record);
  const defs = new Map(record.criteriaDef.map((c) => [c.id, c]));
  const args = a.arguments || [];
  const contexts = a.contexts || [];
  const funcCount = (list) => FUNC_VALUES.map((v) => [v, list.filter((x) => x.functionality === v).length])
    .filter(([, n]) => n).map(([v, n]) => `${funcPill(v)} × ${n}`).join(' ');

  $('#result').innerHTML = `
    <div class="card">
      <div class="row-between">
        <div class="score">
          <div class="score__big"><span id="total-got">${t.got}</span> / ${t.max} pkt</div>
          <div class="score__grade" id="total-grade">${gradeLabel(t)}</div>
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
      ${a.reading_check ? `<p><strong>Lektura:</strong> ${escapeHTML(a.reading_check)}</p>` : ''}
      ${a.teacher_notes ? `<div class="notes"><strong>Uwagi dla nauczyciela:</strong> ${escapeHTML(a.teacher_notes)}</div>` : ''}
    </div>

    <div class="card">
      <h2>Argumenty i przykłady (${args.length})</h2>
      <p>${funcCount(args) || 'Nie znaleziono argumentów.'}</p>
      <ol class="analysis-list">
        ${args.map((x) => `<li>
          <div class="row-between"><strong>${escapeHTML(x.argument)}</strong>${funcPill(x.functionality)}</div>
          <p><span class="label">Przykład:</span> ${escapeHTML(x.example || '–')}
            ${x.source ? `<span class="hint">(${escapeHTML(x.source)} · ${escapeHTML(x.source_type)})</span>` : `<span class="hint">(${escapeHTML(x.source_type || '')})</span>`}</p>
          ${x.factual_errors ? `<p class="factual"><span class="label">Błąd rzeczowy:</span> ${escapeHTML(x.factual_errors)}</p>` : ''}
          <p class="hint">${escapeHTML(x.comment)}</p>
        </li>`).join('')}
      </ol>
    </div>

    <div class="card">
      <h2>Konteksty (${contexts.length})</h2>
      ${contexts.length ? `<p>${funcCount(contexts)}</p>
      <ul class="analysis-list">
        ${contexts.map((c) => `<li>
          <div class="row-between"><strong>Kontekst ${escapeHTML(c.type)}</strong>${funcPill(c.functionality)}</div>
          <p>${escapeHTML(c.content)}</p>
          <p class="hint">${escapeHTML(c.comment)}</p>
        </li>`).join('')}
      </ul>` : '<p>Uczeń nie wykorzystał kontekstów.</p>'}
    </div>

    <div class="card">
      <h2>Komentarz dla ucznia</h2>
      <div class="feedback" id="feedback-text" contenteditable="true" spellcheck="true" aria-label="Komentarz dla ucznia – możesz go edytować">${escapeHTML(a.feedback_for_student)}</div>
      <p class="hint no-print">Komentarz możesz edytować – kliknij w tekst i dopisz np. uwagi o języku.</p>
      <div class="cols">
        <div><h3>Mocne strony</h3><ul>${a.strengths.map((s) => `<li>${escapeHTML(s)}</li>`).join('') || '<li>–</li>'}</ul></div>
        <div><h3>Do poprawy</h3><ul>${a.improvements.map((s) => `<li>${escapeHTML(s)}</li>`).join('') || '<li>–</li>'}</ul></div>
      </div>
    </div>

    <div class="card">
      <h2>Punktacja</h2>
      <p class="hint no-print">Kryteria oznaczone „nauczyciel” uzupełniasz sama. Każdy wynik AI też możesz zmienić – suma i ocena przeliczą się automatycznie.</p>
      <div class="table-scroll">
      <table class="criteria-table">
        <thead><tr><th>Kryterium</th><th>Punkty</th><th>Uzasadnienie</th></tr></thead>
        <tbody>
          ${a.criteria.map((c) => {
            const def = defs.get(c.id) || { name: c.id, max: 0 };
            const pts = c.points ?? '';
            return `<tr class="${c.byTeacher ? 'is-teacher' : ''}">
              <td><strong>${escapeHTML(def.name)}</strong>
                <div class="bar"><i style="width:${def.max && pts !== '' ? (pts / def.max) * 100 : 0}%"></i></div></td>
              <td class="pts"><input type="number" min="0" max="${def.max}" step="1" value="${pts}" placeholder="?" data-crit="${escapeHTML(c.id)}" aria-label="Punkty: ${escapeHTML(def.name)}"> / ${def.max}</td>
              <td>${c.byTeacher ? '<span class="pill pill--teacher">nauczyciel</span>' : escapeHTML(c.justification)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>

    ${record.essayText && (record.handwritten || a.transcription) ? `
    <div class="card" id="transcription-card">
      <h2>Odczytana praca ucznia</h2>
      <p class="hint">Porównaj z kartką. <mark class="uncertain">[słowo?]</mark> – odczyt niepewny, <mark class="uncertain">[nieczytelne]</mark> – nie udało się odczytać.
        Jeśli AI źle odczytało ważny fragment, popraw tekst poniżej i oceń pracę ponownie (punkty, które wpisałaś, zostaną).</p>
      <div class="essay no-print-edit" id="essay-view">${markUncertain(paragraphs(record.essayText))}</div>
      <div class="no-print">
        <textarea id="essay-edit" rows="16" hidden aria-label="Poprawiona transkrypcja">${escapeHTML(record.essayText)}</textarea>
        <div class="actions">
          <button type="button" class="btn btn--ghost" id="edit-transcription">Popraw odczyt</button>
          <button type="button" class="btn btn--primary" id="reassess" hidden>Oceń ponownie na podstawie poprawionego tekstu</button>
        </div>
        <p class="error" id="reassess-error" role="alert" hidden></p>
      </div>
    </div>` : record.essayText ? `
    <div class="card">
      <h2>Praca ucznia</h2>
      <div class="essay">${paragraphs(record.essayText)}</div>
    </div>` : ''}
  `;

  // Ręczna korekta / uzupełnianie punktów przez nauczyciela.
  $('#result').querySelectorAll('input[data-crit]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const def = defs.get(inp.dataset.crit);
      const value = inp.value === '' ? null : Math.max(0, Math.min(def.max, Math.round(Number(inp.value) || 0)));
      inp.value = value ?? '';
      currentResult.assessment.criteria.find((c) => c.id === inp.dataset.crit).points = value;
      inp.closest('tr').querySelector('.bar > i').style.width = `${def.max && value !== null ? (value / def.max) * 100 : 0}%`;
      const nt = totals(currentResult);
      $('#total-got').textContent = nt.got;
      $('#total-grade').textContent = gradeLabel(nt);
      saveJSON(STORAGE_HISTORY, history);
    }));

  // Poprawianie transkrypcji i ponowna ocena.
  if ($('#edit-transcription')) {
    $('#edit-transcription').addEventListener('click', (e) => {
      const editing = $('#essay-edit').hidden;
      $('#essay-edit').hidden = !editing;
      $('#essay-view').hidden = editing;
      $('#reassess').hidden = !editing;
      e.target.textContent = editing ? 'Anuluj poprawki' : 'Popraw odczyt';
      if (editing) $('#essay-edit').focus();
    });
    $('#reassess').addEventListener('click', (e) => {
      const text = $('#essay-edit').value.trim();
      if (countWords(text) < 20) { $('#reassess-error').textContent = 'Tekst jest za krótki.'; $('#reassess-error').hidden = false; return; }
      if (!settings.apiKey) { $('#reassess-error').textContent = 'Brak klucza API – uzupełnij go w Ustawieniach.'; $('#reassess-error').hidden = false; return; }
      reassessFromText(record, text, e.target, $('#reassess-error'));
    });
  }

  // Zapis edytowanego komentarza.
  $('#feedback-text').addEventListener('input', (e) => {
    currentResult.assessment.feedback_for_student = e.target.innerText;
    saveJSON(STORAGE_HISTORY, history);
  });

  $('#copy-feedback').addEventListener('click', async (e) => {
    const nt = totals(currentResult);
    const head = nt.pending ? '' : `Wynik: ${nt.got}/${nt.max} pkt (${nt.percent}%), ocena: ${nt.grade}\n\n`;
    try { await navigator.clipboard.writeText(head + currentResult.assessment.feedback_for_student); e.target.textContent = 'Skopiowano ✓'; }
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
          <td>${t.grade ?? '–'}</td>
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
  const rows = [['Data', 'Uczeń', 'Klasa', 'Temat', 'Kryteria', 'Punkty', 'Maks.', 'Procent', 'Ocena', 'Przykłady funkcjonalne', 'Konteksty', 'Komentarz']];
  for (const r of history) {
    const t = totals(r);
    rows.push([new Date(r.date).toLocaleString('pl-PL'), r.student, r.className, r.topic, r.presetName,
      t.got, t.max, t.percent, t.grade ?? 'do uzupełnienia',
      `${(r.assessment.arguments || []).filter((x) => x.functionality === 'funkcjonalny').length}/${(r.assessment.arguments || []).length}`,
      (r.assessment.contexts || []).length, r.assessment.feedback_for_student]);
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
      <label class="check"><input type="checkbox" data-i="${i}" data-k="ai" ${c.ai !== false ? 'checked' : ''}> ocenia AI (odznacz, jeśli to kryterium sprawdzasz sama)</label>
      <textarea rows="2" data-i="${i}" data-k="desc" aria-label="Opis kryterium">${escapeHTML(c.desc)}</textarea>
    </div>`).join('');
  $('#criteria-total').textContent = editingPreset.criteria.reduce((s, c) => s + Number(c.max), 0);

  $('#criteria-editor').querySelectorAll('[data-k]').forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
    const c = editingPreset.criteria[Number(el.dataset.i)];
    const k = el.dataset.k;
    c[k] = k === 'ai' ? el.checked : k === 'max' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value;
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
  editingPreset.criteria.push({ id: `k${Date.now().toString(36)}`, name: 'Nowe kryterium', max: 2, desc: '', ai: true });
  renderCriteriaEditor();
});

$('#add-preset').addEventListener('click', () => {
  const id = `own_${Date.now().toString(36)}`;
  settings.presets[id] = {
    name: 'Mój zestaw',
    rules: '',
    criteria: [{ id: 'k1', name: 'Nowe kryterium', max: 5, desc: '', ai: true }],
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
