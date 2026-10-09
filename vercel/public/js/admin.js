function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

const socket = io({ transports: ['polling', 'websocket'], reconnection: true });
let roomPin = '';
let players = [];
let questions = [];

const userStr = sessionStorage.getItem('coc_user');
let currentUser = null;
if (userStr) {
    try { currentUser = JSON.parse(userStr); } catch (e) {}
}

function initRoleUI() {
    const statusText = document.getElementById('guru-status-text');
    const authBtn = document.getElementById('btn-auth-action');
    if (!statusText || !authBtn) return;

    if (currentUser && currentUser.role === 'guru') {
        statusText.innerHTML = `<span style="font-size:1.2rem;">👨‍🏫</span> <span><strong>Guru:</strong> ${currentUser.name} (${currentUser.extra?.subject || 'Umum'}) — <span style="color:#4caf50; font-weight:bold;">Progres & nilai siswa tersimpan</span></span>`;
        authBtn.innerText = '🚪 Keluar (Logout)';
        authBtn.classList.remove('btn-primary');
        authBtn.classList.add('btn-secondary');
    } else if (currentUser && currentUser.role === 'admin') {
        statusText.innerHTML = `<span style="font-size:1.2rem;">🛡️</span> <span><strong>Super Administrator:</strong> ${currentUser.name} — <a href="super-admin.html" style="color:var(--gold);text-decoration:underline;">Buka Panel Admin</a></span>`;
        authBtn.innerText = '🚪 Keluar (Logout)';
        authBtn.classList.remove('btn-primary');
        authBtn.classList.add('btn-secondary');
    } else {
        statusText.innerHTML = `<span style="font-size:1.2rem;">⚡</span> <span><strong>Mode Guru Cepat (Anonim):</strong> Nilai tidak disimpan permanen ke database.</span>`;
        authBtn.innerText = '🔑 Login Akun Guru';
        authBtn.classList.add('btn-primary');
        authBtn.classList.remove('btn-secondary');
    }
}

window.handleAuthAction = () => {
    if (currentUser) {
        if (confirm('Yakin ingin keluar dari akun?')) {
            sessionStorage.removeItem('coc_user');
            window.location.reload();
        }
    } else {
        window.location.href = 'login.html';
    }
};

const phaseSetup = document.getElementById('phase-setup');
const phaseMonitor = document.getElementById('phase-monitor');

window.currentWizardStep = 1;
window.setWizardStep = (step) => {
    if (step > 1 && questions.length === 0) {
        alert('ℹ️ Silakan siapkan atau upload minimal 1 soal terlebih dahulu di Langkah 1!');
        step = 1;
    }
    window.currentWizardStep = step;
    for (let i = 1; i <= 3; i++) {
        const tab = document.getElementById(`wizard-tab-${i}`);
        const panel = document.getElementById(`step-panel-${i}`);
        if (tab) {
            tab.classList.toggle('active', i === step);
            if (i < step) tab.classList.add('done');
            else tab.classList.remove('done');
        }
        if (panel) {
            panel.classList.toggle('hidden', i !== step);
        }
    }
    if (step === 2 && typeof updateRulesSummaryBadges === 'function') {
        updateRulesSummaryBadges();
    }
};

let currentGlobalTimerLimit = 60;

window.openGameRulesModal = () => {
    const m = document.getElementById('modal-game-rules');
    if (m) m.classList.remove('hidden');
};

window.closeGameRulesModal = () => {
    const m = document.getElementById('modal-game-rules');
    if (m) m.classList.add('hidden');
};

window.setPenaltyPoints = (pts) => {
    const input = document.getElementById('penalty-points');
    if (input) input.value = pts;
    updateRulesSummaryBadges();
    if (roomPin) {
        socket.emit('update-config', { pin: roomPin, config: { penaltyPoints: pts } });
    }
};

window.togglePenaltyOptions = (cb) => {
    const grp = document.getElementById('penalty-group');
    if (grp) grp.style.display = cb.checked ? 'block' : 'none';
    updateRulesSummaryBadges();
    if (roomPin) {
        socket.emit('update-config', { pin: roomPin, config: { enablePenalty: cb.checked } });
    }
};

window.updateRulesSummaryBadges = () => {
    const gVal = currentGlobalTimerLimit;
    const qVal = parseInt(document.getElementById('time-limit')?.value) || 30;
    const penChecked = document.getElementById('enable-penalty')?.checked || false;
    const penPts = parseInt(document.getElementById('penalty-points')?.value) || 50;
    const mysChecked = document.getElementById('enable-mystery-points')?.checked || false;
    const showPts = document.getElementById('show-points-initially')?.checked || false;

    const bGlobal = document.getElementById('summary-badge-global');
    if (bGlobal) bGlobal.innerHTML = `⌛ Total: ${gVal === 0 ? '∞ Bebas' : gVal + 's'}`;

    const bQ = document.getElementById('summary-badge-qtime');
    if (bQ) bQ.innerHTML = `⏱️ Per Soal: ${qVal}s`;

    const bPen = document.getElementById('summary-badge-penalty');
    if (bPen) {
        bPen.innerHTML = penChecked ? `⚠️ Penalti: -${penPts} Poin` : `⚠️ Penalti: Nonaktif`;
        bPen.style.borderColor = penChecked ? '#ef4444' : 'rgba(255,255,255,0.2)';
        bPen.style.color = penChecked ? '#fca5a5' : 'white';
    }

    const bMys = document.getElementById('summary-badge-mystery');
    if (bMys) {
        bMys.innerHTML = mysChecked ? `🎁 Mystery: Aktif (50-300 Poin)` : `🎁 Mystery: Nonaktif`;
        bMys.style.borderColor = mysChecked ? '#a855f7' : 'rgba(255,255,255,0.2)';
        bMys.style.color = mysChecked ? '#d8b4fe' : 'white';
    }

    const bDisp = document.getElementById('summary-badge-display');
    if (bDisp) {
        bDisp.innerHTML = showPts ? `🔢 Kotak: Tampil Poin Awal` : `🔢 Kotak: Nomor Urut (Default)`;
        bDisp.style.borderColor = showPts ? '#10b981' : 'rgba(255,255,255,0.2)';
        bDisp.style.color = showPts ? '#86efac' : 'white';
    }

    // Update pill buttons active state
    document.querySelectorAll('.global-pill-btn').forEach(btn => {
        const val = parseInt(btn.dataset.val);
        btn.classList.toggle('active', val === gVal);
    });
    document.querySelectorAll('.qtime-pill-btn').forEach(btn => {
        const val = parseInt(btn.dataset.val);
        btn.classList.toggle('active', val === qVal);
    });
};

window.applyRulePreset = (presetName) => {
    document.querySelectorAll('.rules-preset-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`preset-btn-${presetName}`);
    if (activeBtn) activeBtn.classList.add('active');

    const penToggle = document.getElementById('enable-penalty');
    const penGroup = document.getElementById('penalty-group');
    const penInput = document.getElementById('penalty-points');
    const mysToggle = document.getElementById('enable-mystery-points');
    const mysGroup = document.getElementById('mystery-group');
    const showPtsToggle = document.getElementById('show-points-initially');

    if (presetName === 'kilat') {
        setGlobalTimer(30);
        setTimeLimit(15);
        if (penToggle) penToggle.checked = false;
        if (penGroup) penGroup.style.display = 'none';
        if (mysToggle) mysToggle.checked = false;
        if (mysGroup) mysGroup.style.display = 'none';
        if (showPtsToggle) showPtsToggle.checked = false;
    } else if (presetName === 'turnamen') {
        setGlobalTimer(120);
        setTimeLimit(45);
        if (penToggle) penToggle.checked = true;
        if (penGroup) penGroup.style.display = 'block';
        if (penInput) penInput.value = 50;
        if (mysToggle) mysToggle.checked = false;
        if (mysGroup) mysGroup.style.display = 'none';
        if (showPtsToggle) showPtsToggle.checked = false;
    } else if (presetName === 'santai') {
        setGlobalTimer(0);
        setTimeLimit(60);
        if (penToggle) penToggle.checked = false;
        if (penGroup) penGroup.style.display = 'none';
        if (mysToggle) mysToggle.checked = false;
        if (mysGroup) mysGroup.style.display = 'none';
        if (showPtsToggle) showPtsToggle.checked = true;
    } else if (presetName === 'misteri') {
        setGlobalTimer(60);
        setTimeLimit(30);
        if (penToggle) penToggle.checked = false;
        if (penGroup) penGroup.style.display = 'none';
        if (mysToggle) mysToggle.checked = true;
        if (mysGroup) mysGroup.style.display = 'block';
        if (showPtsToggle) showPtsToggle.checked = false;
    } else {
        // standar
        setGlobalTimer(60);
        setTimeLimit(30);
        if (penToggle) penToggle.checked = false;
        if (penGroup) penGroup.style.display = 'none';
        if (mysToggle) mysToggle.checked = false;
        if (mysGroup) mysGroup.style.display = 'none';
        if (showPtsToggle) showPtsToggle.checked = false;
    }

    updateRulesSummaryBadges();
};

window.setGlobalTimer = (sec) => {
    currentGlobalTimerLimit = sec;
    const slider = document.getElementById('global-time-limit');
    if (slider) slider.value = sec;
    const valEl = document.getElementById('global-time-val');
    const unitEl = document.getElementById('global-time-unit');
    if (valEl) valEl.innerText = sec === 0 ? '∞ Bebas' : sec;
    if (unitEl) unitEl.style.display = sec === 0 ? 'none' : 'inline';
    updateRulesSummaryBadges();
    if (roomPin) socket.emit('update-config', { pin: roomPin, config: { globalTimeLimit: sec } });
};

window.setTimeLimit = (sec) => {
    const slider = document.getElementById('time-limit');
    if (slider) slider.value = sec;
    const valEl = document.getElementById('time-val');
    if (valEl) valEl.innerText = sec;
    updateRulesSummaryBadges();
    if (roomPin) socket.emit('update-config', { pin: roomPin, config: { timePerQuestion: sec } });
};

const globalSlider = document.getElementById('global-time-limit');
if (globalSlider) {
    globalSlider.addEventListener('input', (e) => {
        const sec = parseInt(e.target.value);
        currentGlobalTimerLimit = sec;
        const valEl = document.getElementById('global-time-val');
        const unitEl = document.getElementById('global-time-unit');
        if (valEl) valEl.innerText = sec === 0 ? '∞ Bebas' : sec;
        if (unitEl) unitEl.style.display = sec === 0 ? 'none' : 'inline';
        updateRulesSummaryBadges();
    });
    globalSlider.addEventListener('change', (e) => {
        const sec = parseInt(e.target.value);
        if (roomPin) socket.emit('update-config', { pin: roomPin, config: { globalTimeLimit: sec } });
    });
}

const timeLimitSlider = document.getElementById('time-limit');
if (timeLimitSlider) {
    timeLimitSlider.addEventListener('input', (e) => {
        const sec = parseInt(e.target.value);
        const valEl = document.getElementById('time-val');
        if (valEl) valEl.innerText = sec;
        updateRulesSummaryBadges();
    });
    timeLimitSlider.addEventListener('change', (e) => {
        const sec = parseInt(e.target.value);
        if (roomPin) socket.emit('update-config', { pin: roomPin, config: { timePerQuestion: sec } });
    });
}

function updateAdminPinUI(pin) {
    if (!pin) return;
    roomPin = pin;
    sessionStorage.setItem('coc_admin_pin', pin);
    
    // Update all elements with class .display-room-pin
    document.querySelectorAll('.display-room-pin').forEach(el => {
        el.innerText = pin;
    });
    
    // Explicit ID updates for safety
    const mainPin = document.getElementById('room-pin');
    if (mainPin) mainPin.innerText = pin;
    const headerPin = document.getElementById('header-room-pin');
    if (headerPin) headerPin.innerText = pin;
    const navPin = document.getElementById('nav-room-pin');
    if (navPin) navPin.innerText = pin;
}

function createFreshAdminRoom() {
    sessionStorage.removeItem('coc_admin_pin');
    sessionStorage.removeItem('coc_admin_token');
    roomPin = '';
    
    document.querySelectorAll('.display-room-pin').forEach(el => {
        el.innerText = '...';
    });
    const mainPin = document.getElementById('room-pin');
    if (mainPin) mainPin.innerText = '...';

    if (currentUser && (currentUser.role === 'guru' || currentUser.role === 'admin')) {
        socket.emit('create-room', {
            guruId: currentUser.id,
            guruName: currentUser.name,
            isAnonymous: false,
            title: `Kuis ${currentUser.extra?.subject || 'Clash of Champion'}`
        });
    } else {
        socket.emit('create-room', { isAnonymous: true });
    }
}

window.createNewRoom = () => {
    if (roomPin && !confirm('Apakah Anda yakin ingin membuat Room dan PIN baru? Siswa yang ada di room lama tidak akan otomatis berpindah.')) {
        return;
    }
    createFreshAdminRoom();
};

window.copyJoinLink = () => {
    if (!roomPin || roomPin === '...' || roomPin === '------') {
        alert('⚠️ PIN room sedang disiapkan, tunggu sebentar...');
        return;
    }
    const url = window.location.origin + '/?pin=' + roomPin;
    navigator.clipboard.writeText(url).then(() => {
        alert('🔗 Tautan kuis berhasil disalin:\n' + url);
    }).catch(() => {
        prompt('Salin tautan ini:', url);
    });
};

window.copyPin = () => {
    if (!roomPin || roomPin === '...' || roomPin === '------') {
        alert('⚠️ PIN room sedang disiapkan, tunggu sebentar...');
        return;
    }
    navigator.clipboard.writeText(roomPin).then(() => {
        alert('📋 PIN berhasil disalin: ' + roomPin);
    }).catch(() => {
        prompt('Salin PIN ini:', roomPin);
    });
};

window.togglePauseGame = () => {
    isPaused = !isPaused;
    const btn = document.getElementById('btn-pause');
    if (btn) btn.innerText = isPaused ? '▶️ Lanjut' : '⏸️ Pause';
    socket.emit(isPaused ? 'pause-game' : 'resume-game', { pin: roomPin });
};

window.extendGameTime = () => {
    socket.emit('extend-time', { pin: roomPin, extraSeconds: 30 });
    alert('⏱️ +30 Detik waktu pengerjaan berhasil ditambahkan ke soal aktif!');
};

window.promptVoidBox = () => {
    const boxStr = prompt('Masukkan nomor kotak yang ingin dibatalkan (1 s/d ' + questions.length + '):');
    if (boxStr) {
        const idx = parseInt(boxStr.trim()) - 1;
        if (idx >= 0 && idx < questions.length) {
            socket.emit('void-box', { pin: roomPin, boxIndex: idx });
            alert('Soal #' + (idx + 1) + ' berhasil dibatalkan dan diselesaikan untuk siswa!');
        } else {
            alert('Nomor kotak tidak valid!');
        }
    }
};

window.confirmEndGame = () => {
    if (confirm('Apakah Anda yakin ingin mengakhiri kuis sekarang dan menampilkan podium juara?')) {
        socket.emit('end-game', { pin: roomPin });
    }
};

socket.on('connect', () => {
    initRoleUI();
    const savedPin = sessionStorage.getItem('coc_admin_pin');
    const savedToken = sessionStorage.getItem('coc_admin_token');

    if (savedPin && savedToken) {
        socket.emit('reconnect-attempt', {
            pin: savedPin,
            playerId: 'admin',
            adminToken: savedToken
        });
        return;
    }

    createFreshAdminRoom();
});

socket.on('reconnect-success', (data) => {
    const activePin = data.pin || sessionStorage.getItem('coc_admin_pin');
    updateAdminPinUI(activePin);
    if (data.adminToken) {
        sessionStorage.setItem('coc_admin_token', data.adminToken);
    }
    initRoleUI();
    if (data.roomState) {
        if (data.roomState.config && data.roomState.config.showPointsInitially !== undefined) {
            adminShowBoxPoints = Boolean(data.roomState.config.showPointsInitially);
            const toggleEl = document.getElementById('admin-toggle-points');
            if (toggleEl) toggleEl.checked = adminShowBoxPoints;
        }
        if (data.roomState.status === 'playing' || data.roomState.status === 'paused') {
            phaseSetup.classList.add('hidden');
            phaseMonitor.classList.remove('hidden');
            syncAdminTimer(data.roomState.globalEndTime, data.roomState.globalTimeLimit || (data.roomState.config && data.roomState.config.globalTimeLimit));
            if (data.roomState.boxes) {
                if (!adminInspectionBoxes || adminInspectionBoxes.length === 0) {
                    adminInspectionBoxes = data.roomState.boxes.map((b, i) => {
                        const q = questions[i] || {};
                        return {
                            index: b.index !== undefined ? b.index : i,
                            points: b.points,
                            isMystery: Boolean(b.isMystery || b.mystery),
                            status: b.status || 'available',
                            lockedByName: b.lockedByName || null,
                            answeredCorrectly: b.answeredCorrectly,
                            questionText: q.text || q.question || '',
                            questionSnippet: (q.text || q.question || '').substring(0, 50),
                            questionType: q.type || 'mc',
                            correctAnswer: q.correctAnswer ?? q.answer ?? ''
                        };
                    });
                }
                renderAdminBoxesView();
                if (data.roomState.soloScore !== undefined || players.length === 0) {
                    const badge = document.getElementById('solo-score-badge');
                    const ind = document.getElementById('solo-mode-indicator');
                    if (badge) badge.classList.remove('hidden');
                    if (ind) ind.classList.remove('hidden');
                    const scoreEl = document.getElementById('admin-solo-score');
                    if (scoreEl && data.roomState.soloScore !== undefined) scoreEl.innerText = data.roomState.soloScore;
                }
            }
        }
        if (data.roomState.players && Array.isArray(data.roomState.players)) {
            players = data.roomState.players;
            updatePlayersList();
            checkStartBtn();
        }
    }
});

socket.on('room-created', (data) => {
    updateAdminPinUI(data.pin);
    if (data.adminToken) {
        sessionStorage.setItem('coc_admin_token', data.adminToken);
    }
    initRoleUI();
    if (questions && questions.length > 0) {
        socket.emit('update-questions', { pin: data.pin, questions });
    }
});

socket.on('error', (err) => {
    console.error('Socket error received:', err);
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.includes('tidak ditemukan') || msg.includes('telah berakhir') || msg.includes('Token otorisasi')) {
        console.warn('Stale room or token detected, creating fresh room automatically...');
        createFreshAdminRoom();
    } else {
        alert('⚠️ ' + msg);
    }
});

function syncPlayerIntoList(p) {
    if (!p || !p.id) return;
    const idx = players.findIndex(x => x.id === p.id);
    if (idx >= 0) {
        players[idx] = Object.assign({}, players[idx], p);
    } else {
        players.push(p);
    }
}

socket.on('player-joined', (data) => {
    if (data.players && Array.isArray(data.players)) {
        players = data.players;
    } else if (data.player) {
        syncPlayerIntoList(data.player);
    }
    updatePlayersList();
    checkStartBtn();
});

socket.on('player-reconnected', (data) => {
    if (data.players && Array.isArray(data.players)) {
        players = data.players;
    } else if (data.player) {
        syncPlayerIntoList(data.player);
    } else if (data.playerId && data.nickname) {
        syncPlayerIntoList({
            id: data.playerId,
            nickname: data.nickname,
            avatar: data.avatar,
            studentIdentifier: data.studentIdentifier
        });
    }
    updatePlayersList();
    checkStartBtn();
});

socket.on('player-left', (data) => {
    players = players.filter(p => p.id !== data.playerId);
    updatePlayersList();
    checkStartBtn();
});

socket.on('player-kicked', (data) => {
    players = players.filter(p => p.id !== data.playerId);
    updatePlayersList();
    checkStartBtn();
    if (typeof logActivity === 'function') {
        logActivity(`🚫 Siswa ${data.nickname} dikeluarkan oleh Guru.`);
    }
});

window.kickPlayer = (playerId) => {
    const p = players.find(x => x.id === playerId);
    const pName = p ? p.nickname : 'pemain ini';
    if (confirm(`Apakah Anda yakin ingin mengeluarkan ${pName} dari kuis?`)) {
        socket.emit('kick-player', { pin: roomPin, playerId });
    }
};

function updatePlayersList() {
    document.getElementById('player-count').innerText = players.length;
    const list = document.getElementById('player-list');
    list.innerHTML = players.map(p => {
        const avatarHtml = (typeof SpriteGen !== 'undefined')
            ? SpriteGen.renderAvatarHtml(p.avatar, { size: 32, animation: 'idle' })
            : `<span class="avatar-small">${p.avatar}</span>`;
        return `
        <div class="player-badge bounce" style="position:relative; padding-right:24px;">
            ${avatarHtml}
            <span style="margin-left:4px; font-weight:bold;">${escapeHTML(p.nickname)}</span>
            <button onclick="kickPlayer('${p.id}')" style="position:absolute;top:2px;right:2px;background:#e53935;color:white;border:none;border-radius:3px;cursor:pointer;padding:1px 5px;font-size:0.75rem;" title="Keluarkan">✕</button>
        </div>
    `}).join('');
    if (typeof SpriteGen !== 'undefined') SpriteGen.hydrate(list);
}

const btnAddQ = document.getElementById('btn-add-question');
const modalQ = document.getElementById('modal-question');
const qType = document.getElementById('q-type');

btnAddQ.onclick = () => {
    modalQ.classList.remove('hidden');
    qType.value = 'mc';
    qType.dispatchEvent(new Event('change'));
};

document.getElementById('btn-cancel-q').onclick = () => modalQ.classList.add('hidden');

qType.addEventListener('change', () => {
    document.querySelectorAll('.q-fields').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${qType.value}-fields`).classList.remove('hidden');
});

document.getElementById('btn-add-pair').onclick = () => {
    const container = document.getElementById('match-pairs-container');
    const div = document.createElement('div');
    div.className = 'match-pair';
    div.innerHTML = `
        <input type="text" class="input-text m-left" placeholder="Kiri">
        <input type="text" class="input-text m-right" placeholder="Kanan">
    `;
    container.appendChild(div);
};

document.getElementById('btn-save-q').onclick = () => {
    const type = qType.value;
    const text = document.getElementById('q-text').value;
    const points = parseInt(document.getElementById('q-points').value) || 100;
    
    let qData = { type, text, points };
    
    if (type === 'mc') {
        qData.options = [
            document.getElementById('mc-opt-0').value,
            document.getElementById('mc-opt-1').value,
            document.getElementById('mc-opt-2').value,
            document.getElementById('mc-opt-3').value
        ];
        qData.correctIndex = parseInt(document.querySelector('input[name="mc-correct"]:checked').value);
    } else if (type === 'tf') {
        qData.correct = document.getElementById('tf-correct').value === 'true';
    } else if (type === 'match') {
        const pairs = [];
        document.querySelectorAll('.match-pair').forEach(el => {
            const l = el.querySelector('.m-left').value;
            const r = el.querySelector('.m-right').value;
            if(l && r) pairs.push({left: l, right: r});
        });
        qData.pairs = pairs;
    } else if (type === 'short') {
        qData.correctText = document.getElementById('short-correct').value;
    }

    questions.push(qData);
    socket.emit('add-question', { pin: roomPin, question: qData });
    
    modalQ.classList.add('hidden');
    document.getElementById('q-text').value = '';
    updateQuestionsList();
    checkStartBtn();
};

document.getElementById('btn-randomize-points').onclick = () => {
    questions.forEach(q => {
        q.points = Math.floor(Math.random() * 46 + 5) * 10;
    });
    socket.emit('update-questions', { pin: roomPin, questions });
    updateQuestionsList();
};

function updateQuestionsList() {
    const countEl = document.getElementById('question-count');
    if (countEl) countEl.innerText = questions.length;
    const list = document.getElementById('question-list');
    list.innerHTML = questions.map((q, i) => `
        <div class="q-card">
            <div class="q-card-info">
                <span class="q-type-badge">${(q.type || 'MC').toUpperCase()}</span>
                <strong>⭐ ${q.points || 100}</strong>
                <p style="font-size:0.9rem; margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${q.question || q.text || ''}</p>
            </div>
            <button class="btn btn-danger btn-small" onclick="deleteQ(${i})">X</button>
        </div>
    `).join('');
}

window.deleteQ = (i) => {
    questions.splice(i, 1);
    socket.emit('update-questions', { pin: roomPin, questions });
    updateQuestionsList();
    checkStartBtn();
};

let isSoloMode = false;
let currentTeacherBox = null;
let currentTeacherQData = null;
let currentTeacherBoxPoints = 100;
let isTeacherAnswerRevealed = false;
let adminSoloScore = 0;

window.handleSoloModeToggle = (el) => {
    isSoloMode = el ? Boolean(el.checked) : false;
    checkStartBtn();
};

window.startSoloModeDirectly = () => {
    if (questions.length === 0) {
        alert('⚠️ Belum ada soal yang dimasukkan! Silakan siapkan soal di Langkah 1 terlebih dahulu.');
        if (typeof setWizardStep === 'function') setWizardStep(1);
        return;
    }
    isSoloMode = true;
    const toggle = document.getElementById('toggle-solo-mode');
    if (toggle) toggle.checked = true;
    checkStartBtn();
    btnStart.click();
};

const btnStart = document.getElementById('btn-start-game');
function checkStartBtn() {
    const hasQuestions = questions && questions.length >= 1;
    const hasPlayers = players && players.length >= 1;

    const btnSolo = document.getElementById('btn-start-solo');
    if (btnSolo) {
        btnSolo.disabled = !hasQuestions;
    }

    if (isSoloMode) {
        btnStart.disabled = !hasQuestions;
        btnStart.innerText = 'MULAI MODE MANDIRI! 🎯';
        btnStart.classList.add('pulse');
    } else {
        btnStart.disabled = !hasPlayers || !hasQuestions;
        btnStart.innerText = 'MULAI GAME SEKARANG! 🚀';
    }
}

btnStart.onclick = () => {
    if (questions.length === 0) {
        alert('⚠️ Belum ada soal yang dimasukkan! Silakan siapkan soal di Langkah 1 terlebih dahulu.');
        if (typeof setWizardStep === 'function') setWizardStep(1);
        return;
    }

    const timeLimit = parseInt(document.getElementById('time-limit')?.value) || 30;
    const globalLimit = currentGlobalTimerLimit !== undefined ? currentGlobalTimerLimit : (parseInt(document.getElementById('global-time-limit')?.value) || 0);
    const enablePenalty = document.getElementById('enable-penalty')?.checked || false;
    const penaltyPoints = parseInt(document.getElementById('penalty-points')?.value) || 0;

    const gameConfig = {
        timePerQuestion: timeLimit,
        globalTimeLimit: globalLimit,
        enablePenalty,
        penaltyPoints,
        mysteryPoints: document.getElementById('enable-mystery-points')?.checked || false,
        randomizeMystery: document.getElementById('randomize-mystery-values')?.checked !== false,
        showPointsInitially: document.getElementById('show-points-initially')?.checked || false
    };

    socket.emit('update-config', { pin: roomPin, config: gameConfig });
    socket.emit('update-questions', { pin: roomPin, questions });
    socket.emit('start-game', { pin: roomPin, config: gameConfig, questions });
};

window.toggleMysteryOptions = (cb) => {
    const grp = document.getElementById('mystery-group');
    if (grp) grp.style.display = cb.checked ? 'block' : 'none';
};

document.getElementById('enable-penalty').addEventListener('change', (e) => {
    document.getElementById('penalty-group').style.display = e.target.checked ? 'block' : 'none';
});

let globalTimerInterval = null;
let adminGlobalTargetEndTime = null;
let adminStartTime = null;

function syncAdminTimer(endTime, limitSec) {
    if (globalTimerInterval) clearInterval(globalTimerInterval);
    const timerEl = document.getElementById('global-timer');

    if (endTime && limitSec > 0) {
        adminGlobalTargetEndTime = endTime;
        const tick = () => {
            const remainingMs = Math.max(0, adminGlobalTargetEndTime - Date.now());
            const totalSec = Math.ceil(remainingMs / 1000);
            const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
            const s = (totalSec % 60).toString().padStart(2, '0');

            if (timerEl) {
                timerEl.innerText = `⏳ ${m}:${s}`;
                if (totalSec <= 10) {
                    timerEl.style.color = '#ef4444';
                    timerEl.classList.add('pulse');
                } else {
                    timerEl.style.color = '#ffbe0b';
                    timerEl.classList.remove('pulse');
                }
            }

            if (remainingMs <= 0) {
                clearInterval(globalTimerInterval);
            }
        };

        tick();
        globalTimerInterval = setInterval(tick, 500);
    } else {
        adminStartTime = adminStartTime || Date.now();
        if (timerEl) {
            timerEl.style.color = '#38bdf8';
            timerEl.classList.remove('pulse');
        }

        globalTimerInterval = setInterval(() => {
            const diff = Math.floor((Date.now() - adminStartTime) / 1000);
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            if (timerEl) timerEl.innerText = `⏱️ ${m}:${s}`;
        }, 1000);
    }
}

function startGlobalTimer() {
    syncAdminTimer(adminGlobalTargetEndTime, currentGlobalTimerLimit);
}

let adminInspectionBoxes = [];
let currentAdminFilter = 'all';
let currentAdminSearch = '';
let currentAdminViewMode = 'grid'; // 'grid' | 'list'
let adminShowBoxPoints = false;

window.toggleBoxPointsDisplay = (checked) => {
    adminShowBoxPoints = Boolean(checked);
    if (roomPin) {
        socket.emit('update-config', { pin: roomPin, config: { showPointsInitially: adminShowBoxPoints } });
    }
    renderAdminBoxesView();
};

window.setAdminGridView = (mode) => {
    currentAdminViewMode = mode;
    const gridEl = document.getElementById('admin-box-grid');
    const listEl = document.getElementById('admin-box-list-view');
    const btnGrid = document.getElementById('btn-view-grid');
    const btnList = document.getElementById('btn-view-list');

    if (mode === 'grid') {
        if (gridEl) gridEl.classList.remove('hidden');
        if (listEl) listEl.classList.add('hidden');
        if (btnGrid) { btnGrid.style.background = 'var(--gold)'; btnGrid.style.color = '#111'; btnGrid.style.fontWeight = 'bold'; }
        if (btnList) { btnList.style.background = 'transparent'; btnList.style.color = '#fff'; btnList.style.fontWeight = 'normal'; }
    } else {
        if (gridEl) gridEl.classList.add('hidden');
        if (listEl) listEl.classList.remove('hidden');
        if (btnGrid) { btnGrid.style.background = 'transparent'; btnGrid.style.color = '#fff'; btnGrid.style.fontWeight = 'normal'; }
        if (btnList) { btnList.style.background = 'var(--gold)'; btnList.style.color = '#111'; btnList.style.fontWeight = 'bold'; }
    }
    renderAdminBoxesView();
};

window.filterAdminBoxes = (filterType, btn) => {
    currentAdminFilter = filterType;
    document.querySelectorAll('.grid-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderAdminBoxesView();
};

window.searchAdminBoxes = (val) => {
    currentAdminSearch = (val || '').trim().toLowerCase();
    renderAdminBoxesView();
};

function formatTypeBadge(type) {
    const raw = (type || 'mc').toLowerCase();
    if (raw === 'tf' || raw === 'true_false') return '<span class="box-type-tag" style="background:#0ea5e9;">B/S</span>';
    if (raw === 'match' || raw === 'matching') return '<span class="box-type-tag" style="background:#8b5cf6;">MATCH</span>';
    if (raw === 'short' || raw === 'short_answer') return '<span class="box-type-tag" style="background:#f59e0b;">ISIAN</span>';
    return '<span class="box-type-tag" style="background:#10b981;">PG</span>';
}

function formatTypeName(type) {
    const raw = (type || 'mc').toLowerCase();
    if (raw === 'tf' || raw === 'true_false') return '<span class="badge" style="background:rgba(14,165,233,0.2); color:#38bdf8; border:1px solid #0284c7;">Benar/Salah</span>';
    if (raw === 'match' || raw === 'matching') return '<span class="badge" style="background:rgba(139,92,246,0.2); color:#c4b5fd; border:1px solid #8b5cf6;">Menjodohkan</span>';
    if (raw === 'short' || raw === 'short_answer') return '<span class="badge" style="background:rgba(245,158,11,0.2); color:#fde68a; border:1px solid #d97706;">Isian</span>';
    return '<span class="badge" style="background:rgba(16,185,129,0.2); color:#a7f3d0; border:1px solid #10b981;">Pilihan Ganda</span>';
}

function renderAdminBoxesView() {
    // 1. Update filter counts
    const countAll = adminInspectionBoxes.length;
    const countAvail = adminInspectionBoxes.filter(b => b.status === 'available').length;
    const countLocked = adminInspectionBoxes.filter(b => b.status === 'locked').length;
    const countCorrect = adminInspectionBoxes.filter(b => b.status === 'completed' && b.answeredCorrectly === true).length;
    const countWrong = adminInspectionBoxes.filter(b => b.status === 'completed' && b.answeredCorrectly === false).length;

    const elAll = document.getElementById('filter-count-all'); if (elAll) elAll.innerText = countAll;
    const elAvail = document.getElementById('filter-count-available'); if (elAvail) elAvail.innerText = countAvail;
    const elLocked = document.getElementById('filter-count-locked'); if (elLocked) elLocked.innerText = countLocked;
    const elCorrect = document.getElementById('filter-count-correct'); if (elCorrect) elCorrect.innerText = countCorrect;
    const elWrong = document.getElementById('filter-count-wrong'); if (elWrong) elWrong.innerText = countWrong;

    // 2. Filter & Search
    const filtered = adminInspectionBoxes.filter(b => {
        if (currentAdminFilter === 'available' && b.status !== 'available') return false;
        if (currentAdminFilter === 'locked' && b.status !== 'locked') return false;
        if (currentAdminFilter === 'correct' && (b.status !== 'completed' || b.answeredCorrectly !== true)) return false;
        if (currentAdminFilter === 'wrong' && (b.status !== 'completed' || b.answeredCorrectly !== false)) return false;

        if (currentAdminSearch) {
            const term = currentAdminSearch;
            const matchIndex = (`#${b.index + 1}`.includes(term) || `${b.index + 1}` === term);
            const matchText = (b.questionText || '').toLowerCase().includes(term);
            const matchSnippet = (b.questionSnippet || '').toLowerCase().includes(term);
            const matchAns = String(b.correctAnswer ?? '').toLowerCase().includes(term);
            const matchPlayer = (b.lockedByName || '').toLowerCase().includes(term);
            if (!matchIndex && !matchText && !matchSnippet && !matchAns && !matchPlayer) return false;
        }
        return true;
    });

    // 3. Render Grid View
    const grid = document.getElementById('admin-box-grid');
    if (grid) {
        if (filtered.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; padding: 30px; text-align: center; color: rgba(255,255,255,0.6);">Tidak ada soal yang sesuai dengan filter/pencarian.</div>';
        } else {
            grid.innerHTML = filtered.map(b => {
                const isCompleted = b.status === 'completed';
                const isLocked = b.status === 'locked';

                let statusClass = 'available';
                let statusText = 'Tersedia';
                if (isLocked) {
                    statusClass = 'locked-other';
                    statusText = b.lockedByName || 'Dikerjakan';
                } else if (isCompleted) {
                    statusClass = b.answeredCorrectly ? 'completed-correct' : 'completed-wrong';
                    statusText = b.answeredCorrectly ? '✓ Benar' : '✗ Salah';
                }
                const mysteryClass = b.isMystery ? 'mystery' : '';
                
                let pointsSubHtml = '';
                if (adminShowBoxPoints) {
                    const ptsDisplay = b.isMystery 
                        ? `🎁 ${b.points}` 
                        : `⭐ ${b.points} Poin`;
                    pointsSubHtml = `<div class="box-points-sub">${ptsDisplay}</div>`;
                } else if (isCompleted) {
                    const earned = b.answeredCorrectly ? `+${b.points}` : '0';
                    pointsSubHtml = `<div class="box-points-sub ${b.answeredCorrectly ? 'completed-pts' : 'completed-wrong-pts'}">${earned} Poin</div>`;
                }

                return `
                <div class="game-box ${statusClass} ${mysteryClass}" id="admin-box-${b.index}" onclick="openTeacherBox(${b.index})" style="cursor:pointer;" title="Klik untuk buka & operasikan Kotak #${b.index+1}">
                    ${formatTypeBadge(b.questionType)}
                    <div class="box-main-number">${b.index + 1}</div>
                    ${pointsSubHtml}
                    ${b.questionSnippet ? `<div class="box-snippet" title="${escapeHTML(b.questionText || '')}">${escapeHTML(b.questionSnippet)}</div>` : ''}
                    <div class="box-status">${escapeHTML(statusText)}</div>
                </div>
                `;
            }).join('');
        }
    }

    // 4. Render Table List View
    const tableBody = document.getElementById('admin-box-table-body');
    if (tableBody) {
        if (filtered.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:rgba(255,255,255,0.6);">Tidak ada soal yang cocok dengan filter.</td></tr>';
        } else {
            tableBody.innerHTML = filtered.map(b => {
                let statusBadge = '<span class="badge" style="background:rgba(16,185,129,0.2); color:#a7f3d0;">🟢 Tersedia</span>';
                if (b.status === 'locked') {
                    statusBadge = `<span class="badge" style="background:rgba(234,179,8,0.2); color:#fde047;">🟡 ${escapeHTML(b.lockedByName || 'Dikerjakan')}</span>`;
                } else if (b.status === 'completed') {
                    statusBadge = b.answeredCorrectly 
                        ? '<span class="badge" style="background:rgba(16,185,129,0.3); color:#86efac;">✅ Benar</span>'
                        : '<span class="badge" style="background:rgba(239,68,68,0.3); color:#fca5a5;">❌ Salah</span>';
                }

                const pointsText = b.isMystery ? `🎁 ${b.points}` : `⭐ ${b.points}`;

                return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08); transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                    <td style="padding:10px 8px; text-align:center; font-weight:bold; color:var(--gold);">#${b.index + 1}</td>
                    <td style="padding:10px 8px; text-align:center;">${formatTypeName(b.questionType)}</td>
                    <td style="padding:10px 8px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHTML(b.questionText || '')}">
                        ${escapeHTML(b.questionText || b.questionSnippet || '-')}
                    </td>
                    <td style="padding:10px 8px; color:#a7f3d0; font-family:monospace; font-weight:600;">
                        ${escapeHTML(String(b.correctAnswer ?? '-'))}
                    </td>
                    <td style="padding:10px 8px; text-align:center; font-weight:bold; color:#ffbe0b;">${pointsText}</td>
                    <td style="padding:10px 8px; text-align:center;">${statusBadge}</td>
                    <td style="padding:10px 8px; text-align:center;">
                        <button type="button" class="btn btn-secondary btn-small" style="padding:4px 8px; font-size:0.75rem;" onclick="openTeacherBox(${b.index})">
                            🔍 Buka
                        </button>
                    </td>
                </tr>
                `;
            }).join('');
        }
    }
}

socket.on('admin-inspection-data', (data) => {
    if (data && Array.isArray(data.boxes)) {
        adminInspectionBoxes = data.boxes;
        renderAdminBoxesView();
    }
});

socket.on('config-updated', (data) => {
    if (data && data.config && data.config.showPointsInitially !== undefined) {
        adminShowBoxPoints = Boolean(data.config.showPointsInitially);
        const toggleEl = document.getElementById('admin-toggle-points');
        if (toggleEl) toggleEl.checked = adminShowBoxPoints;
        renderAdminBoxesView();
    }
});

socket.on('game-started', (data) => {
    phaseSetup.classList.add('hidden');
    phaseMonitor.classList.remove('hidden');
    if (data.config && data.config.showPointsInitially !== undefined) {
        adminShowBoxPoints = Boolean(data.config.showPointsInitially);
        const toggleEl = document.getElementById('admin-toggle-points');
        if (toggleEl) toggleEl.checked = adminShowBoxPoints;
    }
    if (data.boxes && (!adminInspectionBoxes || adminInspectionBoxes.length === 0)) {
        adminInspectionBoxes = data.boxes.map((b, i) => {
            const q = questions[i] || {};
            return {
                index: b.index !== undefined ? b.index : i,
                points: b.points,
                isMystery: Boolean(b.isMystery || b.mystery),
                status: b.status || 'available',
                questionText: q.text || q.question || '',
                questionSnippet: (q.text || q.question || '').substring(0, 50),
                questionType: q.type || 'mc',
                correctAnswer: q.correctAnswer ?? q.answer ?? ''
            };
        });
    }
    renderAdminBoxesView();
    syncAdminTimer(data.globalEndTime, data.globalTimeLimit || (data.config && data.config.globalTimeLimit));

    if (isSoloMode || players.length === 0) {
        const ind = document.getElementById('solo-mode-indicator');
        const badge = document.getElementById('solo-score-badge');
        if (ind) ind.classList.remove('hidden');
        if (badge) badge.classList.remove('hidden');
        if (typeof logActivity === 'function') {
            logActivity('🎯 Permainan dimulai dalam Mode Mandiri Guru! Klik kotak untuk mulai membuka soal.');
        }
    } else {
        if (typeof logActivity === 'function') {
            logActivity('🚀 Permainan resmi dimulai! Siswa mulai memilih kotak soal.');
        }
    }
});

socket.on('time-extended', (data) => {
    if (data.globalEndTime) {
        adminGlobalTargetEndTime = data.globalEndTime;
    }
    logActivity(`Guru menambah +${data.extraSeconds || 30}s waktu kuis`);
});

function buildAdminGrid() {
    renderAdminBoxesView();
}

window.openTeacherBox = (boxIndex) => {
    if (!roomPin) return;
    socket.emit('admin-claim-box', { pin: roomPin, boxIndex });
};

let isTeacherBoxResolved = false;
let teacherHideEssayKeywords = localStorage.getItem('fire_hide_essay_keywords') === null ? true : (localStorage.getItem('fire_hide_essay_keywords') === 'true');
window.teacherMatchState = null;

window.toggleProjectorMode = () => {
    const dialog = document.getElementById('teacher-modal-dialog');
    const label = document.getElementById('projector-mode-label');
    if (!dialog) return;
    const isFull = dialog.classList.toggle('projector-fullscreen-mode');
    if (label) {
        label.innerText = isFull ? 'Perkecil Tampilan' : 'Layar Penuh Proyektor';
    }
};

window.toggleEssayKeywords = () => {
    teacherHideEssayKeywords = !teacherHideEssayKeywords;
    localStorage.setItem('fire_hide_essay_keywords', teacherHideEssayKeywords ? 'true' : 'false');
    const wrapper = document.getElementById('teacher-essay-keyword-wrapper');
    const btnToggle = document.getElementById('btn-toggle-essay-keywords');
    if (wrapper && currentTeacherQData) {
        wrapper.innerHTML = renderTeacherEssayKeywords(getTeacherAnswerKeyText(currentTeacherQData));
    }
    if (btnToggle) {
        btnToggle.innerText = teacherHideEssayKeywords ? '👁️ Tampilkan Kata Kunci' : '🙈 Sembunyikan Kata Kunci (Mode Proyektor)';
        btnToggle.style.color = teacherHideEssayKeywords ? 'var(--gold)' : '#38bdf8';
        btnToggle.style.borderColor = teacherHideEssayKeywords ? 'var(--gold)' : '#38bdf8';
    }
};

function renderTeacherEssayKeywords(answerText) {
    if (teacherHideEssayKeywords) {
        return `
            <div style="background:rgba(255,255,255,0.05); border:2px dashed rgba(255,255,255,0.25); border-radius:14px; padding:20px 24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                <div>
                    <span style="color:#94a3b8; font-size:1.15rem; font-weight:800; display:flex; align-items:center; gap:8px;">
                        <span>🔒</span> Kata Kunci Disembunyikan (Aman untuk Layar Proyektor)
                    </span>
                    <small style="color:rgba(255,255,255,0.65); display:block; font-size:0.95rem; margin-top:4px;">
                        Kata kunci tidak terlihat oleh murid di depan kelas. Guru dapat mengintip jika diperlukan.
                    </small>
                </div>
                <button type="button" class="btn btn-secondary" onclick="toggleEssayKeywords()" style="font-size:1rem; padding:8px 18px; border-color:var(--gold); color:var(--gold); font-weight:bold;">
                    👁️ Intip / Buka Kata Kunci
                </button>
            </div>
        `;
    } else {
        return `
            <div style="background:rgba(56,189,248,0.14); border-left:6px solid #38bdf8; border-radius:14px; padding:20px 24px;">
                <div class="flex-between mb-2">
                    <small style="color:#38bdf8; font-weight:800; font-size:1rem; text-transform:uppercase; letter-spacing:1px; display:flex; align-items:center; gap:6px;">
                        <span>💡</span> Panduan Kunci / Kata Kunci Jawaban:
                    </small>
                    <button type="button" class="btn btn-secondary btn-small" onclick="toggleEssayKeywords()" style="font-size:0.85rem; padding:4px 10px;">
                        🙈 Sembunyikan untuk Proyektor
                    </button>
                </div>
                <div style="color:#ffffff; font-size:1.4rem; font-weight:800; line-height:1.45;">
                    ${escapeHTML(answerText)}
                </div>
            </div>
        `;
    }
}

function getTeacherAnswerKeyText(q) {
    if (!q) return '-';
    const rawType = (q.type || 'mc').toLowerCase();
    if (rawType === 'mc' || rawType === 'multiple_choice' || rawType === 'pg') {
        const options = Array.isArray(q.options) ? q.options : [];
        let cIdx = q.correctIndex !== undefined ? q.correctIndex : -1;
        if (cIdx === -1 && q.correctAnswer !== undefined) {
            cIdx = options.findIndex(o => String(o).trim().toLowerCase() === String(q.correctAnswer).trim().toLowerCase());
            if (cIdx === -1 && !isNaN(Number(q.correctAnswer))) cIdx = Number(q.correctAnswer);
        }
        const optLetter = ['A','B','C','D'][cIdx] || '';
        const optVal = (cIdx >= 0 && options[cIdx]) ? options[cIdx] : (q.correctAnswer || '');
        return `${optLetter ? optLetter + '. ' : ''}${optVal}`;
    } else if (rawType === 'tf' || rawType === 'true_false') {
        const isTrue = q.correct === true || q.correctAnswer === true || String(q.correctAnswer).toLowerCase() === 'true' || String(q.correctAnswer).toLowerCase() === 'benar';
        return isTrue ? 'BENAR (TRUE)' : 'SALAH (FALSE)';
    } else if (rawType === 'match' || rawType === 'matching') {
        const pairs = Array.isArray(q.pairs) ? q.pairs : (Array.isArray(q.matchingPairs) ? q.matchingPairs : []);
        return pairs.map((p, i) => `${i+1}. ${p.left || p.kiri || (Array.isArray(p) ? p[0] : '')} ➔ ${p.right || p.kanan || (Array.isArray(p) ? p[1] : '')}`).join(' | ');
    } else {
        return q.correctText || q.correctAnswer || '-';
    }
}

function isManualGradedType(rawType) {
    const t = (rawType || '').toLowerCase();
    return t === 'essay' || t === 'esai' || t === 'uraian' || t === 'short' || t === 'short_answer' || t === 'isian';
}

function revealTeacherAnswerKey(open) {
    const panel = document.getElementById('teacher-answer-reveal-panel');
    const btn = document.getElementById('btn-teacher-reveal');
    if (panel) {
        if (open) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
    }
    if (btn) {
        btn.innerText = open ? '🔑 Kunci Jawaban Terbuka' : '👁️ Buka Kunci Jawaban';
    }
}

function showTeacherResultBanner(isCorrect, isManual = false) {
    const banner = document.getElementById('teacher-modal-result-banner');
    if (!banner) return;
    banner.classList.remove('hidden');
    if (isCorrect) {
        banner.style.background = 'rgba(16, 185, 129, 0.25)';
        banner.style.border = '2.5px solid #10b981';
        document.getElementById('teacher-result-icon').innerText = '🎉';
        document.getElementById('teacher-result-title').innerText = isManual ? '✅ Ditandai BENAR oleh Guru!' : '✅ Jawaban Terjawab BENAR!';
        document.getElementById('teacher-result-subtitle').innerText = `+${currentTeacherBoxPoints} Poin ditambahkan ke skor. Kunci jawaban resmi terbuka di bawah.`;
    } else {
        banner.style.background = 'rgba(239, 68, 68, 0.25)';
        banner.style.border = '2.5px solid #ef4444';
        document.getElementById('teacher-result-icon').innerText = '❌';
        document.getElementById('teacher-result-title').innerText = isManual ? '❌ Ditandai SALAH oleh Guru' : '❌ Jawaban Kurang Tepat!';
        document.getElementById('teacher-result-subtitle').innerText = `0 Poin. Kunci jawaban resmi terbuka di bawah.`;
    }
}

function showTeacherDoneActions(isCorrect) {
    const container = document.getElementById('teacher-modal-actions-container');
    if (!container) return;
    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <span class="badge" style="background:${isCorrect ? '#10b981' : '#ef4444'}; color:white; font-size:1.15rem; padding:8px 20px; border-radius:24px; font-weight:900;">
                ${isCorrect ? '✓ Selesai: Benar (+'+currentTeacherBoxPoints+' Poin)' : '✗ Selesai: Salah (0 Poin)'}
            </span>
        </div>
        <div style="display:flex; gap:12px;">
            <button type="button" class="btn btn-primary btn-large" onclick="closeTeacherModal()" style="font-size:1.2rem; padding:14px 34px; font-weight:900; box-shadow:0 6px 22px rgba(16,185,129,0.4);">
                ✅ Selesai & Lanjut ke Kotak Berikutnya →
            </button>
        </div>
    `;
}

// ================= MATCHING INTERACTIVE CONTROLLER =================
function initTeacherMatchState(q) {
    let pairs = Array.isArray(q.pairs) ? q.pairs : (Array.isArray(q.matchingPairs) ? q.matchingPairs : []);
    if ((!pairs || pairs.length === 0) && Array.isArray(q.lefts) && Array.isArray(q.rights)) {
        pairs = [];
        for (let i = 0; i < Math.min(q.lefts.length, q.rights.length); i++) {
            pairs.push({ left: q.lefts[i], right: q.rights[i] });
        }
    }
    if (!pairs || pairs.length === 0) {
        pairs = [{ left: 'Item 1', right: 'Pasangan 1' }, { left: 'Item 2', right: 'Pasangan 2' }];
    }

    const lefts = pairs.map((p, idx) => ({
        idx,
        text: p.left || p.kiri || (Array.isArray(p) ? p[0] : '')
    }));

    // Randomize rights order
    const rights = pairs.map((p, idx) => ({
        idx,
        text: p.right || p.kanan || (Array.isArray(p) ? p[1] : '')
    })).sort(() => Math.random() - 0.5);

    window.teacherMatchState = {
        pairs,
        lefts,
        rights,
        selectedLeftIdx: null,
        userPairs: [], // array of { leftIdx, rightIdx }
        palette: [
            { border: '#38bdf8', bg: 'rgba(56,189,248,0.22)' },
            { border: '#34d399', bg: 'rgba(52,211,153,0.22)' },
            { border: '#f59e0b', bg: 'rgba(245,158,11,0.22)' },
            { border: '#a855f7', bg: 'rgba(168,85,247,0.22)' },
            { border: '#ec4899', bg: 'rgba(236,72,153,0.22)' },
            { border: '#06b6d4', bg: 'rgba(6,182,212,0.22)' },
            { border: '#84cc16', bg: 'rgba(132,204,22,0.22)' },
            { border: '#eab308', bg: 'rgba(234,179,8,0.22)' }
        ]
    };

    renderTeacherMatchUI();
}

function renderTeacherMatchUI() {
    const optArea = document.getElementById('teacher-modal-options-area');
    if (!optArea || !window.teacherMatchState) return;

    const s = window.teacherMatchState;
    const isCompleted = isTeacherBoxResolved;
    const totalCount = s.pairs.length;
    const pairedCount = s.userPairs.length;
    const allPaired = pairedCount === totalCount && totalCount > 0;

    optArea.innerHTML = `
        <div style="background:rgba(0,0,0,0.35); border-radius:18px; padding:22px 26px; border:1px solid rgba(255,255,255,0.18);">
            <!-- TOOLBAR / GUIDANCE -->
            <div class="flex-between mb-3" style="flex-wrap:wrap; gap:12px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.4rem;">🧩</span>
                    <strong style="color:var(--gold); font-size:1.3rem;">Cocokkan Kolom Kiri dan Kanan</strong>
                    <span class="badge" style="background:${allPaired ? '#10b981' : '#38bdf8'}; color:#fff; font-weight:800; font-size:1rem; padding:4px 14px; border-radius:14px;">
                        ${pairedCount} / ${totalCount} Terhubung
                    </span>
                </div>
                ${!isCompleted ? `
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary btn-small" onclick="resetTeacherMatch()" style="font-size:0.95rem; padding:6px 14px;" ${pairedCount === 0 ? 'disabled' : ''}>
                            🔄 Reset Pasangan
                        </button>
                        <button type="button" class="btn btn-secondary btn-small" onclick="selectTeacherMatchAuto()" style="border-color:#10b981; color:#a7f3d0; font-size:0.95rem; padding:6px 14px; font-weight:bold;">
                            ⚡ Verifikasi Cepat (Kunci)
                        </button>
                    </div>
                ` : ''}
            </div>

            <!-- INSTRUCTION NOTICE -->
            <div style="background:rgba(255,255,255,0.06); padding:12px 18px; border-radius:12px; margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <span style="font-size:1.1rem; color:rgba(255,255,255,0.92);">
                    ${s.selectedLeftIdx !== null 
                        ? `<strong style="color:var(--gold);">👉 Langkah 2:</strong> Sekarang klik item pasangannya di <strong>Kolom Kanan</strong>.`
                        : `<strong style="color:#38bdf8;">👉 Langkah 1:</strong> Klik item di <strong>Kolom Kiri</strong> untuk memilih pasangan.`}
                </span>
                ${s.selectedLeftIdx !== null ? `
                    <button type="button" class="btn btn-secondary btn-small" onclick="cancelTeacherMatchSelect()" style="font-size:0.85rem; padding:3px 10px;">
                        Batal Pilih
                    </button>
                ` : ''}
            </div>

            <!-- TWO COLUMNS -->
            <div class="teacher-match-container">
                <!-- LEFT COLUMN -->
                <div class="teacher-match-col">
                    <div class="teacher-match-header">
                        <span>📌 KOLOM KIRI (SOAL)</span>
                        <small style="color:rgba(255,255,255,0.7); font-size:0.9rem; font-weight:normal;">Klik salah satu</small>
                    </div>
                    ${s.lefts.map(l => {
                        const pairIdx = s.userPairs.findIndex(p => p.leftIdx === l.idx);
                        const isPaired = pairIdx !== -1;
                        const isSelected = s.selectedLeftIdx === l.idx;
                        const colorStyle = isPaired ? s.palette[pairIdx % s.palette.length] : null;

                        let cardStyle = '';
                        if (isPaired) {
                            cardStyle = `border-color:${colorStyle.border}; background:${colorStyle.bg};`;
                        } else if (isSelected) {
                            cardStyle = `border-color:var(--gold); background:rgba(255,215,0,0.22); box-shadow:0 0 20px rgba(255,215,0,0.45);`;
                        }

                        return `
                            <div class="teacher-match-card ${isSelected ? 'selected' : ''} ${isPaired ? 'paired' : ''}" 
                                 onclick="${isCompleted ? '' : `clickTeacherMatchLeft(${l.idx})`}"
                                 style="${cardStyle} ${isCompleted ? 'pointer-events:none;' : ''}">
                                <div style="display:flex; align-items:center; gap:12px;">
                                    <span class="match-index-badge">${l.idx + 1}</span>
                                    <span class="match-text">${escapeHTML(l.text)}</span>
                                </div>
                                <div>
                                    ${isPaired ? `
                                        <span class="badge" style="background:${colorStyle.border}; color:#111; font-weight:900; font-size:0.95rem; padding:4px 12px; border-radius:12px;">
                                            🔗 #${pairIdx + 1}
                                        </span>
                                    ` : (isSelected ? `
                                        <span class="badge" style="background:var(--gold); color:#111; font-weight:bold; font-size:0.9rem; padding:4px 10px; border-radius:10px;">
                                            Dipilih 👈
                                        </span>
                                    ` : '')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- RIGHT COLUMN -->
                <div class="teacher-match-col">
                    <div class="teacher-match-header">
                        <span>🎯 KOLOM KANAN (PASANGAN)</span>
                        <small style="color:rgba(255,255,255,0.7); font-size:0.9rem; font-weight:normal;">Klik pasangannya</small>
                    </div>
                    ${s.rights.map((r, rIdx) => {
                        const pairIdx = s.userPairs.findIndex(p => p.rightIdx === r.idx);
                        const isPaired = pairIdx !== -1;
                        const colorStyle = isPaired ? s.palette[pairIdx % s.palette.length] : null;

                        let cardStyle = '';
                        if (isPaired) {
                            cardStyle = `border-color:${colorStyle.border}; background:${colorStyle.bg};`;
                        }

                        return `
                            <div class="teacher-match-card ${isPaired ? 'paired' : ''}" 
                                 onclick="${isCompleted ? '' : `clickTeacherMatchRight(${r.idx})`}"
                                 style="${cardStyle} ${isCompleted ? 'pointer-events:none;' : ''}">
                                <div style="display:flex; align-items:center; gap:12px;">
                                    <span class="match-index-badge" style="color:#38bdf8;">${String.fromCharCode(65 + rIdx)}</span>
                                    <span class="match-text">${escapeHTML(r.text)}</span>
                                </div>
                                <div>
                                    ${isPaired ? `
                                        <span class="badge" style="background:${colorStyle.border}; color:#111; font-weight:900; font-size:0.95rem; padding:4px 12px; border-radius:12px;">
                                            🔗 #${pairIdx + 1}
                                        </span>
                                    ` : (s.selectedLeftIdx !== null ? `
                                        <span class="badge" style="background:rgba(255,255,255,0.18); color:#fff; font-size:0.9rem; padding:4px 10px; border-radius:10px;">
                                            Klik untuk pasangkan
                                        </span>
                                    ` : '')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- PAIRED CHIPS SUMMARY -->
            ${s.userPairs.length > 0 ? `
                <div style="margin-top:18px; padding-top:16px; border-top:1px dashed rgba(255,255,255,0.2);">
                    <small style="color:rgba(255,255,255,0.75); font-size:0.95rem; font-weight:bold; display:block; margin-bottom:8px;">
                        🔗 Pasangan Terhubung (${s.userPairs.length} item):
                    </small>
                    <div style="display:flex; flex-wrap:wrap; gap:10px;">
                        ${s.userPairs.map((p, pIdx) => {
                            const lObj = s.lefts.find(item => item.idx === p.leftIdx);
                            const rObj = s.rights.find(item => item.idx === p.rightIdx);
                            const color = s.palette[pIdx % s.palette.length];
                            return `
                                <div class="teacher-match-pair-chip" style="border:1.5px solid ${color.border}; background:${color.bg};">
                                    <span style="font-weight:900; color:${color.border}; font-size:1rem;">#${pIdx + 1}</span>
                                    <span style="color:#fff;">${escapeHTML(lObj ? lObj.text : '')}</span>
                                    <span style="color:${color.border}; font-weight:900;">➔</span>
                                    <span style="color:#fff;">${escapeHTML(rObj ? rObj.text : '')}</span>
                                    ${!isCompleted ? `
                                        <button type="button" onclick="unpairTeacherMatch(${p.leftIdx})" style="background:none; border:none; color:#f87171; cursor:pointer; font-weight:bold; font-size:1.2rem; padding:0 4px;" title="Lepas Pasangan">✕</button>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- SUBMIT BUTTON -->
            ${!isCompleted ? `
                <div style="margin-top:24px; text-align:center;">
                    <button type="button" id="btn-submit-teacher-match" class="btn ${allPaired ? 'btn-success' : 'btn-secondary'} btn-large" 
                            onclick="submitTeacherMatch()" 
                            style="font-size:1.25rem; padding:15px 38px; font-weight:900; border-radius:14px; box-shadow:${allPaired ? '0 8px 24px rgba(16,185,129,0.5)' : 'none'};">
                        ${allPaired ? '⚡ Periksa & Selesaikan Pasangan (Semua Terhubung)' : `⚡ Periksa Jawaban Pasangan (${pairedCount}/${totalCount} Terhubung)`}
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

window.clickTeacherMatchLeft = (leftIdx) => {
    if (isTeacherBoxResolved || !window.teacherMatchState) return;
    const s = window.teacherMatchState;
    const existingPairIdx = s.userPairs.findIndex(p => p.leftIdx === leftIdx);
    if (existingPairIdx !== -1) {
        s.userPairs.splice(existingPairIdx, 1);
        s.selectedLeftIdx = null;
        if (window.sounds) window.sounds.playClick();
        renderTeacherMatchUI();
        return;
    }
    s.selectedLeftIdx = leftIdx;
    if (window.sounds) window.sounds.playClick();
    renderTeacherMatchUI();
};

window.clickTeacherMatchRight = (rightIdx) => {
    if (isTeacherBoxResolved || !window.teacherMatchState) return;
    const s = window.teacherMatchState;
    const existingRightIdx = s.userPairs.findIndex(p => p.rightIdx === rightIdx);
    if (existingRightIdx !== -1) {
        s.userPairs.splice(existingRightIdx, 1);
        if (s.selectedLeftIdx === null) {
            if (window.sounds) window.sounds.playClick();
            renderTeacherMatchUI();
            return;
        }
    }

    if (s.selectedLeftIdx !== null) {
        const priorLeftIdx = s.userPairs.findIndex(p => p.leftIdx === s.selectedLeftIdx);
        if (priorLeftIdx !== -1) s.userPairs.splice(priorLeftIdx, 1);

        s.userPairs.push({ leftIdx: s.selectedLeftIdx, rightIdx });
        s.selectedLeftIdx = null;
        if (window.sounds) window.sounds.playClick();
        renderTeacherMatchUI();
    }
};

window.cancelTeacherMatchSelect = () => {
    if (!window.teacherMatchState) return;
    window.teacherMatchState.selectedLeftIdx = null;
    renderTeacherMatchUI();
};

window.unpairTeacherMatch = (leftIdx) => {
    if (isTeacherBoxResolved || !window.teacherMatchState) return;
    const s = window.teacherMatchState;
    const idx = s.userPairs.findIndex(p => p.leftIdx === leftIdx);
    if (idx !== -1) {
        s.userPairs.splice(idx, 1);
        if (window.sounds) window.sounds.playClick();
        renderTeacherMatchUI();
    }
};

window.resetTeacherMatch = () => {
    if (isTeacherBoxResolved || !window.teacherMatchState) return;
    window.teacherMatchState.userPairs = [];
    window.teacherMatchState.selectedLeftIdx = null;
    if (window.sounds) window.sounds.playClick();
    renderTeacherMatchUI();
};

window.submitTeacherMatch = () => {
    if (isTeacherBoxResolved || !window.teacherMatchState) return;
    const s = window.teacherMatchState;
    if (s.userPairs.length === 0) {
        showToast('Pasangkan item terlebih dahulu sebelum memeriksa.', 'warning');
        return;
    }

    isTeacherBoxResolved = true;

    // Check correctness:
    // Left items: index idx. Right items: index idx.
    // A pair { leftIdx, rightIdx } is correct if leftIdx === rightIdx.
    const isAllPaired = s.userPairs.length === s.pairs.length;
    let allCorrect = isAllPaired;
    if (isAllPaired) {
        for (const up of s.userPairs) {
            if (up.leftIdx !== up.rightIdx) {
                allCorrect = false;
                break;
            }
        }
    } else {
        allCorrect = false;
    }

    if (window.sounds) {
        if (allCorrect) window.sounds.playCorrect();
        else window.sounds.playWrong();
    }

    revealTeacherAnswerKey(true);
    showTeacherResultBanner(allCorrect);

    socket.emit('admin-complete-box', {
        pin: roomPin,
        boxIndex: currentTeacherBox,
        correct: allCorrect,
        points: currentTeacherBoxPoints
    });

    showTeacherDoneActions(allCorrect);
    renderTeacherMatchUI();
};

window.selectTeacherMatchAuto = () => {
    if (isTeacherBoxResolved) return;
    isTeacherBoxResolved = true;

    if (window.teacherMatchState) {
        const s = window.teacherMatchState;
        s.userPairs = s.pairs.map((p, i) => ({ leftIdx: i, rightIdx: i }));
        renderTeacherMatchUI();
    }

    if (window.sounds) window.sounds.playCorrect();

    revealTeacherAnswerKey(true);
    showTeacherResultBanner(true);

    socket.emit('admin-complete-box', {
        pin: roomPin,
        boxIndex: currentTeacherBox,
        correct: true,
        points: currentTeacherBoxPoints
    });

    showTeacherDoneActions(true);
};

// ================= ADMIN BOX OPENED HANDLER =================
socket.on('admin-box-opened', (data) => {
    currentTeacherBox = data.boxIndex;
    currentTeacherQData = data.question;
    currentTeacherBoxPoints = data.points || 100;
    isTeacherAnswerRevealed = false;
    isTeacherBoxResolved = Boolean(data.alreadyCompleted);
    window.teacherMatchState = null;

    const modal = document.getElementById('modal-teacher-operate');
    if (!modal || !data.question) return;

    // Reset banners
    const resultBanner = document.getElementById('teacher-modal-result-banner');
    if (resultBanner) resultBanner.classList.add('hidden');
    revealTeacherAnswerKey(false);

    // Header info
    document.getElementById('teacher-modal-qnum').innerText = `Kotak #${data.boxIndex + 1}`;
    document.getElementById('teacher-modal-points').innerText = `⭐ ${currentTeacherBoxPoints} Poin`;
    
    const q = data.question;
    const rawType = (q.type || 'mc').toLowerCase();
    const isManual = isManualGradedType(rawType);

    let typeLabel = 'PILIHAN GANDA';
    if (rawType === 'tf' || rawType === 'true_false') typeLabel = 'BENAR / SALAH';
    else if (rawType === 'match' || rawType === 'matching') typeLabel = 'MENJODOHKAN';
    else if (rawType === 'essay' || rawType === 'esai' || rawType === 'uraian') typeLabel = 'URAIAN / ESSAY';
    else if (rawType === 'short' || rawType === 'short_answer') typeLabel = 'ISIAN SINGKAT';
    document.getElementById('teacher-modal-type').innerText = typeLabel;

    const modeBadge = document.getElementById('teacher-modal-mode-badge');
    if (modeBadge) {
        if (data.alreadyCompleted) {
            modeBadge.style.background = '#6366f1';
            modeBadge.innerText = '👁️ Mode Review Soal';
        } else if (isManual) {
            modeBadge.style.background = '#f59e0b';
            modeBadge.innerText = '✍️ Penilaian Manual Guru (Essay)';
        } else {
            modeBadge.style.background = '#10b981';
            modeBadge.innerText = '⚡ Penilaian Otomatis (Klik Opsi)';
        }
    }

    // Question text
    document.getElementById('teacher-modal-question-text').innerText = q.text || q.question || 'Pertanyaan';

    // Format Answer Reveal Text
    const answerText = getTeacherAnswerKeyText(q);
    document.getElementById('teacher-answer-reveal-text').innerText = answerText;

    // Explanation
    const explBox = document.getElementById('teacher-modal-explanation-box');
    const explText = document.getElementById('teacher-modal-explanation-text');
    if (explBox && explText) {
        if (q.explanation && String(q.explanation).trim().length > 0) {
            explText.innerText = String(q.explanation).trim();
            explBox.classList.remove('hidden');
        } else {
            explBox.classList.add('hidden');
        }
    }

    // Interactive options area
    const optArea = document.getElementById('teacher-modal-options-area');
    optArea.innerHTML = '';

    if (rawType === 'mc' || rawType === 'multiple_choice' || rawType === 'pg') {
        const options = Array.isArray(q.options) ? q.options : [];
        optArea.innerHTML = `
            <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:1.15rem; color:var(--gold); font-weight:800; letter-spacing:0.5px;">PILIHAN JAWABAN (Klik salah satu untuk otomatis dinilai):</span>
                <span style="font-size:0.95rem; color:rgba(255,255,255,0.85); background:rgba(16,185,129,0.2); padding:3px 10px; border-radius:10px; border:1px solid #10b981;">⚡ Auto-grade aktif</span>
            </div>
            <div class="teacher-opt-card-grid">
                ${options.map((opt, i) => `
                    <div class="card teacher-opt-card" id="teacher-opt-${i}" onclick="selectTeacherOpt(${i})">
                        <span class="teacher-opt-letter">${['A','B','C','D'][i] || (i+1)}</span>
                        <span class="teacher-opt-text">${escapeHTML(opt)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    } else if (rawType === 'tf' || rawType === 'true_false') {
        optArea.innerHTML = `
            <div style="margin-bottom:12px; text-align:center;">
                <span style="font-size:1.2rem; color:var(--gold); font-weight:800; letter-spacing:0.5px;">PILIH KEBENARAN PERNYATAAN (Klik salah satu untuk otomatis dinilai):</span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                <div class="card teacher-opt-card" id="teacher-tf-true" onclick="selectTeacherTF(true)" style="cursor:pointer; text-align:center; display:flex; flex-direction:column; justify-content:center; align-items:center; background:rgba(16,185,129,0.18); border:3px solid #10b981; border-radius:18px; padding:28px; min-height:130px; transition:all 0.2s;">
                    <span style="font-size:3.5rem; display:block; margin-bottom:6px;">👍</span>
                    <strong style="font-size:2rem; color:#a7f3d0; font-weight:900; letter-spacing:1px;">BENAR (TRUE)</strong>
                </div>
                <div class="card teacher-opt-card" id="teacher-tf-false" onclick="selectTeacherTF(false)" style="cursor:pointer; text-align:center; display:flex; flex-direction:column; justify-content:center; align-items:center; background:rgba(239,68,68,0.18); border:3px solid #ef4444; border-radius:18px; padding:28px; min-height:130px; transition:all 0.2s;">
                    <span style="font-size:3.5rem; display:block; margin-bottom:6px;">👎</span>
                    <strong style="font-size:2rem; color:#fca5a5; font-weight:900; letter-spacing:1px;">SALAH (FALSE)</strong>
                </div>
            </div>
        `;
    } else if (rawType === 'match' || rawType === 'matching') {
        initTeacherMatchState(q);
    } else {
        // ESSAY / URAIAN / ISIAN (MANUAL GRADING)
        optArea.innerHTML = `
            <div class="card" style="background:rgba(0,0,0,0.35); border-radius:18px; padding:26px 30px; border:1px solid rgba(255,255,255,0.18);">
                <div class="flex-between mb-3" style="flex-wrap:wrap; gap:12px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:1.4rem;">✍️</span>
                        <strong style="color:var(--gold); font-size:1.3rem;">Penilaian Soal Uraian / Essay</strong>
                        <span class="badge" style="background:#f59e0b; color:#111; font-weight:bold; font-size:0.95rem; padding:4px 12px; border-radius:12px;">Periksa Manual Guru</span>
                    </div>
                    <button type="button" class="btn btn-secondary btn-small" id="btn-toggle-essay-keywords" onclick="toggleEssayKeywords()" style="font-size:1rem; font-weight:bold; border-color:${teacherHideEssayKeywords ? 'var(--gold)' : '#38bdf8'}; color:${teacherHideEssayKeywords ? 'var(--gold)' : '#38bdf8'};">
                        ${teacherHideEssayKeywords ? '👁️ Tampilkan Kata Kunci' : '🙈 Sembunyikan Kata Kunci (Mode Proyektor)'}
                    </button>
                </div>
                <p style="color:rgba(255,255,255,0.92); font-size:1.25rem; line-height:1.55; margin-bottom:18px;">
                    Dengarkan atau periksa jawaban esai murid di kelas, lalu beri nilai menggunakan tombol <strong>Tandai Benar</strong> atau <strong>Tandai Salah</strong> di bawah.
                </p>
                <div id="teacher-essay-keyword-wrapper">
                    ${renderTeacherEssayKeywords(answerText)}
                </div>
            </div>
        `;
    }

    // Action buttons container setup
    const actionsContainer = document.getElementById('teacher-modal-actions-container');
    if (actionsContainer) {
        if (data.alreadyCompleted) {
            // Already completed review mode
            revealTeacherAnswerKey(true);
            actionsContainer.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="badge" style="background:rgba(99,102,241,0.25); color:#c7d2fe; font-size:1.05rem; padding:8px 16px; border:1px solid #6366f1;">
                        Kotak ini sudah selesai dikerjakan
                    </span>
                </div>
                <button type="button" class="btn btn-secondary btn-large" onclick="closeTeacherModal()" style="padding:12px 28px; font-size:1.1rem; font-weight:bold;">
                    ✕ Tutup Review
                </button>
            `;
        } else if (isManual) {
            // Manual grading buttons for Essay/Uraian
            actionsContainer.innerHTML = `
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button type="button" id="btn-teacher-reveal" class="btn btn-secondary" onclick="toggleTeacherRevealAnswer()" style="border-color:#38bdf8; color:#38bdf8; font-size:1.05rem; padding:10px 18px;">
                        👁️ Buka Kunci Jawaban
                    </button>
                    <button type="button" id="btn-teacher-release" class="btn btn-secondary" onclick="releaseTeacherBox()" style="font-size:1.05rem; padding:10px 18px;">
                        ↩️ Lepas / Simpan Nanti
                    </button>
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <button type="button" id="btn-teacher-wrong" class="btn btn-danger" onclick="completeTeacherBoxManual(false)" style="font-size:1.2rem; padding:12px 26px; font-weight:bold; box-shadow:0 4px 14px rgba(239,68,68,0.3);">
                        ❌ Tandai Salah (0 Poin)
                    </button>
                    <button type="button" id="btn-teacher-correct" class="btn btn-success" onclick="completeTeacherBoxManual(true)" style="font-size:1.2rem; padding:12px 28px; font-weight:bold; box-shadow:0 4px 14px rgba(16,185,129,0.35);">
                        ✅ Tandai Benar (+${currentTeacherBoxPoints} Poin)
                    </button>
                </div>
            `;
        } else {
            // Auto grading questions (MC, TF, Match)
            actionsContainer.innerHTML = `
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button type="button" id="btn-teacher-reveal" class="btn btn-secondary" onclick="toggleTeacherRevealAnswer()" style="border-color:#38bdf8; color:#38bdf8; font-size:1.05rem; padding:10px 18px;">
                        👁️ Buka Kunci Jawaban
                    </button>
                    <button type="button" id="btn-teacher-release" class="btn btn-secondary" onclick="releaseTeacherBox()" style="font-size:1.05rem; padding:10px 18px;">
                        ↩️ Lepas / Batal Buka
                    </button>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <small style="color:var(--gold); font-weight:bold; font-size:1.05rem;">
                        👆 Klik salah satu opsi di atas untuk otomatis dinilai
                    </small>
                </div>
            `;
        }
    }

    modal.classList.remove('hidden');
});

window.selectTeacherOpt = (idx) => {
    if (isTeacherBoxResolved) return;
    isTeacherBoxResolved = true;

    const q = currentTeacherQData;
    if (!q) return;
    const options = Array.isArray(q.options) ? q.options : [];
    let cIdx = q.correctIndex !== undefined ? q.correctIndex : -1;
    if (cIdx === -1 && q.correctAnswer !== undefined) {
        cIdx = options.findIndex(o => String(o).trim().toLowerCase() === String(q.correctAnswer).trim().toLowerCase());
        if (cIdx === -1 && !isNaN(Number(q.correctAnswer))) {
            cIdx = Number(q.correctAnswer);
        }
    }

    const isCorrect = (idx === cIdx);

    // Visual feedback on options
    document.querySelectorAll('.teacher-opt-card').forEach((el, i) => {
        el.style.pointerEvents = 'none';
        if (i === idx) {
            if (isCorrect) {
                el.style.borderColor = '#10b981';
                el.style.background = 'rgba(16, 185, 129, 0.35)';
                el.innerHTML += ' <span class="badge" style="background:#10b981; color:white; font-size:1.05rem; padding:4px 12px; margin-left:auto; font-weight:bold;">✓ BENAR (+'+currentTeacherBoxPoints+' Pts)</span>';
            } else {
                el.style.borderColor = '#ef4444';
                el.style.background = 'rgba(239, 68, 68, 0.35)';
                el.innerHTML += ' <span class="badge" style="background:#ef4444; color:white; font-size:1.05rem; padding:4px 12px; margin-left:auto; font-weight:bold;">✗ SALAH</span>';
            }
        } else if (i === cIdx && !isCorrect) {
            el.style.borderColor = '#10b981';
            el.style.background = 'rgba(16, 185, 129, 0.25)';
            el.innerHTML += ' <span class="badge" style="background:#047857; color:#a7f3d0; font-size:1.05rem; padding:4px 12px; margin-left:auto; font-weight:bold;">🔑 KUNCI BENAR</span>';
        }
    });

    if (window.sounds) {
        if (isCorrect) window.sounds.playCorrect();
        else window.sounds.playWrong();
    }

    revealTeacherAnswerKey(true);
    showTeacherResultBanner(isCorrect);

    socket.emit('admin-complete-box', {
        pin: roomPin,
        boxIndex: currentTeacherBox,
        correct: isCorrect,
        points: currentTeacherBoxPoints
    });

    showTeacherDoneActions(isCorrect);
};

window.selectTeacherTF = (val) => {
    if (isTeacherBoxResolved) return;
    isTeacherBoxResolved = true;

    const q = currentTeacherQData;
    if (!q) return;
    const isTrue = q.correct === true || q.correctAnswer === true || String(q.correctAnswer).toLowerCase() === 'true' || String(q.correctAnswer).toLowerCase() === 'benar';
    const isCorrect = (val === isTrue);

    const trueCard = document.getElementById('teacher-tf-true');
    const falseCard = document.getElementById('teacher-tf-false');
    if (trueCard) trueCard.style.pointerEvents = 'none';
    if (falseCard) falseCard.style.pointerEvents = 'none';

    if (val) {
        if (isCorrect) {
            trueCard.style.background = 'rgba(16,185,129,0.35)';
            trueCard.style.boxShadow = '0 0 25px #10b981';
        } else {
            trueCard.style.background = 'rgba(239,68,68,0.35)';
            trueCard.style.borderColor = '#ef4444';
            falseCard.style.background = 'rgba(16,185,129,0.35)';
        }
    } else {
        if (isCorrect) {
            falseCard.style.background = 'rgba(16,185,129,0.35)';
            falseCard.style.boxShadow = '0 0 25px #10b981';
        } else {
            falseCard.style.background = 'rgba(239,68,68,0.35)';
            falseCard.style.borderColor = '#ef4444';
            trueCard.style.background = 'rgba(16,185,129,0.35)';
        }
    }

    if (window.sounds) {
        if (isCorrect) window.sounds.playCorrect();
        else window.sounds.playWrong();
    }

    revealTeacherAnswerKey(true);
    showTeacherResultBanner(isCorrect);

    socket.emit('admin-complete-box', {
        pin: roomPin,
        boxIndex: currentTeacherBox,
        correct: isCorrect,
        points: currentTeacherBoxPoints
    });

    showTeacherDoneActions(isCorrect);
};

window.completeTeacherBoxManual = (correct) => {
    if (currentTeacherBox === null || isTeacherBoxResolved) return;
    isTeacherBoxResolved = true;

    if (window.sounds) {
        if (correct) window.sounds.playCorrect();
        else window.sounds.playWrong();
    }

    revealTeacherAnswerKey(true);
    showTeacherResultBanner(correct, true);

    socket.emit('admin-complete-box', {
        pin: roomPin,
        boxIndex: currentTeacherBox,
        correct,
        points: currentTeacherBoxPoints
    });

    showTeacherDoneActions(correct);
};

window.completeTeacherBox = (correct) => {
    window.completeTeacherBoxManual(correct);
};

window.toggleTeacherRevealAnswer = () => {
    isTeacherAnswerRevealed = !isTeacherAnswerRevealed;
    revealTeacherAnswerKey(isTeacherAnswerRevealed);
};

window.releaseTeacherBox = () => {
    if (currentTeacherBox === null) return;
    socket.emit('admin-release-box', {
        pin: roomPin,
        boxIndex: currentTeacherBox
    });
    closeTeacherModal();
};

window.closeTeacherModal = () => {
    const modal = document.getElementById('modal-teacher-operate');
    if (modal) modal.classList.add('hidden');
    currentTeacherBox = null;
    currentTeacherQData = null;
    isTeacherBoxResolved = false;
    window.teacherMatchState = null;
};

socket.on('box-claimed', (data) => {
    const boxObj = adminInspectionBoxes.find(b => b.index === data.boxIndex);
    if (boxObj) {
        boxObj.status = 'locked';
        boxObj.lockedByName = data.playerName;
        boxObj.lockedBy = data.playerId;
    }
    renderAdminBoxesView();

    const box = document.getElementById(`admin-box-${data.boxIndex}`);
    if (box) {
        // Render champion sprite on admin box
        const playerObj = players.find(p => p.id === data.playerId);
        if (typeof SpriteGen !== 'undefined' && playerObj && SpriteGen.parse(playerObj.avatar).isSprite) {
            let holder = box.querySelector('.box-sprite-holder');
            if (!holder) {
                holder = document.createElement('div');
                holder.className = 'box-sprite-holder';
                box.appendChild(holder);
            }
            holder.innerHTML = '';
            holder.appendChild(SpriteGen.createCanvas(playerObj.avatar, { size: 28, animation: 'idle' }));
        }
    }
    logActivity(`${data.playerName} ambil Soal #${data.boxIndex+1}`);
});

socket.on('box-released', (data) => {
    const boxObj = adminInspectionBoxes.find(b => b.index === data.boxIndex);
    if (boxObj) {
        boxObj.status = 'available';
        boxObj.lockedByName = null;
        boxObj.lockedBy = null;
    }
    renderAdminBoxesView();
    logActivity(`Kotak #${data.boxIndex+1} dilepas kembali`);
});

socket.on('box-completed', (data) => {
    const boxObj = adminInspectionBoxes.find(b => b.index === data.boxIndex);
    if (boxObj) {
        boxObj.status = 'completed';
        boxObj.answeredCorrectly = data.correct;
        if (data.points !== undefined) boxObj.points = data.points;
    }
    renderAdminBoxesView();

    if (data.soloScore !== undefined) {
        adminSoloScore = data.soloScore;
        const scoreEl = document.getElementById('admin-solo-score');
        if (scoreEl) scoreEl.innerText = adminSoloScore;
    }
});

socket.on('admin-box-completed', (data) => {
    if (data.soloScore !== undefined) {
        adminSoloScore = data.soloScore;
        const scoreEl = document.getElementById('admin-solo-score');
        if (scoreEl) scoreEl.innerText = adminSoloScore;
    }
    logActivity(`Kotak #${data.boxIndex + 1} ditandai ${data.correct ? 'BENAR (+'+data.points+' poin)' : 'SALAH'} oleh Guru`);
    if (data.isGameOver) {
        logActivity('🏁 Seluruh kotak soal telah selesai dikerjakan!');
    }
});

socket.on('leaderboard-update', (data) => {
    const lb = document.getElementById('admin-leaderboard');
    if (!lb) return;
    lb.innerHTML = data.leaderboard.map(p => {
        const avatarHtml = (typeof SpriteGen !== 'undefined')
            ? SpriteGen.renderAvatarHtml(p.avatar, { size: 28, animation: 'idle' })
            : `<span class="avatar-small">${p.avatar}</span>`;
        return `
        <div class="lb-item">
            <span class="lb-rank">#${p.rank}</span>
            ${avatarHtml}
            <span style="margin-left:4px; font-weight:bold;">${escapeHTML(p.nickname)}</span>
            <span class="lb-score">${p.score}</span>
        </div>
    `}).join('');
    if (typeof SpriteGen !== 'undefined') SpriteGen.hydrate(lb);
});

function logActivity(msg) {
    const log = document.getElementById('activity-log');
    const d = document.createElement('div');
    d.style.fontSize = '0.9rem';
    d.style.marginBottom = '5px';
    d.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.prepend(d);
}

let isPaused = false;
document.getElementById('btn-pause').onclick = (e) => {
    isPaused = !isPaused;
    e.target.innerText = isPaused ? 'Resume Game' : 'Pause Game';
    socket.emit(isPaused ? 'pause-game' : 'resume-game', { pin: roomPin });
};

document.getElementById('btn-end').onclick = () => {
    document.getElementById('modal-confirm').classList.remove('hidden');
};
document.getElementById('btn-cancel-end').onclick = () => {
    document.getElementById('modal-confirm').classList.add('hidden');
};
document.getElementById('btn-confirm-end').onclick = () => {
    socket.emit('end-game', { pin: roomPin });
};

socket.on('game-ended', (data) => {
    sessionStorage.setItem('coc_results', JSON.stringify(data.results));
    window.location.href = 'results.html';
});

let totalP = 0;
function updatePlayerCount(diff) {
    totalP += diff;
    const b = document.getElementById('admin-player-badge');
    if(b) b.innerText = totalP;
    const a = document.getElementById('stat-active');
    if(a) a.innerText = totalP;
}
document.getElementById('admin-search')?.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    document.querySelectorAll('.admin-player-list .card').forEach(c => {
        c.style.display = c.innerText.toLowerCase().includes(val) ? '' : 'none';
    });
});
document.getElementById('btn-import-json')?.addEventListener('click', () => {
    try {
        const data = JSON.parse(document.getElementById('import-json').value);
        if(Array.isArray(data)) {
            questions = data;
            buildAdminGrid();
            socket.emit('update-questions', { pin: roomPin, questions });
            alert('Import sukses!');
        }
    } catch(e) { alert('Invalid JSON'); }
});
function kickPlayer(id) {
    if(confirm('Tendang pemain?')) {
        socket.emit('kick-player', { pin: roomPin, playerId: id });
    }
}

// ==========================================
// UPLOAD EXCEL / WORD & GUIDE MODAL LOGIC
// ==========================================
let pendingUploadedQuestions = [];

const modalUpload = document.getElementById('modal-upload-file');
const modalGuide = document.getElementById('modal-format-guide');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-file-status');
const uploadStatusText = document.getElementById('upload-status-text');
const previewSection = document.getElementById('upload-preview-section');
const previewTableBody = document.getElementById('preview-table-body');
const previewHeading = document.getElementById('preview-heading');

document.getElementById('btn-open-upload')?.addEventListener('click', () => {
    modalUpload.classList.remove('hidden');
    resetUploadModal();
});

document.getElementById('btn-guide-format')?.addEventListener('click', () => {
    modalGuide.classList.remove('hidden');
});

window.closeUploadModal = () => {
    modalUpload.classList.add('hidden');
};

window.closeGuideModal = () => {
    modalGuide.classList.add('hidden');
};

window.switchUploadTab = (tab) => {
    document.querySelectorAll('#modal-upload-file .modal-tab-btn').forEach(btn => btn.classList.remove('active'));
    if (tab === 'file') {
        document.getElementById('tab-btn-file').classList.add('active');
        document.getElementById('tab-content-file').classList.remove('hidden');
        document.getElementById('tab-content-text').classList.add('hidden');
    } else {
        document.getElementById('tab-btn-text').classList.add('active');
        document.getElementById('tab-content-file').classList.add('hidden');
        document.getElementById('tab-content-text').classList.remove('hidden');
    }
};

window.switchGuideTab = (tab) => {
    document.querySelectorAll('#modal-format-guide .modal-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-guide-${tab}`).classList.add('active');
    ['excel', 'word', 'types'].forEach(t => {
        document.getElementById(`guide-content-${t}`).classList.toggle('hidden', t !== tab);
    });
};

window.copyWordSample = () => {
    const text = document.getElementById('sample-word-code').innerText;
    navigator.clipboard.writeText(text);
    alert('Contoh format Word berhasil disalin ke clipboard!');
};

function resetUploadModal() {
    pendingUploadedQuestions = [];
    previewSection.classList.add('hidden');
    uploadStatus.classList.add('hidden');
    if (fileInput) fileInput.value = '';
    const pasteInput = document.getElementById('paste-text-input');
    if (pasteInput) pasteInput.value = '';
}

// Drag & drop handlers
if (dropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            handleFileUpload(files[0]);
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });
}

async function handleFileUpload(file) {
    uploadStatus.classList.remove('hidden');
    uploadStatusText.innerText = `Mengunggah & membaca ${file.name}...`;
    previewSection.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const resp = await fetch('/api/upload-questions', {
            method: 'POST',
            body: formData
        });
        const result = await resp.json();

        uploadStatus.classList.add('hidden');

        if (result.success && result.questions && result.questions.length > 0) {
            renderUploadPreview(result.questions);
        } else {
            alert('Gagal memproses file: ' + (result.message || 'Format tidak valid'));
        }
    } catch (err) {
        uploadStatus.classList.add('hidden');
        alert('Terjadi kesalahan koneksi saat mengunggah file: ' + err.message);
    }
}

// Paste text handler
document.getElementById('btn-process-pasted-text')?.addEventListener('click', async () => {
    const text = document.getElementById('paste-text-input').value.trim();
    if (!text) {
        alert('Harap tempel teks soal terlebih dahulu!');
        return;
    }

    try {
        const resp = await fetch('/api/parse-word-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const result = await resp.json();

        if (result.success && result.questions && result.questions.length > 0) {
            renderUploadPreview(result.questions);
        } else {
            alert('Gagal memproses teks: ' + (result.message || 'Format tidak dikenali'));
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
});

function renderUploadPreview(qs) {
    pendingUploadedQuestions = qs;
    previewHeading.innerText = `✅ Ditemukan ${qs.length} Soal Siap Dimuat`;
    previewSection.classList.remove('hidden');

    const typeLabels = {
        'multiple_choice': '<span class="badge-type badge-mc">PG</span>',
        'mc': '<span class="badge-type badge-mc">PG</span>',
        'true_false': '<span class="badge-type badge-tf">Benar/Salah</span>',
        'tf': '<span class="badge-type badge-tf">Benar/Salah</span>',
        'short_answer': '<span class="badge-type badge-short">Isian</span>',
        'short': '<span class="badge-type badge-short">Isian</span>',
        'matching': '<span class="badge-type badge-match">Jodohkan</span>',
        'match': '<span class="badge-type badge-match">Jodohkan</span>'
    };

    previewTableBody.innerHTML = qs.map((q, idx) => {
        let ansDisplay = '';
        if (q.type === 'true_false' || q.type === 'tf') {
            ansDisplay = q.correctAnswer ? 'BENAR ✓' : 'SALAH ✗';
        } else if (q.type === 'matching' || q.type === 'match') {
            const pairs = q.matchingPairs || q.pairs || [];
            ansDisplay = pairs.map(p => `${p.left} = ${p.right}`).join(', ');
        } else {
            ansDisplay = String(q.correctAnswer || q.options?.[q.correctIndex] || '-');
        }

        const qText = q.question || q.text || '-';
        return `
            <tr>
                <td><strong>${idx + 1}</strong></td>
                <td>${typeLabels[q.type] || q.type}</td>
                <td style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${qText}">${qText}</td>
                <td style="max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--gold); font-weight:bold;">${ansDisplay}</td>
                <td>⭐ ${q.points || 100}</td>
            </tr>
        `;
    }).join('');
}

document.getElementById('btn-apply-uploaded-questions')?.addEventListener('click', () => {
    if (!pendingUploadedQuestions || pendingUploadedQuestions.length === 0) return;

    const mode = document.querySelector('input[name="upload-mode"]:checked')?.value || 'replace';

    if (mode === 'replace') {
        questions = [...pendingUploadedQuestions];
    } else {
        questions.push(...pendingUploadedQuestions);
    }

    socket.emit('update-questions', { pin: roomPin, questions });
    updateQuestionsList();
    checkStartBtn();
    closeUploadModal();

    alert(`Sukses! ${pendingUploadedQuestions.length} soal berhasil dimuat ke game.`);
});

// ================= BANK SOAL =================
window.openBankModal = () => {
    if (!currentUser) {
        if (confirm('Fitur Bank Soal memerlukan Akun Guru agar tersimpan. Ingin login sekarang?')) {
            window.location.href = 'login.html';
        }
        return;
    }
    document.getElementById('modal-question-bank').classList.remove('hidden');
    loadQuestionBanks();
};

window.closeBankModal = () => {
    document.getElementById('modal-question-bank').classList.add('hidden');
};

async function loadQuestionBanks() {
    const container = document.getElementById('bank-list-container');
    container.innerHTML = '<p class="text-center" style="color:var(--text-muted); padding:10px;">Memuat bank soal...</p>';

    try {
        const resp = await authFetch(`/api/guru/question-banks?guruId=${currentUser.id}`);
        const res = await resp.json();

        if (res.success && res.banks) {
            if (res.banks.length === 0) {
                container.innerHTML = '<p class="text-center" style="color:var(--text-muted); padding:10px;">Belum ada paket soal tersimpan di akun Anda.</p>';
                return;
            }

            container.innerHTML = res.banks.map(b => `
                <div class="card mb-2 flex-between" style="background:rgba(255,255,255,0.04); padding:10px 14px;">
                    <div>
                        <strong style="color:var(--gold); font-size:1rem;">${escapeHTML(b.title)}</strong>
                        <div style="font-size:0.8rem; color:var(--text-muted);">Disimpan: ${new Date(b.created_at).toLocaleDateString('id-ID')}</div>
                    </div>
                    <button onclick="loadBankIntoRoom(${b.id})" class="btn btn-primary btn-small">📥 Muat ke Game</button>
                </div>
            `).join('');
        }
    } catch (err) {
        container.innerHTML = `<p class="error-text">Gagal memuat: ${err.message}</p>`;
    }
}

window.saveCurrentQuestionsToBank = async () => {
    if (!currentUser) return;
    if (questions.length === 0) {
        alert('Belum ada soal pada kuis saat ini!');
        return;
    }

    const titleInput = document.getElementById('bank-save-title');
    const title = titleInput.value.trim() || `Paket Soal (${questions.length} Soal)`;

    try {
        const resp = await authFetch('/api/guru/question-banks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guruId: currentUser.id,
                title,
                questions
            })
        });
        const res = await resp.json();

        if (res.success) {
            alert(`Paket soal "${title}" berhasil disimpan ke bank soal!`);
            titleInput.value = '';
            loadQuestionBanks();
        } else {
            alert('Gagal: ' + res.message);
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
};

window.loadBankIntoRoom = async (bankId) => {
    if (!confirm('Muat soal dari paket ini? Soal saat ini akan digantikan.')) return;

    try {
        const resp = await authFetch(`/api/guru/question-banks/${bankId}?guruId=${currentUser.id}`);
        const res = await resp.json();

        if (res.success && res.bank && res.bank.questions) {
            questions = res.bank.questions;
            socket.emit('update-questions', { pin: roomPin, questions });
            updateQuestionsList();
            checkStartBtn();
            closeBankModal();
            alert(`Berhasil memuat ${questions.length} soal ke game!`);
        } else {
            alert('Gagal memuat paket soal.');
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
};

// ================= LAPORAN GURU =================
window.openReportsModal = () => {
    if (!currentUser) {
        if (confirm('Laporan dan rekap nilai hanya tersimpan untuk Akun Guru terdaftar. Ingin login sekarang?')) {
            window.location.href = 'login.html';
        }
        return;
    }
    document.getElementById('modal-guru-reports').classList.remove('hidden');
    loadGuruReports();
};

window.closeReportsModal = () => {
    document.getElementById('modal-guru-reports').classList.add('hidden');
};

async function loadGuruReports() {
    const container = document.getElementById('guru-sessions-container');
    container.innerHTML = '<p class="text-center" style="color:var(--text-muted); padding:10px;">Memuat riwayat sesi kuis...</p>';

    try {
        const resp = await authFetch(`/api/guru/reports?guruId=${currentUser.id}`);
        const res = await resp.json();

        if (res.success && res.sessions) {
            if (res.sessions.length === 0) {
                container.innerHTML = '<p class="text-center" style="color:var(--text-muted); padding:10px;">Belum ada sesi kuis yang selesai.</p>';
                return;
            }

            container.innerHTML = `
                <table class="data-table" style="width:100%; font-size:0.85rem;">
                    <thead>
                        <tr>
                            <th>Tanggal</th>
                            <th>PIN</th>
                            <th>Judul Kuis</th>
                            <th>Peserta</th>
                            <th>Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${res.sessions.map(s => `
                            <tr>
                                <td>${new Date(s.created_at).toLocaleDateString('id-ID')}</td>
                                <td><strong style="color:var(--gold);">${escapeHTML(s.pin)}</strong></td>
                                <td>${escapeHTML(s.title)}</td>
                                <td>👥 ${s.total_players} Siswa</td>
                                <td>
                                    <button onclick="viewGuruReportDetail('${s.id}')" class="btn btn-secondary btn-small" style="padding:2px 8px; font-size:0.75rem;">Lihat Nilai</button>
                                    <a href="/api/guru/reports/${s.id}/export-excel?token=${encodeURIComponent(getAuthToken())}" class="btn btn-primary btn-small" style="padding:2px 8px; font-size:0.75rem; text-decoration:none;">Excel</a>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (err) {
        container.innerHTML = `<p class="error-text">Gagal memuat: ${err.message}</p>`;
    }
}

async function viewGuruReportDetail(sessionId) {
    try {
        const resp = await authFetch(`/api/guru/reports/${sessionId}`);
        const res = await resp.json();

        if (!res.success || !res.session) {
            alert('Gagal mengambil detail nilai.');
            return;
        }

        const s = res.session;
        const detailView = document.getElementById('guru-report-detail-view');
        detailView.classList.remove('hidden');

        document.getElementById('guru-report-detail-title').innerText = `${s.title} (PIN: ${s.pin})`;
        document.getElementById('guru-report-detail-meta').innerHTML = `
            <strong>Tanggal:</strong> ${new Date(s.created_at).toLocaleString('id-ID')} | 
            <strong>Total Peserta:</strong> ${s.total_players} Siswa | 
            <strong>Total Soal:</strong> ${s.total_questions}
        `;

        document.getElementById('btn-guru-download-excel').href = `/api/guru/reports/${s.id}/export-excel?token=${encodeURIComponent(getAuthToken())}`;

        const tbody = document.getElementById('guru-report-detail-table');
        const records = s.studentRecords || [];

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Belum ada rekap siswa pada sesi ini.</td></tr>';
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

        detailView.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        alert('Gagal: ' + err.message);
    }
}
