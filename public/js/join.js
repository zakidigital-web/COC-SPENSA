const socket = io({ transports: ['polling', 'websocket'], reconnection: true });
const avatars = ['🦁', '🐉', '🦅', '🐺', '🦊', '🐼', '🦄', '🐯', '🦈', '🦉', '🐙', '🦋'];

// State variables declared at the very top to prevent TDZ issues
let currentStudentMode = 'anon';
let verifiedStudent = null;
let activeAvatarMode = 'sprite';
let selectedActiveRoomPin = '';
let currentSprite = (typeof SpriteGen !== 'undefined') ? SpriteGen.random() : { isSprite: false, emoji: '🦁' };
let selectedAvatar = (typeof SpriteGen !== 'undefined') ? SpriteGen.stringify(currentSprite) : '🦁';
let selectedEmoji = '🦁';

// DOM Element references
const btnShowJoin = document.getElementById('btn-show-join');
const btnAdmin = document.getElementById('btn-admin');
const joinSection = document.getElementById('join-section');
const actionButtons = document.getElementById('action-buttons');
const pinBoxes = document.querySelectorAll('.pin-box');
const nicknameInput = document.getElementById('nickname');
const avatarPicker = document.getElementById('avatar-picker');
const btnJoin = document.getElementById('btn-join');
const joinError = document.getElementById('join-error');
const loading = document.getElementById('loading');

// 1. Validation Logic
function validateForm() {
    if (btnJoin) {
        if (currentStudentMode === 'anon') {
            const pin = Array.from(pinBoxes).map(b => b.value).join('');
            const nick = nicknameInput ? nicknameInput.value.trim() : '';
            btnJoin.disabled = !(pin.length === 6 && nick.length > 0 && selectedAvatar);
        } else {
            // Registered student: NO PIN TYPING REQUIRED!
            // Just needs verified account, avatar, and an active room
            btnJoin.disabled = !(verifiedStudent && selectedAvatar && selectedActiveRoomPin);
        }
    }
}

// 2. Student Mode & Account Logic
function checkStoredStudent() {
    const stored = sessionStorage.getItem('coc_student_auth');
    if (stored) {
        try {
            verifiedStudent = JSON.parse(stored);
            setStudentModeUI('account');
        } catch (e) {}
    }
}

window.switchStudentMode = (mode) => {
    setStudentModeUI(mode);
};

function setStudentModeUI(mode) {
    currentStudentMode = mode;
    document.getElementById('tab-student-anon')?.classList.toggle('active', mode === 'anon');
    document.getElementById('tab-student-account')?.classList.toggle('active', mode === 'account');

    // Hide PIN input and nickname field for registered students
    document.getElementById('anon-fields-group')?.classList.toggle('hidden', mode === 'account');
    document.getElementById('account-login-group')?.classList.toggle('hidden', mode !== 'account');

    if (mode === 'account') {
        fetchActiveRooms();
        if (verifiedStudent) {
            document.getElementById('student-logged-box')?.classList.remove('hidden');
            document.getElementById('student-login-inputs')?.classList.add('hidden');
            const nameEl = document.getElementById('logged-student-name');
            if (nameEl) nameEl.innerText = verifiedStudent.name;
            const metaEl = document.getElementById('logged-student-meta');
            if (metaEl) metaEl.innerText = `NIS: ${verifiedStudent.nis} | Kelas: ${verifiedStudent.class || 'Umum'}`;
        } else {
            document.getElementById('student-logged-box')?.classList.add('hidden');
            document.getElementById('student-login-inputs')?.classList.remove('hidden');
        }
    }
    validateForm();
}

window.verifyStudentAccount = async () => {
    const nis = document.getElementById('student-nis-input').value.trim();
    const password = document.getElementById('student-pass-input').value;

    if (!nis || !password) {
        alert('Harap isi NIS dan Password siswa.');
        return;
    }

    try {
        const resp = await fetch('/api/student/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nis, password })
        });
        const res = await resp.json();

        if (res.success && res.student) {
            verifiedStudent = res.student;
            sessionStorage.setItem('coc_student_auth', JSON.stringify(verifiedStudent));
            setStudentModeUI('account');
            alert(`Selamat datang, ${verifiedStudent.name}! Kuis yang aktif telah dicari.`);
        } else {
            alert('Gagal: ' + (res.message || 'NIS atau password salah'));
        }
    } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
    }
};

window.logoutStudent = () => {
    verifiedStudent = null;
    sessionStorage.removeItem('coc_student_auth');
    setStudentModeUI('account');
};

// 3. Active Room Auto-Detection for Registered Students (No PIN Needed)
window.checkActiveRooms = async () => {
    await fetchActiveRooms();
};

async function fetchActiveRooms() {
    const box = document.getElementById('student-active-room-box');
    if (!box) return;

    box.innerHTML = `
        <div class="card" style="background:rgba(255,255,255,0.05); border:1px dashed rgba(255,255,255,0.2); padding:10px; text-align:center;">
            <span style="font-size:0.85rem; color:var(--text-muted);">Mencari kuis yang sedang aktif...</span>
        </div>
    `;

    try {
        const resp = await fetch('/api/active-rooms');
        const res = await resp.json();

        if (res.success && res.rooms) {
            if (res.rooms.length === 0) {
                selectedActiveRoomPin = '';
                box.innerHTML = `
                    <div class="card" style="background:rgba(255,152,0,0.08); border:1px solid rgba(255,152,0,0.3); padding:12px; text-align:center;">
                        <p style="font-size:0.9rem; color:var(--gold); margin-bottom:6px;">⏳ Belum ada kuis yang sedang dibuka oleh guru.</p>
                        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">Silakan minta guru membuka room kuis di kelas Anda.</p>
                        <button type="button" onclick="checkActiveRooms()" class="btn btn-secondary btn-small">🔄 Cek Ulang Kuis</button>
                    </div>
                `;
            } else if (res.rooms.length === 1) {
                const room = res.rooms[0];
                selectedActiveRoomPin = room.pin;
                box.innerHTML = `
                    <div class="card" style="background:rgba(255,215,0,0.12); border:1px solid var(--gold); padding:12px 14px;">
                        <div class="flex-between" style="margin-bottom:6px; flex-wrap:wrap; gap:6px;">
                            <span style="font-size:0.8rem; color:var(--gold); font-weight:bold; letter-spacing:0.5px;">⚔️ KUIS GURU TERDETEKSI:</span>
                            <div style="display:flex; gap:6px; align-items:center;">
                                <span class="badge" style="background:rgba(255,190,11,0.2); border:1px solid var(--gold); color:#ffbe0b; font-family:monospace; font-size:0.85rem; padding:2px 8px; border-radius:6px; font-weight:bold;">
                                    PIN: ${room.pin}
                                </span>
                                <span class="badge" style="background:${room.status === 'playing' ? '#f44336' : '#4caf50'}; color:white; font-size:0.75rem; padding:2px 8px; border-radius:10px;">
                                    ${room.status === 'playing' ? 'Sedang Main' : 'Lobby Terbuka'}
                                </span>
                            </div>
                        </div>
                        <strong style="font-size:1.1rem; color:white; display:block; margin-bottom:2px;">${room.title}</strong>
                        <div style="font-size:0.85rem; color:var(--text-muted);">
                            👨‍🏫 ${room.guruName} • 👥 ${room.playerCount} Siswa bergabung (Langsung Masuk)
                        </div>
                    </div>
                `;
            } else {
                // Multiple rooms active: let student pick with 1 click
                selectedActiveRoomPin = res.rooms[0].pin;
                box.innerHTML = `
                    <div style="margin-bottom:8px;">
                        <span style="font-size:0.85rem; font-weight:bold; color:var(--gold);">Pilih Kuis yang Sedang Dibuka Guru:</span>
                    </div>
                    ${res.rooms.map((r, idx) => `
                        <div class="card mb-2 flex-between room-select-card" 
                             data-pin="${r.pin}" 
                             onclick="selectRoom('${r.pin}', this)"
                             style="cursor:pointer; background:rgba(255,255,255,0.06); border:1px solid ${idx === 0 ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; padding:10px 12px; gap:8px;">
                            <div>
                                <strong style="font-size:0.95rem; color:white;">${r.title}</strong>
                                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
                                    👨‍🏫 ${r.guruName} • 👥 ${r.playerCount} siswa • <span style="font-family:monospace; color:#ffbe0b; font-weight:bold; background:rgba(255,190,11,0.15); padding:1px 6px; border-radius:4px;">PIN: ${r.pin}</span>
                                </div>
                            </div>
                            <span class="room-pick-label" style="font-size:0.85rem; color:var(--gold); font-weight:bold; white-space:nowrap;">${idx === 0 ? '✓ Dipilih' : 'Pilih'}</span>
                        </div>
                    `).join('')}
                `;
            }
        }
    } catch (e) {
        box.innerHTML = `
            <div class="card" style="background:rgba(244,67,54,0.1); border:1px solid #f44336; padding:10px; text-align:center;">
                <p style="font-size:0.85rem; color:#ef5350;">Gagal memuat kuis aktif: ${e.message}</p>
                <button type="button" onclick="checkActiveRooms()" class="btn btn-secondary btn-small mt-2">🔄 Coba Lagi</button>
            </div>
        `;
    }
    validateForm();
}

window.selectRoom = (pin, el) => {
    selectedActiveRoomPin = pin;
    document.querySelectorAll('.room-select-card').forEach(c => {
        c.style.borderColor = 'rgba(255,255,255,0.1)';
        const lbl = c.querySelector('.room-pick-label');
        if (lbl) lbl.innerText = 'Pilih';
    });
    if (el) {
        el.style.borderColor = 'var(--gold)';
        const lbl = el.querySelector('.room-pick-label');
        if (lbl) lbl.innerText = '✓ Dipilih';
    }
    validateForm();
};

// 4. Avatar & Sprite Builder Logic
function initSpriteBuilder() {
    if (typeof SpriteGen === 'undefined') return;

    const classGrid = document.getElementById('class-buttons-grid');
    const paletteGrid = document.getElementById('palette-buttons-grid');

    if (!classGrid || !paletteGrid) return;

    // 1. Populate Class buttons
    classGrid.innerHTML = Object.values(SpriteGen.CLASSES).map(cls => `
        <button type="button" class="btn-sprite-class ${cls.id === currentSprite.class ? 'active' : ''}" data-class="${cls.id}">
            <span style="font-size:1.2rem;">${cls.icon}</span>
            <span>${cls.name}</span>
        </button>
    `).join('');

    classGrid.querySelectorAll('.btn-sprite-class').forEach(btn => {
        btn.onclick = () => {
            if (window.sounds) window.sounds.playClick();
            classGrid.querySelectorAll('.btn-sprite-class').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSprite.class = btn.dataset.class;
            updateSpritePreview();
        };
    });

    // 2. Populate Palette chips
    paletteGrid.innerHTML = Object.values(SpriteGen.PALETTES).map(pal => `
        <button type="button" class="btn-sprite-palette ${pal.id === currentSprite.palette ? 'active' : ''}" 
                data-palette="${pal.id}" 
                title="${pal.name}" 
                style="background: ${pal.primary}; border-color: ${pal.secondary};">
        </button>
    `).join('');

    paletteGrid.querySelectorAll('.btn-sprite-palette').forEach(btn => {
        btn.onclick = () => {
            if (window.sounds) window.sounds.playClick();
            paletteGrid.querySelectorAll('.btn-sprite-palette').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSprite.palette = btn.dataset.palette;
            updateSpritePreview();
        };
    });

    // 3. Random Button
    document.getElementById('btn-random-sprite')?.addEventListener('click', () => {
        if (window.sounds) window.sounds.playClick();
        currentSprite = SpriteGen.random();
        
        classGrid.querySelectorAll('.btn-sprite-class').forEach(b => {
            b.classList.toggle('active', b.dataset.class === currentSprite.class);
        });

        paletteGrid.querySelectorAll('.btn-sprite-palette').forEach(b => {
            b.classList.toggle('active', b.dataset.palette === currentSprite.palette);
        });

        updateSpritePreview();
    });

    updateSpritePreview();
}

function updateSpritePreview() {
    if (typeof SpriteGen === 'undefined') return;

    selectedAvatar = SpriteGen.stringify(currentSprite);

    const canvasWrap = document.getElementById('sprite-preview-canvas-wrap');
    if (canvasWrap) {
        canvasWrap.innerHTML = '';
        const canvas = SpriteGen.createCanvas(currentSprite, { size: 96, animation: 'idle' });
        canvasWrap.appendChild(canvas);
    }

    const cls = SpriteGen.CLASSES[currentSprite.class] || SpriteGen.CLASSES.knight;
    const pal = SpriteGen.PALETTES[currentSprite.palette] || SpriteGen.PALETTES.gold;

    const nameEl = document.getElementById('sprite-class-name');
    if (nameEl) nameEl.innerText = `${cls.icon} ${cls.name}`;

    const palEl = document.getElementById('sprite-palette-name');
    if (palEl) palEl.innerText = `Tema: ${pal.name} • Senjata: ${cls.weapon}`;

    validateForm();
}

window.switchAvatarTab = (mode) => {
    activeAvatarMode = mode;
    document.querySelectorAll('.modal-tabs .modal-tab-btn').forEach(b => b.classList.remove('active'));
    
    if (mode === 'sprite') {
        document.getElementById('tab-avatar-sprite')?.classList.add('active');
        document.getElementById('sprite-builder-section')?.classList.remove('hidden');
        document.getElementById('emoji-picker-section')?.classList.add('hidden');
        selectedAvatar = SpriteGen.stringify(currentSprite);
    } else {
        document.getElementById('tab-avatar-emoji')?.classList.add('active');
        document.getElementById('sprite-builder-section')?.classList.add('hidden');
        document.getElementById('emoji-picker-section')?.classList.remove('hidden');
        selectedAvatar = selectedEmoji || '🦁';
    }
    validateForm();
};

// 5. Legacy Emoji Picker Setup
if (avatarPicker) {
    avatars.forEach(emoji => {
        const div = document.createElement('div');
        div.className = 'avatar-option';
        div.innerText = emoji;
        div.onclick = () => {
            if (window.sounds) window.sounds.playClick();
            document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            selectedEmoji = emoji;
            if (activeAvatarMode === 'emoji') {
                selectedAvatar = emoji;
            }
            validateForm();
        };
        avatarPicker.appendChild(div);
    });
}

// 6. Button Click Handlers
if (btnShowJoin) {
    btnShowJoin.onclick = () => {
        if (window.sounds) window.sounds.playClick();
        actionButtons?.classList.add('hidden');
        joinSection?.classList.remove('hidden');
        checkStoredStudent();
    };
}

if (btnAdmin) {
    btnAdmin.onclick = () => {
        if (window.sounds) window.sounds.playClick();
        window.location.href = 'login.html';
    };
}

// 7. PIN Inputs Navigation & Validation (for Anonymous guests)
pinBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
        box.value = box.value.toUpperCase();
        if (box.value && i < pinBoxes.length - 1) {
            pinBoxes[i + 1].focus();
        }
        validateForm();
    });
    box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) {
            pinBoxes[i - 1].focus();
        }
    });
    box.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        paste.split('').forEach((char, idx) => {
            if (idx < pinBoxes.length) pinBoxes[idx].value = char;
        });
        if (paste.length === 6) {
            nicknameInput ? nicknameInput.focus() : (pinBoxes[5] && pinBoxes[5].focus());
        }
        validateForm();
    });
});

document.getElementById('pin-container')?.addEventListener('paste', (e) => {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    paste.split('').forEach((char, i) => {
        if (i < pinBoxes.length) pinBoxes[i].value = char;
    });
    if (paste.length === 6) {
        nicknameInput ? nicknameInput.focus() : (pinBoxes[5] && pinBoxes[5].focus());
    }
    validateForm();
});

if (nicknameInput) {
    nicknameInput.addEventListener('input', validateForm);
    nicknameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && btnJoin && !btnJoin.disabled) {
            btnJoin.click();
        }
    });
}

// 8. Join Game Action
if (btnJoin) {
    btnJoin.onclick = () => {
        if (window.sounds) window.sounds.playClick();
        sessionStorage.removeItem('coc_playerId');
        
        let joinPayload = {
            avatar: selectedAvatar
        };

        if (currentStudentMode === 'account' && verifiedStudent) {
            // Registered student: uses auto-detected active room PIN without typing
            joinPayload.pin = selectedActiveRoomPin;
            joinPayload.studentId = verifiedStudent.id;
            joinPayload.studentIdentifier = verifiedStudent.nis;
            joinPayload.nickname = verifiedStudent.name;
            joinPayload.isAnonymous = false;
        } else {
            // Anonymous guest: uses manually typed 6-digit PIN
            const pin = Array.from(pinBoxes).map(b => b.value).join('').trim();
            joinPayload.pin = pin;
            joinPayload.nickname = nicknameInput ? nicknameInput.value.trim() : 'Pemain';
            joinPayload.isAnonymous = true;
        }
        
        joinSection?.classList.add('hidden');
        loading?.classList.remove('hidden');
        joinError?.classList.add('hidden');

        socket.emit('join-room', joinPayload);
    };
}

socket.on('join-success', (data) => {
    const pin = data.pin || ((currentStudentMode === 'account' && selectedActiveRoomPin)
        ? selectedActiveRoomPin
        : Array.from(pinBoxes).map(b => b.value).join('').trim());
        
    const nick = (currentStudentMode === 'account' && verifiedStudent) 
        ? verifiedStudent.name 
        : (nicknameInput ? nicknameInput.value.trim() : 'Pemain');

    sessionStorage.setItem('coc_pin', pin);
    sessionStorage.setItem('coc_playerId', data.playerId);
    sessionStorage.setItem('coc_nickname', nick);
    sessionStorage.setItem('coc_avatar', selectedAvatar);
    window.location.href = 'game.html';
});

socket.on('connect_error', (err) => {
    loading?.classList.add('hidden');
    joinSection?.classList.remove('hidden');
    if (joinError) {
        joinError.innerText = '⚠️ Koneksi server realtime terputus. Pastikan server WebSocket aktif.';
        joinError.classList.remove('hidden');
    }
});

socket.on('error', (err) => {
    loading?.classList.add('hidden');
    joinSection?.classList.remove('hidden');
    if (joinError) {
        joinError.innerText = err.message || 'Gagal masuk ke room';
        joinError.classList.remove('hidden');
    }
});

// 9. Student History Modal
window.openStudentHistoryModal = () => {
    document.getElementById('modal-student-history')?.classList.remove('hidden');
    if (verifiedStudent) {
        const nisInput = document.getElementById('check-history-nis');
        if (nisInput) nisInput.value = verifiedStudent.nis;
        fetchStudentHistory();
    }
};

window.closeStudentHistoryModal = () => {
    document.getElementById('modal-student-history')?.classList.add('hidden');
};

window.fetchStudentHistory = async () => {
    const nisInput = document.getElementById('check-history-nis');
    const nis = nisInput ? nisInput.value.trim() : '';
    const resultBox = document.getElementById('student-history-result');
    if (!resultBox) return;

    if (!nis) {
        alert('Masukkan NIS terlebih dahulu.');
        return;
    }

    resultBox.innerHTML = '<p class="text-center" style="color:var(--text-muted);">Memeriksa riwayat kuis...</p>';

    try {
        const resp = await fetch(`/api/student/history/${nis}`);
        const res = await resp.json();

        if (res.success && res.records) {
            if (res.records.length === 0) {
                resultBox.innerHTML = '<p class="text-center" style="color:var(--text-muted); padding:10px;">Belum ada catatan kuis untuk NIS ini.</p>';
                return;
            }

            resultBox.innerHTML = `
                <table class="data-table" style="width:100%; font-size:0.85rem;">
                    <thead>
                        <tr>
                            <th>Kuis</th>
                            <th>Tanggal</th>
                            <th>Peringkat</th>
                            <th>Skor</th>
                            <th>Akurasi</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${res.records.map(r => `
                            <tr>
                                <td><strong>${r.game_title || 'Kuis'}</strong><br><small style="color:var(--text-muted);">${r.guru_name || 'Guru'}</small></td>
                                <td>${new Date(r.created_at).toLocaleDateString('id-ID')}</td>
                                <td style="color:var(--gold); font-weight:bold;">#${r.rank}</td>
                                <td>${r.score}</td>
                                <td>${r.accuracy}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (err) {
        resultBox.innerHTML = `<p class="error-text">Gagal: ${err.message}</p>`;
    }
};

// 10. Initial Execution (Safe order)
initSpriteBuilder();

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const pinParam = urlParams.get('pin');

    if (pinParam) {
        const cleanPin = pinParam.trim().toUpperCase().slice(0, 6);
        actionButtons?.classList.add('hidden');
        joinSection?.classList.remove('hidden');
        cleanPin.split('').forEach((char, idx) => {
            if (idx < pinBoxes.length) pinBoxes[idx].value = char;
        });
        if (cleanPin.length === 6 && nicknameInput) {
            nicknameInput.focus();
        }
        validateForm();
    } else if (urlParams.get('mode') === 'student') {
        actionButtons?.classList.add('hidden');
        joinSection?.classList.remove('hidden');
        checkStoredStudent();
        setStudentModeUI('account');
    }

    if (sessionStorage.getItem('coc_pin') && sessionStorage.getItem('coc_playerId')) {
        const pin = sessionStorage.getItem('coc_pin');
        if (confirm(`Sesi sebelumnya ditemukan untuk Room ${pin}. Ingin reconnect?`)) {
            window.location.href = 'game.html';
        }
    }
});

window.openLandingRulesModal = () => {
    const m = document.getElementById('modal-landing-rules');
    if (m) m.classList.remove('hidden');
};

window.closeLandingRulesModal = () => {
    const m = document.getElementById('modal-landing-rules');
    if (m) m.classList.add('hidden');
};
