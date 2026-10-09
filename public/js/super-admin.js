// Helper to get auth token
function getAuthToken() {
    return sessionStorage.getItem('coc_token') || '';
}

function authFetch(url, options = {}) {
    const token = getAuthToken();
    const headers = { ...(options.headers || {}) };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { ...options, headers });
}

// Check super admin authentication
const userStr = sessionStorage.getItem('coc_user');
let currentUser = null;

if (userStr) {
    try {
        currentUser = JSON.parse(userStr);
    } catch(e) {}
}

if (!currentUser || currentUser.role !== 'admin') {
    alert('Akses ditolak: Anda harus login sebagai Super Administrator!');
    window.location.href = 'login.html';
} else {
    document.getElementById('admin-user-info').innerText = `${currentUser.name} (${currentUser.username})`;
}

let allStudents = [];

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-tab-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.getElementById('section-teachers').classList.toggle('hidden', tab !== 'teachers');
    document.getElementById('section-students').classList.toggle('hidden', tab !== 'students');
    const banksSec = document.getElementById('section-banks');
    if (banksSec) banksSec.classList.toggle('hidden', tab !== 'banks');
    document.getElementById('section-reports').classList.toggle('hidden', tab !== 'reports');

    if (tab === 'teachers') loadTeachers();
    if (tab === 'students') loadStudents();
    if (tab === 'banks') { loadAdminBanks(); populateTeacherDropdown(); }
    if (tab === 'reports') loadReports();
}

function handleLogout() {
    sessionStorage.removeItem('coc_user');
    window.location.href = 'login.html';
}

// ================= GURU MANAGEMENT =================
async function loadTeachers() {
    const tbody = document.getElementById('teacher-table-body');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Memuat data guru...</td></tr>';

    try {
        const resp = await authFetch('/api/admin/teachers');
        const res = await resp.json();

        if (res.success && res.teachers) {
            document.getElementById('teacher-count').innerText = res.teachers.length;
            if (res.teachers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">Belum ada akun guru.</td></tr>';
                return;
            }

            tbody.innerHTML = res.teachers.map(t => `
                <tr>
                    <td>#${t.id}</td>
                    <td><strong>${t.name}</strong></td>
                    <td><code>${t.username}</code></td>
                    <td>${t.extra?.nip || '-'}</td>
                    <td><span class="badge" style="background:var(--blue-primary); padding:2px 8px; border-radius:6px; font-size:0.8rem;">${t.extra?.subject || 'Umum'}</span></td>
                    <td>
                        <button onclick="deleteTeacher(${t.id}, '${t.name}')" class="btn btn-small" style="background:#e53935; color:white; border:none; padding:3px 8px; font-size:0.8rem; border-radius:4px; cursor:pointer;">Hapus</button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center error-text">Gagal memuat: ${err.message}</td></tr>`;
    }
}

async function handleAddTeacher(e) {
    e.preventDefault();
    const name = document.getElementById('t-name').value.trim();
    const username = document.getElementById('t-user').value.trim();
    const password = document.getElementById('t-pass').value;
    const nip = document.getElementById('t-nip').value.trim();
    const subject = document.getElementById('t-subject').value.trim();

    try {
        const resp = await authFetch('/api/admin/teachers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, password, nip, subject })
        });
        const res = await resp.json();

        if (res.success) {
            alert(`Akun Guru ${name} berhasil dibuat!`);
            document.getElementById('form-add-teacher').reset();
            document.getElementById('t-pass').value = 'guru123';
            loadTeachers();
        } else {
            alert('Gagal: ' + (res.message || 'Error'));
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
}

async function deleteTeacher(id, name) {
    if (!confirm(`Yakin ingin menghapus akun guru ${name}?`)) return;

    try {
        const resp = await authFetch(`/api/admin/teachers/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (res.success) {
            loadTeachers();
        } else {
            alert('Gagal menghapus: ' + res.message);
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
}

// ================= SISWA MANAGEMENT =================
async function loadStudents() {
    const tbody = document.getElementById('student-table-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Memuat data siswa...</td></tr>';

    try {
        const resp = await authFetch('/api/admin/students');
        const res = await resp.json();

        if (res.success && res.students) {
            allStudents = res.students;
            document.getElementById('student-count').innerText = allStudents.length;
            renderStudentsTable(allStudents);
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center error-text">Gagal memuat: ${err.message}</td></tr>`;
    }
}

function renderStudentsTable(list) {
    const tbody = document.getElementById('student-table-body');
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Belum ada data siswa.</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(s => `
        <tr>
            <td><strong>${escapeHTML(s.username)}</strong></td>
            <td>${escapeHTML(s.name)}</td>
            <td><span class="badge" style="background:#4caf50; padding:2px 8px; border-radius:6px; font-size:0.8rem; color:white;">${escapeHTML(s.extra?.class || 'Umum')}</span></td>
            <td>
                <button onclick="deleteStudent(${s.id}, '${escapeHTML(s.name)}')" class="btn btn-small" style="background:#e53935; color:white; border:none; padding:3px 8px; font-size:0.8rem; border-radius:4px; cursor:pointer;">Hapus</button>
            </td>
        </tr>
    `).join('');
}

function filterStudents() {
    const q = document.getElementById('search-student').value.toLowerCase().trim();
    if (!q) {
        renderStudentsTable(allStudents);
        return;
    }
    const filtered = allStudents.filter(s => 
        (s.name && s.name.toLowerCase().includes(q)) || 
        (s.username && s.username.toLowerCase().includes(q)) ||
        (s.extra?.class && s.extra.class.toLowerCase().includes(q))
    );
    renderStudentsTable(filtered);
}

async function handleAddStudent(e) {
    e.preventDefault();
    const username = document.getElementById('s-nis').value.trim();
    const name = document.getElementById('s-name').value.trim();
    const className = document.getElementById('s-class').value.trim();
    const password = document.getElementById('s-pass').value;

    try {
        const resp = await authFetch('/api/admin/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, name, className, password })
        });
        const res = await resp.json();

        if (res.success) {
            alert(`Siswa ${name} (${username}) berhasil didaftarkan!`);
            document.getElementById('form-add-student').reset();
            document.getElementById('s-pass').value = '123';
            loadStudents();
        } else {
            alert('Gagal: ' + (res.message || 'Error'));
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
}

async function handleBulkImport() {
    const jsonStr = document.getElementById('bulk-student-json').value.trim();
    if (!jsonStr) {
        alert('Harap masukkan data JSON array siswa.');
        return;
    }

    try {
        const students = JSON.parse(jsonStr);
        if (!Array.isArray(students)) throw new Error('Data harus berupa array objek JSON.');

        const resp = await authFetch('/api/admin/students/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ students })
        });
        const res = await resp.json();

        if (res.success) {
            alert(res.message);
            document.getElementById('bulk-student-json').value = '';
            loadStudents();
        } else {
            alert('Gagal bulk import: ' + res.message);
        }
    } catch (err) {
        alert('Format JSON tidak valid atau gagal: ' + err.message);
    }
}

async function deleteStudent(id, name) {
    if (!confirm(`Hapus akun siswa ${name}?`)) return;

    try {
        const resp = await authFetch(`/api/admin/students/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (res.success) {
            loadStudents();
        } else {
            alert('Gagal menghapus: ' + res.message);
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
}

// ================= REPORTS & SESSIONS =================
async function loadReports() {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Memuat riwayat kuis...</td></tr>';

    try {
        const resp = await authFetch('/api/admin/reports');
        const res = await resp.json();

        if (res.success && res.sessions) {
            document.getElementById('session-count').innerText = res.sessions.length;
            if (res.sessions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">Belum ada sesi kuis yang tersimpan.</td></tr>';
                return;
            }

            tbody.innerHTML = res.sessions.map(s => {
                const date = new Date(s.created_at).toLocaleString('id-ID');
                return `
                    <tr>
                        <td>${date}</td>
                        <td><strong style="color:var(--gold); font-size:1.1rem; letter-spacing:1px;">${escapeHTML(s.pin)}</strong></td>
                        <td>${escapeHTML(s.guru_name || 'Guru')}</td>
                        <td>${escapeHTML(s.title)}</td>
                        <td>👥 ${s.total_players} Siswa</td>
                        <td>📦 ${s.total_questions} Soal</td>
                        <td>
                            <button onclick="viewReportDetail('${s.id}')" class="btn btn-secondary btn-small" style="padding:2px 8px; font-size:0.8rem;">Detail</button>
                            <a href="/api/guru/reports/${s.id}/export-excel?token=${encodeURIComponent(getAuthToken())}" class="btn btn-primary btn-small" style="padding:2px 8px; font-size:0.8rem; text-decoration:none;">Excel</a>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center error-text">Gagal memuat: ${err.message}</td></tr>`;
    }
}

async function viewReportDetail(sessionId) {
    try {
        const resp = await authFetch(`/api/guru/reports/${sessionId}`);
        const res = await resp.json();

        if (!res.success || !res.session) {
            alert('Gagal mengambil detail sesi: ' + (res.message || 'Error'));
            return;
        }

        const s = res.session;
        document.getElementById('modal-report-title').innerText = s.title || 'Laporan Kuis';
        document.getElementById('modal-report-meta').innerHTML = `
            <strong>PIN:</strong> ${escapeHTML(s.pin)} | 
            <strong>Guru:</strong> ${escapeHTML(s.guru_name || 'Guru')} | 
            <strong>Waktu:</strong> ${new Date(s.created_at).toLocaleString('id-ID')} | 
            <strong>Total Peserta:</strong> ${s.total_players} Siswa
        `;

        document.getElementById('btn-download-excel').href = `/api/guru/reports/${s.id}/export-excel?token=${encodeURIComponent(getAuthToken())}`;

        const tbody = document.getElementById('modal-report-table-body');
        const records = s.studentRecords || [];

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Tidak ada rekap siswa.</td></tr>';
        } else {
            tbody.innerHTML = records.map(r => `
                <tr>
                    <td><strong>#${r.rank}</strong></td>
                    <td><code>${r.student_identifier || '-'}</code></td>
                    <td>${r.student_name}</td>
                    <td style="color:var(--gold); font-weight:bold;">${r.score}</td>
                    <td>${r.accuracy}%</td>
                    <td>🔥 x${r.max_streak}</td>
                    <td>${r.boxes_taken}</td>
                </tr>
            `).join('');
        }

        document.getElementById('modal-report-detail').classList.remove('hidden');
    } catch (err) {
        alert('Gagal memuat detail: ' + err.message);
    }
}

function closeReportModal() {
    document.getElementById('modal-report-detail').classList.add('hidden');
}

// ================= QUESTION BANK MANAGEMENT =================
let allBanks = [];

async function loadAdminBanks() {
    const tbody = document.getElementById('bank-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Memuat data bank soal...</td></tr>';

    try {
        const resp = await authFetch('/api/admin/question-banks');
        const res = await resp.json();

        if (res.success && res.banks) {
            allBanks = res.banks;
            const countEl = document.getElementById('bank-count');
            if (countEl) countEl.innerText = allBanks.length;
            renderBanksTable(allBanks);
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center error-text">Gagal memuat bank soal: ${err.message}</td></tr>`;
    }
}

function renderBanksTable(list) {
    const tbody = document.getElementById('bank-table-body');
    if (!tbody) return;
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Belum ada paket bank soal yang tersimpan.</td></tr>';
        return;
    }

    tbody.innerHTML = list.map((b, i) => {
        const creatorRole = b.creator_role === 'admin' ? '🛡️ Admin' : '👨‍🏫 Guru';
        const creatorSubject = b.creator_extra?.subject ? ` (${escapeHTML(b.creator_extra.subject)})` : '';
        const creatorName = b.creator_name || b.creator_username || 'Guru';
        const dateStr = b.created_at ? new Date(b.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        return `
            <tr>
                <td>#${i + 1}</td>
                <td><strong style="color:var(--gold); font-size:1.02rem;">${escapeHTML(b.title)}</strong></td>
                <td>
                    <span class="badge" style="background:${b.creator_role === 'admin' ? 'rgba(255,190,11,0.2)' : 'rgba(56,189,248,0.2)'}; color:${b.creator_role === 'admin' ? '#ffbe0b' : '#38bdf8'}; font-size:0.75rem; padding:2px 8px; border-radius:10px; margin-right:6px;">
                        ${creatorRole}
                    </span>
                    <strong>${escapeHTML(creatorName)}</strong>
                    <span style="color:var(--text-muted); font-size:0.8rem;">${creatorSubject}</span>
                </td>
                <td><span class="badge" style="background:rgba(16,185,129,0.2); color:#a7f3d0; padding:2px 10px; border-radius:12px; font-weight:bold;">${b.questionCount || 0} Soal</span></td>
                <td style="font-size:0.85rem; color:var(--text-muted);">${dateStr}</td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button onclick="previewBankDetails(${b.id})" class="btn btn-small" style="background:#0284c7; color:white; border:none; padding:4px 10px; font-size:0.8rem; border-radius:6px; cursor:pointer;" title="Lihat Soal">👁️ Detail</button>
                        <button onclick="deleteAdminBank(${b.id}, '${escapeHTML(b.title)}')" class="btn btn-small" style="background:#e53935; color:white; border:none; padding:4px 8px; font-size:0.8rem; border-radius:6px; cursor:pointer;" title="Hapus Bank Soal">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterBanks() {
    const q = (document.getElementById('search-bank')?.value || '').toLowerCase().trim();
    if (!q) {
        renderBanksTable(allBanks);
        return;
    }
    const filtered = allBanks.filter(b => 
        (b.title && b.title.toLowerCase().includes(q)) || 
        (b.creator_name && b.creator_name.toLowerCase().includes(q)) ||
        (b.creator_username && b.creator_username.toLowerCase().includes(q)) ||
        (b.creator_extra?.subject && b.creator_extra.subject.toLowerCase().includes(q))
    );
    renderBanksTable(filtered);
}

async function populateTeacherDropdown() {
    const select = document.getElementById('bank-new-guru');
    if (!select) return;
    try {
        const resp = await authFetch('/api/admin/teachers');
        const res = await resp.json();
        if (res.success && res.teachers) {
            select.innerHTML = '<option value="">🛡️ Admin (Super Administrator)</option>' +
                res.teachers.map(t => `<option value="${t.id}">👨‍🏫 ${escapeHTML(t.name)} (${escapeHTML(t.extra?.subject || 'Guru')})</option>`).join('');
        }
    } catch(e) {}
}

async function handleAdminCreateBank(e) {
    e.preventDefault();
    const title = document.getElementById('bank-new-title').value.trim();
    const guruId = document.getElementById('bank-new-guru').value || null;
    const fileInput = document.getElementById('bank-file-input');
    const jsonStr = document.getElementById('bank-new-json').value.trim();

    let questions = [];

    // Check if file is uploaded
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        try {
            const uploadResp = await authFetch('/api/upload-questions', {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadResp.json();
            if (uploadData.success && uploadData.questions) {
                questions = uploadData.questions;
            } else {
                alert('Gagal membaca file: ' + (uploadData.message || 'Error'));
                return;
            }
        } catch(err) {
            alert('Gagal membaca file: ' + err.message);
            return;
        }
    } else if (jsonStr) {
        try {
            questions = JSON.parse(jsonStr);
            if (!Array.isArray(questions) || questions.length === 0) {
                alert('JSON harus berupa array yang berisi minimal 1 soal.');
                return;
            }
        } catch(err) {
            alert('Format JSON tidak valid: ' + err.message);
            return;
        }
    } else {
        alert('Harap unggah file template soal (.xlsx / .docx) ATAU masukkan format JSON soal.');
        return;
    }

    try {
        const resp = await authFetch('/api/admin/question-banks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, questions, guruId })
        });
        const res = await resp.json();
        if (res.success) {
            alert(`Bank Soal "${title}" berisi ${questions.length} soal berhasil disimpan!`);
            document.getElementById('form-create-bank').reset();
            loadAdminBanks();
        } else {
            alert('Gagal menyimpan bank soal: ' + (res.message || 'Error'));
        }
    } catch(err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
}

async function previewBankDetails(id) {
    const modal = document.getElementById('modal-bank-preview');
    const listEl = document.getElementById('modal-bank-questions-list');
    listEl.innerHTML = '<p class="text-center">Memuat detail soal...</p>';
    modal.classList.remove('hidden');

    try {
        const resp = await authFetch(`/api/admin/question-banks/${id}`);
        const res = await resp.json();
        if (res.success && res.bank) {
            const b = res.bank;
            document.getElementById('modal-bank-title').innerText = b.title;
            const creatorRole = b.creator_role === 'admin' ? 'Super Admin' : 'Guru';
            const creatorName = b.creator_name || b.creator_username || 'Guru';
            const dateStr = b.created_at ? new Date(b.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
            
            document.getElementById('modal-bank-meta').innerHTML = `
                Dibuat oleh: <strong style="color:var(--gold);">${escapeHTML(creatorName)}</strong> (${creatorRole}) | 
                Tanggal: <strong>${dateStr}</strong> | Total: <strong>${(b.questions || []).length} Soal</strong>
            `;

            const qs = b.questions || [];
            if (qs.length === 0) {
                listEl.innerHTML = '<p class="text-center">Tidak ada soal dalam paket ini.</p>';
                return;
            }

            listEl.innerHTML = qs.map((q, idx) => {
                const type = (q.type || 'MC').toUpperCase();
                let ans = '-';
                if (q.correctAnswer !== undefined) ans = q.correctAnswer;
                else if (q.correctText !== undefined) ans = q.correctText;
                else if (q.correct !== undefined) ans = q.correct ? 'BENAR' : 'SALAH';
                else if (q.correctIndex !== undefined && q.options) ans = q.options[q.correctIndex];

                let optsHtml = '';
                if (Array.isArray(q.options) && q.options.length > 0) {
                    optsHtml = `<div style="margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                        ${q.options.map((opt, oi) => `<div style="background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:6px; font-size:0.85rem;">
                            <strong>${['A','B','C','D'][oi] || oi+1}.</strong> ${escapeHTML(opt)}
                        </div>`).join('')}
                    </div>`;
                } else if (Array.isArray(q.pairs) || Array.isArray(q.matchingPairs)) {
                    const pairs = q.pairs || q.matchingPairs || [];
                    optsHtml = `<div style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);">
                        ${pairs.map(p => `<div>• ${escapeHTML(p.left || p.kiri || p[0])} = ${escapeHTML(p.right || p.kanan || p[1])}</div>`).join('')}
                    </div>`;
                }

                return `
                    <div class="card mb-3" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:14px;">
                        <div class="flex-between">
                            <span class="badge" style="background:var(--gold); color:#111; font-weight:bold; font-size:0.75rem; padding:2px 8px; border-radius:4px;">#${idx + 1} ${type}</span>
                            <span style="color:#38bdf8; font-weight:bold; font-size:0.85rem;">⭐ ${q.points || 100} Poin</span>
                        </div>
                        <p style="margin:8px 0; font-size:1rem; font-weight:600; color:#fff;">${escapeHTML(q.text || q.question || '')}</p>
                        ${optsHtml}
                        <div style="margin-top:8px; background:rgba(16,185,129,0.15); border:1px solid #10b981; border-radius:6px; padding:6px 12px; font-size:0.88rem; color:#a7f3d0;">
                            🔑 Kunci: <strong>${escapeHTML(String(ans))}</strong>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        listEl.innerHTML = `<p class="text-center error-text">Gagal memuat detail: ${err.message}</p>`;
    }
}

function closeBankPreviewModal() {
    const modal = document.getElementById('modal-bank-preview');
    if (modal) modal.classList.add('hidden');
}

async function deleteAdminBank(id, title) {
    if (!confirm(`Apakah Anda yakin ingin menghapus bank soal "${title}"?`)) return;

    try {
        const resp = await authFetch(`/api/admin/question-banks/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (res.success) {
            alert('Bank soal berhasil dihapus.');
            loadAdminBanks();
        } else {
            alert('Gagal: ' + (res.message || 'Error'));
        }
    } catch(err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
}

// Explicit window exports for inline HTML handlers
window.switchAdminTab = switchAdminTab;
window.handleLogout = handleLogout;
window.loadTeachers = loadTeachers;
window.handleAddTeacher = handleAddTeacher;
window.deleteTeacher = deleteTeacher;
window.loadStudents = loadStudents;
window.handleAddStudent = handleAddStudent;
window.deleteStudent = deleteStudent;
window.handleBulkImport = handleBulkImport;
window.loadReports = loadReports;
window.viewReportDetail = viewReportDetail;
window.closeReportModal = closeReportModal;
window.loadAdminBanks = loadAdminBanks;
window.filterBanks = filterBanks;
window.populateTeacherDropdown = populateTeacherDropdown;
window.handleAdminCreateBank = handleAdminCreateBank;
window.previewBankDetails = previewBankDetails;
window.closeBankPreviewModal = closeBankPreviewModal;
window.deleteAdminBank = deleteAdminBank;

// Initial load
window.addEventListener('DOMContentLoaded', () => {
    loadTeachers();
});
