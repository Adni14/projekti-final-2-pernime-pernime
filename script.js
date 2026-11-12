const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
const PARENT_ACCESS_ENDPOINT = '/functions/v1/parent-access';

const lookupForm = document.getElementById('lookupForm');
const codeInput = document.getElementById('parentCode');
const lookupButton = document.getElementById('lookupButton');
const lookupMessage = document.getElementById('lookupMessage');
const studentRecord = document.getElementById('studentRecord');
const changeCodeButton = document.getElementById('changeCodeButton');
const remarkLabels = {
  Excellent: 'Shkëlqyeshëm',
  Good: 'Mirë',
  Satisfactory: 'Kënaqshëm',
  'Needs improvement': 'Nevojitet përmirësim',
  'Late submissions': 'Dorëzime me vonesë',
  'Excellent participation': 'Pjesëmarrje e shkëlqyeshme'
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setMessage(message, type) {
  lookupMessage.textContent = message;
  lookupMessage.dataset.type = type || '';
}

function getStudentFromResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Përgjigjja nga shërbimi nuk është e vlefshme.');
  }

  const candidate = payload.student && typeof payload.student === 'object'
    ? payload.student
    : payload;
  const record = candidate.record && typeof candidate.record === 'object'
    ? { ...candidate.record, className: candidate.class_name || candidate.record.className }
    : candidate;

  if (typeof record.name !== 'string' || !record.name.trim()) {
    throw new Error('Në përgjigje mungon emri i nxënësit.');
  }
  if (typeof record.className !== 'string' || !record.className.trim()) {
    throw new Error('Në përgjigje mungon klasa e nxënësit.');
  }
  if (!Array.isArray(record.subjects)) {
    throw new Error('Në përgjigje mungojnë notat sipas lëndëve.');
  }
  if (!Number.isFinite(Number(record.absenceCount)) || Number(record.absenceCount) < 0) {
    throw new Error('Numri i mungesave në përgjigje nuk është i vlefshëm.');
  }
  if (record.remark !== undefined && typeof record.remark !== 'string') {
    throw new Error('Vlerësimi i mësuesit në përgjigje nuk është i vlefshëm.');
  }
  if (record.teacherNote !== undefined && typeof record.teacherNote !== 'string') {
    throw new Error('Shënimi i mësuesit në përgjigje nuk është i vlefshëm.');
  }

  const subjects = record.subjects.map((subject) => {
    if (!subject || typeof subject.name !== 'string' || !subject.name.trim()) {
      throw new Error('Një lëndë në përgjigje nuk është e vlefshme.');
    }
    const grade = subject.grade === null || subject.grade === '' ? null : Number(subject.grade);
    if (grade !== null && (!Number.isFinite(grade) || grade < 1 || grade > 5)) {
      throw new Error('Një notë në përgjigje nuk është e vlefshme.');
    }
    return { name: subject.name, grade };
  });

  return {
    name: record.name.trim(),
    className: record.className.trim(),
    absenceCount: Number(record.absenceCount),
    remark: record.remark || '',
    teacherNote: record.teacherNote || '',
    subjects
  };
}

function renderStudent(student) {
  document.getElementById('studentName').textContent = student.name;
  document.getElementById('studentClass').textContent = `Klasa ${student.className}`;
  document.getElementById('absenceCount').textContent = String(student.absenceCount);
  document.getElementById('teacherRemark').textContent =
    remarkLabels[student.remark] || student.remark || 'Pa vlerësim';

  const gradesBody = document.getElementById('gradesBody');
  if (student.subjects.length === 0) {
    gradesBody.innerHTML = '<tr><td colspan="2">Nuk ka ende nota të regjistruara.</td></tr>';
  } else {
    gradesBody.innerHTML = student.subjects.map((subject) => `
      <tr>
        <th scope="row">${escapeHtml(subject.name)}</th>
        <td>${subject.grade === null ? '—' : escapeHtml(subject.grade)}</td>
      </tr>
    `).join('');
  }

  const noteSection = document.getElementById('teacherNoteSection');
  const note = document.getElementById('teacherNote');
  note.textContent = student.teacherNote;
  noteSection.hidden = !student.teacherNote.trim();
  studentRecord.hidden = false;
}

function getEndpoint() {
  if (!SUPABASE_URL.trim() || !SUPABASE_ANON_KEY.trim()) {
    throw new Error('Lidhja me databazën nuk është konfiguruar ende.');
  }
  let projectUrl;
  try {
    projectUrl = new URL(SUPABASE_URL);
  } catch {
    throw new Error('URL-ja e projektit Supabase nuk është e vlefshme.');
  }
  if (projectUrl.protocol !== 'https:') {
    throw new Error('URL-ja e projektit Supabase duhet të përdorë HTTPS.');
  }
  return `${projectUrl.origin}${PARENT_ACCESS_ENDPOINT}`;
}

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  studentRecord.hidden = true;

  const parentCode = codeInput.value.trim().toUpperCase();
  if (!parentCode) {
    setMessage('Shkruani kodin e hyrjes që ju dha mësuesi.', 'error');
    codeInput.focus();
    return;
  }

  let endpoint;
  try {
    endpoint = getEndpoint();
  } catch (error) {
    setMessage(error.message, 'error');
    return;
  }

  lookupButton.disabled = true;
  lookupButton.textContent = 'Duke kërkuar…';
  setMessage('Po kërkohen të dhënat e nxënësit…', 'loading');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ parentCode })
    });

    if (response.status === 404 || response.status === 400) {
      setMessage('Kodi nuk u gjet. Kontrolloni kodin dhe provoni përsëri.', 'error');
      return;
    }
    if (response.status === 429) {
      setMessage('U bënë shumë prova. Prisni pak dhe provoni përsëri.', 'error');
      return;
    }
    if (!response.ok) {
      throw new Error(`Shërbimi nuk mundi t’i kërkojë të dhënat (gabimi ${response.status}).`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Shërbimi ktheu një përgjigje të pavlefshme.');
    }

    renderStudent(getStudentFromResponse(payload));
    setMessage('Të dhënat u gjetën.', 'success');
  } catch (error) {
    console.error('Kërkimi i të dhënave të nxënësit dështoi:', error);
    setMessage(error instanceof TypeError
      ? 'Nuk u lidhëm me shërbimin. Kontrolloni internetin dhe konfigurimin.'
      : error.message, 'error');
  } finally {
    lookupButton.disabled = false;
    lookupButton.textContent = 'Shiko të dhënat';
  }
});

codeInput.addEventListener('input', () => {
  const start = codeInput.selectionStart;
  const end = codeInput.selectionEnd;
  codeInput.value = codeInput.value.toUpperCase();
  codeInput.setSelectionRange(start, end);
});

changeCodeButton.addEventListener('click', () => {
  studentRecord.hidden = true;
  codeInput.value = '';
  setMessage('Shkruani kodin e hyrjes që ju dha mësuesi.');
  codeInput.focus();
});
