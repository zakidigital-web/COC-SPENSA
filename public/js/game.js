function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const socket = io();
const pin = sessionStorage.getItem('coc_pin');
const playerId = sessionStorage.getItem('coc_playerId');
const nickname = sessionStorage.getItem('coc_nickname');
const avatar = sessionStorage.getItem('coc_avatar');

if (!pin || !playerId) {
    window.location.href = 'index.html';
}

socket.emit('reconnect-attempt', { pin, playerId });

document.getElementById('my-nickname').innerText = nickname;
const myAvatarEl = document.getElementById('my-avatar');
if (myAvatarEl) {
    if (typeof SpriteGen !== 'undefined' && SpriteGen.parse(avatar).isSprite) {
        myAvatarEl.innerHTML = '';
        myAvatarEl.appendChild(SpriteGen.createCanvas(avatar, { size: 36, animation: 'idle' }));
    } else {
        myAvatarEl.innerText = avatar || '🦁';
    }
}

const lobbyPinDisplay = document.getElementById('lobby-pin-display');
if (lobbyPinDisplay && pin) {
    lobbyPinDisplay.innerText = pin;
}
if (playerId && nickname) {
    renderLobbyPlayer({ id: playerId, nickname, avatar });
}

let boxesData = [];
let currentBoxIndex = -1;
let currentQData = null;
let currentHeroCanvas = null;
let showPointsInitially = false;
const playersAvatarMap = new Map();
let timerInt;
let matchState = { selectedLeft: null, pairs: [] };

const waitingRoom = document.getElementById('waiting-room');
const gameUi = document.getElementById('game-ui');
const boxGrid = document.getElementById('box-grid');
const qModal = document.getElementById('question-modal');
const qInteractiveArea = document.getElementById('q-interactive-area');
const pauseOverlay = document.getElementById('pause-overlay');
const toastContainer = document.getElementById('toast-container');
const btnSubmit = document.getElementById('btn-submit-answer');
const btnReset = document.getElementById('btn-reset-match');

socket.on('error', (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    showToast(msg, 'error');
    if (msg.includes('Room') || msg.includes('Player') || msg.includes('tidak ditemukan')) {
        setTimeout(() => {
            sessionStorage.removeItem('coc_pin');
            sessionStorage.removeItem('coc_playerId');
            window.location.href = 'index.html';
        }, 1800);
    }
});

// Liveness & Fallback Sync: Ensure student never stays stuck if broadcast is missed
let lobbySyncInterval = setInterval(() => {
    if (waitingRoom && (waitingRoom.style.display === 'none' || waitingRoom.classList.contains('hidden'))) {
        clearInterval(lobbySyncInterval);
        return;
    }
    if (socket && pin && playerId) {
        socket.emit('check-room-status', { pin, playerId });
    }
}, 2000);

socket.on('room-status-response', (res) => {
    if (!res || !res.exists) {
        showToast('Room kuis tidak ditemukan atau telah berakhir.', 'error');
        setTimeout(() => {
            sessionStorage.removeItem('coc_pin');
            sessionStorage.removeItem('coc_playerId');
            window.location.href = 'index.html';
        }, 1500);
        return;
    }

    if (res.status === 'playing') {
        if (waitingRoom) {
            waitingRoom.classList.add('hidden');
            waitingRoom.style.display = 'none';
        }
        if (gameUi) {
            gameUi.classList.remove('hidden');
            gameUi.style.display = '';
        }
        if (res.boxes && Array.isArray(res.boxes) && res.boxes.length > 0) {
            boxesData = res.boxes;
            try {
                renderGrid();
                updateProgress();
            } catch (e) {
                console.error('Error rendering grid on status check:', e);
            }
        }
        if (res.globalEndTime) {
            try {
                syncStudentGlobalTimer(res.globalEndTime, res.globalTimeLimit);
            } catch (e) {}
        }
        clearInterval(lobbySyncInterval);
    }
});

socket.on('kicked', (data) => {
    alert(data.message || 'Anda telah dikeluarkan dari permainan oleh Guru.');
    sessionStorage.removeItem('coc_pin');
    sessionStorage.removeItem('coc_playerId');
    window.location.href = 'index.html';
});

socket.on('join-success', (data) => {
    if (data.roomState) {
        if (data.roomState.players && Array.isArray(data.roomState.players)) {
            data.roomState.players.forEach(renderLobbyPlayer);
        }
        if (data.roomState.status === 'playing') {
            if (waitingRoom) {
                waitingRoom.classList.add('hidden');
                waitingRoom.style.display = 'none';
            }
            if (gameUi) {
                gameUi.classList.remove('hidden');
                gameUi.style.display = '';
            }
            if (data.roomState.config && data.roomState.config.showPointsInitially !== undefined) {
                showPointsInitially = Boolean(data.roomState.config.showPointsInitially);
            }
            if (data.roomState.boxes && Array.isArray(data.roomState.boxes) && data.roomState.boxes.length > 0) {
                boxesData = data.roomState.boxes;
                try {
                    renderGrid();
                    updateProgress();
                } catch (e) {
                    console.error('Error rendering grid on join-success:', e);
                }
            }
            if (data.roomState.globalEndTime) {
                try {
                    syncStudentGlobalTimer(data.roomState.globalEndTime, data.roomState.config?.globalTimeLimit);
                } catch (e) {
                    console.warn('Global timer sync error:', e);
                }
            }
        }
    }
});

socket.on('config-updated', (data) => {
    if (data && data.config && data.config.showPointsInitially !== undefined) {
        showPointsInitially = Boolean(data.config.showPointsInitially);
        renderGrid();
    }
});

socket.on('game-started', (data) => {
    if (typeof lobbySyncInterval !== 'undefined') clearInterval(lobbySyncInterval);
    // 1. Unconditionally transition out of waiting room first
    if (waitingRoom) {
        waitingRoom.classList.add('hidden');
        waitingRoom.style.display = 'none';
    }
    if (gameUi) {
        gameUi.classList.remove('hidden');
        gameUi.style.display = '';
    }

    if (data && data.config && data.config.showPointsInitially !== undefined) {
        showPointsInitially = Boolean(data.config.showPointsInitially);
    }

    // 2. Safely render questions grid
    try {
        boxesData = (data && Array.isArray(data.boxes)) ? data.boxes : [];
        renderGrid();
        updateProgress();
    } catch (e) {
        console.error('Error rendering game grid on game-started:', e);
    }

    // 3. Audio & 3D animations wrapped safely so sound or WebGL issues never halt gameplay
    try {
        if (window.sounds && typeof window.sounds.playGameStart === 'function') {
            window.sounds.playGameStart();
        }
    } catch (e) {
        console.warn('Audio playGameStart error:', e);
    }

    try {
        if (window.game3D && typeof window.game3D.triggerGameStart === 'function') {
            window.game3D.triggerGameStart();
        }
    } catch (e) {
        console.warn('Three.js triggerGameStart error:', e);
    }

    // 4. Timer synchronization
    try {
        if (data && data.globalEndTime) {
            syncStudentGlobalTimer(data.globalEndTime, data.globalTimeLimit || (data.config && data.config.globalTimeLimit));
        }
    } catch (e) {
        console.warn('Timer sync error on game-started:', e);
    }
});

function renderGrid() {
    boxGrid.innerHTML = boxesData.map((b, i) => {
        const isMystery = b.points === '?' || b.isMystery || b.mystery;
        const mysteryClass = isMystery ? 'mystery' : '';
        const isCompleted = b.status === 'completed';
        const isLocked = b.status === 'locked';

        let subPointsHtml = '';
        if (showPointsInitially) {
            const displayPts = isMystery ? '🎁 ?' : `${b.points} Poin`;
            subPointsHtml = `<div class="box-points-sub">⭐ ${displayPts}</div>`;
        } else if (isCompleted) {
            const earned = b.answeredCorrectly ? `+${b.points || 0}` : '0';
            subPointsHtml = `<div class="box-points-sub ${b.answeredCorrectly ? 'completed-pts' : 'completed-wrong-pts'}">${earned} Poin</div>`;
        }

        let statusClass = 'available';
        let statusText = 'Tersedia';
        if (isLocked) {
            if (b.lockedBy === playerId) {
                statusClass = 'locked-me';
                statusText = 'Sedang Mengerjakan';
            } else {
                statusClass = 'locked-other';
                statusText = b.lockedByName || 'Dikerjakan';
            }
        } else if (isCompleted) {
            statusClass = b.answeredCorrectly ? 'completed-correct' : 'completed-wrong';
            statusText = b.answeredCorrectly ? '✓' : '✗';
        }

        return `
        <div class="game-box ${statusClass} ${mysteryClass}" id="box-${b.index}" onclick="claimBox(${b.index})">
            <div class="box-main-number">${b.index + 1}</div>
            ${subPointsHtml}
            <div class="box-status">${escapeHTML(statusText)}</div>
        </div>
        `;
    }).join('');
}

window.claimBox = (index) => {
    const box = document.getElementById(`box-${index}`);
    if (box.classList.contains('available')) {
        if(window.sounds) window.sounds.playClick();
        socket.emit('claim-box', { pin, boxIndex: index });
    }
};

socket.on('box-claimed', (data) => {
    if(window.game3D) window.game3D.triggerClaim(data.boxIndex, data.playerId === playerId);
    const box = document.getElementById(`box-${data.boxIndex}`);
    if (!box) return;

    // Clean up previous sprite
    const oldSpr = box.querySelector('.box-sprite-holder');
    if (oldSpr) oldSpr.remove();

    if (data.playerId === playerId) {
        if(window.sounds) window.sounds.playClaim();
        box.className = 'game-box locked-me';
        box.querySelector('.box-status').innerText = 'Sedang Mengerjakan';
        currentBoxIndex = data.boxIndex;

        // Render my attacking sprite on the box!
        if (typeof SpriteGen !== 'undefined' && SpriteGen.parse(avatar).isSprite) {
            const sprHolder = document.createElement('div');
            sprHolder.className = 'box-sprite-holder';
            const sprCanvas = SpriteGen.createCanvas(avatar, { size: 32, animation: 'attack' });
            sprHolder.appendChild(sprCanvas);
            box.appendChild(sprHolder);
        }
    } else {
        box.className = 'game-box locked-other';
        box.querySelector('.box-status').innerHTML = `🔒<br>${escapeHTML(data.playerName)}`;

        // Render player's guarding sprite if available
        const oppAvatar = playersAvatarMap.get(data.playerId);
        if (typeof SpriteGen !== 'undefined' && oppAvatar && SpriteGen.parse(oppAvatar).isSprite) {
            const sprHolder = document.createElement('div');
            sprHolder.className = 'box-sprite-holder';
            const sprCanvas = SpriteGen.createCanvas(oppAvatar, { size: 28, animation: 'idle' });
            sprHolder.appendChild(sprCanvas);
            box.appendChild(sprHolder);
        }
    }
});

socket.on('box-released', (data) => {
    const box = document.getElementById(`box-${data.boxIndex}`);
    if (!box) return;
    const oldSpr = box.querySelector('.box-sprite-holder');
    if (oldSpr) oldSpr.remove();
    const boxObj = boxesData && boxesData[data.boxIndex];
    const isMystery = boxObj && (boxObj.points === '?' || boxObj.isMystery || boxObj.mystery);
    box.className = `game-box available ${isMystery ? 'mystery' : ''}`;
    box.querySelector('.box-status').innerText = 'Tersedia';
});

socket.on('box-already-taken', () => showToast('Kotak sudah diambil!', 'error'));

socket.on('question-data', (data) => {
    currentQData = data.question;
    // Reveal points and box number for player answering
    const boxBadge = document.getElementById('q-box-badge');
    if (boxBadge) {
        boxBadge.innerText = `Kotak #${(currentBoxIndex !== null && currentBoxIndex !== undefined && currentBoxIndex >= 0 ? currentBoxIndex : 0) + 1}`;
    }
    const revealedPts = data.points || boxesData[currentBoxIndex]?.points || 100;
    if (boxesData[currentBoxIndex]) {
        boxesData[currentBoxIndex].points = revealedPts;
    }
    const pointsText = data.isMystery ? `🎁 ${revealedPts} Poin (Misteri!)` : `${revealedPts} Poin`;
    document.getElementById('q-modal-points').innerText = pointsText;
    
    // Render Hero Champion Sprite inside question modal
    const heroContainer = document.getElementById('q-sprite-hero-container');
    if (heroContainer) {
        heroContainer.innerHTML = '';
        if (typeof SpriteGen !== 'undefined' && SpriteGen.parse(avatar).isSprite) {
            currentHeroCanvas = SpriteGen.createCanvas(avatar, { size: 64, animation: 'idle', className: 'q-sprite-hero-canvas' });
            heroContainer.appendChild(currentHeroCanvas);
        }
    }

    qInteractiveArea.innerHTML = '';
    btnSubmit.parentElement.classList.add('hidden');
    btnReset.classList.add('hidden');
    document.getElementById('lines-layer').innerHTML = '';
    btnSubmit.onclick = null;

    const qType = (currentQData.type || '').toLowerCase();
    const isMc = qType === 'mc' || qType === 'multiple_choice' || qType === 'pg';
    const isTf = qType === 'tf' || qType === 'true_false';
    const isMatch = qType === 'match' || qType === 'matching';
    const isShort = qType === 'short' || qType === 'short_answer' || qType === 'isian';

    if (isMc) {
        btnSubmit.parentElement.classList.remove('hidden');
        const options = Array.isArray(currentQData.options) ? currentQData.options : [];
        qInteractiveArea.innerHTML = `<div class="q-mc-grid">
            ${options.map((opt, i) => `<button class="btn btn-mc-option" onclick="selectMC(${i})">${['A','B','C','D'][i] || (i+1)}. ${escapeHTML(opt)}</button>`).join('')}
        </div>`;
        
        let selected = -1;
        window.selectMC = (idx) => {
            if(window.sounds) window.sounds.playClick();
            selected = idx;
            document.querySelectorAll('.btn-mc-option').forEach((el, i) => {
                el.classList.toggle('selected', i === idx);
            });
        };
        btnSubmit.onclick = () => submitAnswer(selected);
        
    } else if (isTf) {
        qInteractiveArea.innerHTML = `<div class="q-tf-grid">
            <button class="btn btn-primary btn-tf-option" onclick="submitAnswer(true)">BENAR ✓</button>
            <button class="btn btn-danger btn-tf-option" onclick="submitAnswer(false)">SALAH ✗</button>
        </div>`;
    } else if (isMatch) {
        btnSubmit.parentElement.classList.remove('hidden');
        btnReset.classList.remove('hidden');
        
        const rawLefts = currentQData.lefts || currentQData.leftItems || [];
        const rawRights = currentQData.rights || currentQData.rightItems || [];
        const lefts = [...rawLefts].map((v, i) => ({val:v, idx:i})).sort(()=>Math.random()-0.5);
        const rights = [...rawRights].map((v, i) => ({val:v, idx:i})).sort(()=>Math.random()-0.5);
        
        qInteractiveArea.innerHTML = `<div class="q-match-container">
            <div class="match-col" id="m-col-left">
                ${lefts.map(l => `<div class="match-item m-left-item" data-idx="${l.idx}">${escapeHTML(l.val)}</div>`).join('')}
            </div>
            <div class="match-col" id="m-col-right">
                ${rights.map(r => `<div class="match-item m-right-item" data-idx="${r.idx}">${escapeHTML(r.val)}</div>`).join('')}
            </div>
        </div>`;
        
        matchState = { selectedLeft: null, pairs: [] };
        
        document.querySelectorAll('.m-left-item').forEach(el => {
            el.onclick = () => {
                if(el.classList.contains('paired')) return;
                if(window.sounds) window.sounds.playClick();
                document.querySelectorAll('.m-left-item').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                matchState.selectedLeft = el;
            };
        });
        
        document.querySelectorAll('.m-right-item').forEach(el => {
            el.onclick = () => {
                if(el.classList.contains('paired')) return;
                if(matchState.selectedLeft) {
                    if(window.sounds) window.sounds.playClick();
                    el.classList.add('paired');
                    matchState.selectedLeft.classList.remove('selected');
                    matchState.selectedLeft.classList.add('paired');
                    
                    matchState.pairs.push({
                        leftIdx: parseInt(matchState.selectedLeft.dataset.idx),
                        rightIdx: parseInt(el.dataset.idx),
                        leftEl: matchState.selectedLeft,
                        rightEl: el
                    });
                    
                    drawLines();
                    matchState.selectedLeft = null;
                }
            };
        });
        
        btnReset.onclick = () => {
            if(window.sounds) window.sounds.playClick();
            document.querySelectorAll('.match-item').forEach(el => el.classList.remove('paired', 'selected'));
            document.getElementById('lines-layer').innerHTML = '';
            matchState = { selectedLeft: null, pairs: [] };
        };
        
        btnSubmit.onclick = () => {
            const answer = matchState.pairs.map(p => ({leftIdx: p.leftIdx, rightIdx: p.rightIdx}));
            submitAnswer(answer);
        };
    } else if (isShort) {
        btnSubmit.parentElement.classList.remove('hidden');
        qInteractiveArea.innerHTML = `<input type="text" id="short-answer-input" class="input-text" style="font-size:1.5rem; text-align:center" placeholder="Ketik jawabanmu...">`;
        btnSubmit.onclick = () => submitAnswer(document.getElementById('short-answer-input').value.trim());
    }
    
    qModal.classList.remove('hidden');
    startTimer(data.timeLimit);
});

function drawLines() {
    const svg = document.getElementById('lines-layer');
    svg.innerHTML = '';
    
    matchState.pairs.forEach((p, i) => {
        const rect1 = p.leftEl.getBoundingClientRect();
        const rect2 = p.rightEl.getBoundingClientRect();
        
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', rect1.right);
        line.setAttribute('y1', rect1.top + rect1.height/2);
        line.setAttribute('x2', rect2.left);
        line.setAttribute('y2', rect2.top + rect2.height/2);
        line.setAttribute('stroke', `hsl(${(i*50)%360}, 70%, 50%)`);
        line.setAttribute('stroke-width', '4');
        svg.appendChild(line);
    });
}

window.addEventListener('resize', () => {
    if(!qModal.classList.contains('hidden') && currentQData && currentQData.type === 'match') drawLines();
});

function startTimer(seconds) {
    let timeLeft = seconds;
    const txt = document.getElementById('timer-text');
    const path = document.getElementById('timer-path');
    
    txt.innerText = timeLeft;
    path.style.strokeDasharray = '100, 100';
    path.style.stroke = 'var(--green)';
    
    clearInterval(timerInt);
    timerInt = setInterval(() => {
        timeLeft--;
        txt.innerText = timeLeft;
        const pct = (timeLeft / seconds) * 100;
        path.style.strokeDasharray = `${pct}, 100`;
        
        if (timeLeft <= 5) {
            if (window.sounds) window.sounds.playTick();
            if (currentHeroCanvas && currentHeroCanvas.setAnimation) {
                currentHeroCanvas.setAnimation('hurt'); // Nervous sweating/shaking
            }
        }
        
        if (pct < 25) path.style.stroke = 'var(--red)';
        else if (pct < 50) path.style.stroke = 'var(--gold)';
        
        if (timeLeft <= 0) {
            clearInterval(timerInt);
            submitAnswer(null);
        }
    }, 1000);
}

function submitAnswer(ans) {
    clearInterval(timerInt);
    socket.emit('submit-answer', { pin, boxIndex: currentBoxIndex, answer: ans });
    qModal.classList.add('hidden');
    document.getElementById('lines-layer').innerHTML = '';
}

socket.on('answer-result', (res) => {
    if (res.correct) {
        if(window.sounds) window.sounds.playCorrect();
        if(window.game3D) window.game3D.triggerCorrect(res.totalPoints);
        showToast(`+${res.totalPoints} Benar!`, 'success');
        if (currentHeroCanvas && currentHeroCanvas.setAnimation) {
            currentHeroCanvas.setAnimation(res.streak >= 3 ? 'combo' : 'victory');
        }
        if (res.streak >= 3) {
            if(window.sounds) window.sounds.playCombo();
            if(window.game3D) window.game3D.triggerCombo(res.streak);
            showToast(`🔥🔥 COMBO x${res.streak}!`, 'info');
        }
    } else {
        if(window.sounds) window.sounds.playWrong();
        if(window.game3D) window.game3D.triggerWrong();
        showToast('Jawaban Salah!', 'error');
        if (currentHeroCanvas && currentHeroCanvas.setAnimation) {
            currentHeroCanvas.setAnimation('hurt');
        }
    }
});

socket.on('box-completed', (data) => {
    if(window.game3D) window.game3D.triggerBoxCompleted(data.boxIndex, data.correct);
    if (boxesData && boxesData[data.boxIndex]) {
        boxesData[data.boxIndex].status = 'completed';
        boxesData[data.boxIndex].answeredCorrectly = data.correct;
        if (data.points !== undefined && data.points !== null) {
            boxesData[data.boxIndex].points = data.points;
        }
    }
    const box = document.getElementById(`box-${data.boxIndex}`);
    if (box) {
        const oldSpr = box.querySelector('.box-sprite-holder');
        if (oldSpr) oldSpr.remove();
        box.className = `game-box completed-${data.correct ? 'correct' : 'wrong'}`;
        box.querySelector('.box-status').innerText = data.correct ? '✓' : '✗';
        if (data.points !== undefined && data.points !== null) {
            let ptsEl = box.querySelector('.box-points-sub') || box.querySelector('.box-points');
            const ptsText = (data.correct ? `+${data.points}` : '0') + ' Poin';
            if (!ptsEl) {
                ptsEl = document.createElement('div');
                ptsEl.className = `box-points-sub ${data.correct ? 'completed-pts' : 'completed-wrong-pts'}`;
                box.insertBefore(ptsEl, box.querySelector('.box-status'));
            } else {
                ptsEl.className = `box-points-sub ${data.correct ? 'completed-pts' : 'completed-wrong-pts'}`;
            }
            ptsEl.innerText = ptsText;
        }
    }
    updateProgress();
});

function updateProgress() {
    const total = document.querySelectorAll('.game-box').length;
    const completed = document.querySelectorAll('.completed-correct, .completed-wrong').length;
    document.getElementById('progress-text').innerText = `${completed} / ${total}`;
    document.getElementById('progress-fill').style.width = `${(completed/total)*100}%`;
}

socket.on('leaderboard-update', (data) => {
    const lb = document.getElementById('game-leaderboard');
    if (!lb) return;

    data.leaderboard.forEach(p => {
        if (p.playerId) playersAvatarMap.set(p.playerId, p.avatar);
    });

    lb.innerHTML = data.leaderboard.map(p => {
        if (p.playerId === playerId) {
            document.getElementById('my-score').innerText = p.score;
        }

        const isCombo = p.streak >= 3;
        const avatarHtml = (typeof SpriteGen !== 'undefined')
            ? SpriteGen.renderAvatarHtml(p.avatar, { size: 30, animation: isCombo ? 'combo' : 'idle' })
            : `<span class="avatar-small">${p.avatar}</span>`;

        return `
        <div class="lb-item ${p.playerId === playerId ? 'is-me' : ''} ${isCombo ? 'fire-aura-wrap' : ''}">
            <span class="lb-rank">${p.rank === 1 ? '👑' : '#' + p.rank}</span>
            ${avatarHtml}
            <span style="margin-left:4px; font-weight:bold;">${escapeHTML(p.nickname)}</span>
            <span class="lb-score">${p.score}</span>
            ${isCombo ? `<span class="lb-streak">🔥x${p.streak}</span>` : ''}
        </div>
    `}).join('');

    if (typeof SpriteGen !== 'undefined') {
        SpriteGen.hydrate(lb);
    }
});

// Lobby Player List Handlers
function renderLobbyPlayer(p) {
    if (!p || !p.id) return;
    playersAvatarMap.set(p.id, p.avatar);

    const waitingList = document.getElementById('waiting-players');
    if (!waitingList) return;

    let badge = waitingList.querySelector(`[data-id="${p.id}"]`);
    const isMe = p.id === playerId;

    if (!badge) {
        badge = document.createElement('div');
        badge.className = `player-badge bounce ${isMe ? 'player-badge-me' : ''}`;
        badge.setAttribute('data-id', p.id);
        waitingList.appendChild(badge);
    }

    const avatarHtml = (typeof SpriteGen !== 'undefined')
        ? SpriteGen.renderAvatarHtml(p.avatar, { size: 36, animation: 'idle' })
        : `<span class="avatar-small">${p.avatar || '🦁'}</span>`;

    badge.innerHTML = `
        ${avatarHtml}
        <div style="display:flex; flex-direction:column; align-items:flex-start; line-height:1.2;">
            <span style="font-weight:bold; color:${isMe ? '#ffbe0b' : 'white'};">${escapeHTML(p.nickname)} ${isMe ? '<small style="color:#a7f3d0; font-size:0.75rem;">(Kamu)</small>' : ''}</span>
            ${p.studentIdentifier ? `<small style="font-size:0.7rem; color:rgba(255,255,255,0.6);">${escapeHTML(p.studentIdentifier)}</small>` : ''}
        </div>
    `;

    if (typeof SpriteGen !== 'undefined') SpriteGen.hydrate(badge);
    updateLobbyCount();
}

function removeLobbyPlayer(targetPlayerId) {
    const waitingList = document.getElementById('waiting-players');
    if (!waitingList) return;
    const badge = waitingList.querySelector(`[data-id="${targetPlayerId}"]`);
    if (badge) {
        badge.remove();
        updateLobbyCount();
    }
}

function updateLobbyCount() {
    const waitingList = document.getElementById('waiting-players');
    const countEl = document.getElementById('lobby-player-count');
    if (waitingList && countEl) {
        const count = waitingList.querySelectorAll('.player-badge').length;
        countEl.innerText = count;
    }
}

// Synchronized Match Countdown Timer
let matchTimerInterval = null;
let matchTargetEndTime = null;

function syncStudentGlobalTimer(endTime, limitSec) {
    if (matchTimerInterval) clearInterval(matchTimerInterval);

    const timerBadge = document.getElementById('header-match-timer');
    const timerVal = document.getElementById('match-timer-val');

    if (!endTime || !limitSec || limitSec <= 0) {
        if (timerBadge) timerBadge.classList.add('hidden');
        return;
    }

    matchTargetEndTime = endTime;
    if (timerBadge) timerBadge.classList.remove('hidden');

    const updateTimer = () => {
        const remainingMs = Math.max(0, matchTargetEndTime - Date.now());
        const totalSec = Math.ceil(remainingMs / 1000);
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');

        if (timerVal) timerVal.innerText = `${m}:${s}`;

        if (timerBadge) {
            if (totalSec <= 10) {
                timerBadge.classList.add('urgent');
            } else {
                timerBadge.classList.remove('urgent');
            }
        }

        if (remainingMs <= 0) {
            clearInterval(matchTimerInterval);
        }
    };

    updateTimer();
    matchTimerInterval = setInterval(updateTimer, 500);
}

socket.on('player-joined', (data) => {
    if (data.players && Array.isArray(data.players)) {
        data.players.forEach(renderLobbyPlayer);
    } else if (data.player) {
        renderLobbyPlayer(data.player);
    }
    if (data.playerCount) {
        const countEl = document.getElementById('lobby-player-count');
        if (countEl) countEl.innerText = data.playerCount;
    }
    updateLobbyCount();
});

socket.on('player-reconnected', (data) => {
    if (data.players && Array.isArray(data.players)) {
        data.players.forEach(renderLobbyPlayer);
    } else if (data.player) {
        renderLobbyPlayer(data.player);
    } else if (data.playerId && data.nickname) {
        renderLobbyPlayer({
            id: data.playerId,
            nickname: data.nickname,
            avatar: data.avatar,
            studentIdentifier: data.studentIdentifier
        });
    }
    if (data.playerCount) {
        const countEl = document.getElementById('lobby-player-count');
        if (countEl) countEl.innerText = data.playerCount;
    }
    updateLobbyCount();
});

socket.on('player-left', (data) => {
    if (data && data.playerId) removeLobbyPlayer(data.playerId);
});

socket.on('player-kicked', (data) => {
    if (data && data.playerId) removeLobbyPlayer(data.playerId);
});

socket.on('time-extended', (data) => {
    if (data.globalEndTime) {
        matchTargetEndTime = data.globalEndTime;
    }
    showToast(`⏱️ Waktu ditambah +${data.extraSeconds || 30} detik oleh Guru!`, 'info');
});

window.sendEmote = (em) => {
    socket.emit('send-emote', { pin, emote: em });
};
window.toggleMobileLeaderboard = () => {
    const sidebar = document.getElementById('leaderboard-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('mobile-open');
    }
};

socket.on('emote-received', (data) => {
    if (window.game3D) window.game3D.triggerEmote(data.emote);
    const c = document.getElementById('emotes-container');
    const el = document.createElement('div');
    el.className = 'floating-emote';
    el.style.left = `${Math.random() * 80 + 10}%`;

    const senderAvatar = data.avatar || playersAvatarMap.get(data.playerId);
    const avatarHtml = (typeof SpriteGen !== 'undefined' && senderAvatar)
        ? SpriteGen.renderAvatarHtml(senderAvatar, { size: 28, animation: 'victory' })
        : '';

    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px;">
            ${avatarHtml}
            <span style="font-size:2rem;">${escapeHTML(data.emote)}</span>
        </div>
        <span>${escapeHTML(data.nickname)}</span>
    `;
    c.appendChild(el);
    if (typeof SpriteGen !== 'undefined') SpriteGen.hydrate(el);
    setTimeout(() => el.remove(), 3000);
});

socket.on('game-paused', () => {
    pauseOverlay.classList.remove('hidden');
    if (matchTimerInterval) clearInterval(matchTimerInterval);
});

socket.on('game-resumed', (data) => {
    pauseOverlay.classList.add('hidden');
    if (data && data.globalEndTime) {
        matchTargetEndTime = data.globalEndTime;
        syncStudentGlobalTimer(data.globalEndTime, 1);
    }
});

socket.on('game-ended', (data) => {
    if(window.sounds) window.sounds.playGameEnd();
    sessionStorage.setItem('coc_results', JSON.stringify(data.results));
    window.location.href = 'results.html';
});

function showToast(msg, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

const muteBtn = document.getElementById('mute-btn');
if(muteBtn) {
    muteBtn.onclick = () => {
        if(window.sounds) {
            window.sounds.toggleMute();
            muteBtn.innerText = window.sounds.isMuted ? '🔇' : '🔊';
        }
    };
    if(window.sounds && window.sounds.isMuted) muteBtn.innerText = '🔇';
}

const toggleLb = document.getElementById('btn-toggle-lb');
if(toggleLb) {
    if(window.innerWidth <= 767) toggleLb.style.display = 'inline-block';
    toggleLb.onclick = () => {
        const sb = document.querySelector('.leaderboard-sidebar');
        sb.style.display = sb.style.display === 'none' ? 'block' : 'none';
    };
}

// Reconnect logic
socket.on('connect', () => {
    if (pin && playerId) {
        socket.emit('reconnect-attempt', { pin, playerId });
    }
});
socket.on('reconnect-success', (data) => {
    document.getElementById('reconnecting-overlay')?.classList.add('hidden');
    if (data.roomState) {
        if (data.roomState.players && Array.isArray(data.roomState.players)) {
            data.roomState.players.forEach(renderLobbyPlayer);
        }
        if (data.roomState.status === 'playing') {
            if (data.roomState.config && data.roomState.config.showPointsInitially !== undefined) {
                showPointsInitially = Boolean(data.roomState.config.showPointsInitially);
            }
            if (waitingRoom) {
                waitingRoom.classList.add('hidden');
                waitingRoom.style.display = 'none';
            }
            if (gameUi) {
                gameUi.classList.remove('hidden');
                gameUi.style.display = '';
            }
            if (data.roomState.boxes && Array.isArray(data.roomState.boxes) && data.roomState.boxes.length > 0) {
                boxesData = data.roomState.boxes;
                try {
                    renderGrid();
                    updateProgress();
                } catch (e) {
                    console.error('Error rendering grid on reconnect-success:', e);
                }
            }
            if (data.roomState.globalEndTime) {
                try {
                    syncStudentGlobalTimer(data.roomState.globalEndTime, data.roomState.config?.globalTimeLimit);
                } catch (e) {
                    console.warn('Global timer sync error on reconnect-success:', e);
                }
            }
        }
        if (data.roomState.playerStats) {
            document.getElementById('my-score').innerText = data.roomState.playerStats.score || 0;
        }
    }
});
socket.on('disconnect', () => {
    document.getElementById('reconnecting-overlay')?.classList.remove('hidden');
});

// (Primary emote handlers are above — duplicates removed)

// (Primary leaderboard-update handler is above — duplicate removed)

// Combo popup function
window.showCombo = (count) => {
    const popup = document.getElementById('combo-popup');
    if(popup) {
        document.getElementById('combo-count').innerText = count;
        popup.classList.remove('hidden');
        setTimeout(() => popup.classList.add('hidden'), 2000);
    }
};

window.showScoreFloat = (pts) => {
    const fl = document.getElementById('score-float');
    if(fl) {
        fl.innerText = `+${pts}`;
        fl.classList.remove('hidden');
        fl.style.left = '50%';
        fl.style.top = '10%';
        setTimeout(() => fl.classList.add('hidden'), 1500);
    }
};

window.toggleWaitingRules = () => {
    const content = document.getElementById('waiting-rules-content');
    const arrow = document.getElementById('waiting-rules-arrow');
    if (content) {
        content.classList.toggle('hidden');
        if (arrow) arrow.innerText = content.classList.contains('hidden') ? '▼' : '▲';
    }
};

window.openStudentRulesModal = () => {
    const m = document.getElementById('modal-student-rules');
    if (m) m.classList.remove('hidden');
};

window.closeStudentRulesModal = () => {
    const m = document.getElementById('modal-student-rules');
    if (m) m.classList.add('hidden');
};
