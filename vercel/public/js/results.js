function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const rawData = sessionStorage.getItem('coc_results');
if (!rawData) window.location.href = 'index.html';

const results = JSON.parse(rawData);

document.addEventListener('click', () => {
    if(window.sounds) window.sounds.playGameEnd();
}, { once: true });

function createConfetti() {
    const c = document.getElementById('confetti-container');
    const colors = ['#ffd700', '#4caf50', '#f44336', '#9c27b0', '#303f9f'];
    for(let i=0; i<100; i++) {
        const el = document.createElement('div');
        el.className = 'confetti';
        el.style.left = `${Math.random() * 100}vw`;
        el.style.top = `-${Math.random() * 20}vh`;
        el.style.backgroundColor = colors[Math.floor(Math.random()*colors.length)];
        el.style.animationDuration = `${Math.random() * 3 + 2}s`;
        el.style.animationDelay = `${Math.random() * 2}s`;
        c.appendChild(el);
    }
}
createConfetti();

if (results.isSolo || (!results.podium || results.podium.length === 0)) {
    const soloBanner = document.getElementById('solo-results-banner');
    if (soloBanner) {
        soloBanner.classList.remove('hidden');
        const scoreEl = document.getElementById('solo-summary-score');
        const correctEl = document.getElementById('solo-summary-correct');
        const totalEl = document.getElementById('solo-summary-total');
        if (scoreEl) scoreEl.innerText = results.soloScore || 0;
        if (correctEl) correctEl.innerText = results.soloCorrectCount || 0;
        if (totalEl) totalEl.innerText = results.totalBoxes || 0;
    }
    const podSec = document.getElementById('podium-section');
    if (podSec) podSec.style.display = 'none';
}

const podium = results.podium || [];
[2, 1, 3].forEach((pos, idx) => {
    const pData = podium[idx];
    const el = document.getElementById(`podium-${pos}`);
    if (pData && el) {
        const avatarWrap = el.querySelector('.podium-avatar');
        if (avatarWrap) {
            avatarWrap.innerHTML = '';
            const size = (pos === 1) ? 96 : 80;
            if (typeof SpriteGen !== 'undefined' && SpriteGen.parse(pData.avatar).isSprite) {
                const canvas = SpriteGen.createCanvas(pData.avatar, { size, animation: 'victory' });
                avatarWrap.appendChild(canvas);
            } else {
                avatarWrap.innerText = pData.avatar || (pos === 1 ? '👑' : pos === 2 ? '🥈' : '🥉');
            }
        }
        el.querySelector('.podium-name').innerText = pData.nickname;
        animateValue(el.querySelector('.podium-score'), 0, pData.score, 2000);
    } else if (el) {
        el.style.opacity = '0.3';
    }
});

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function formatTitle(titleObj, formatVal) {
    if (!titleObj) return '-';
    if (typeof titleObj === 'string') return titleObj;
    if (titleObj.nickname) {
        if (formatVal) {
            const extra = formatVal(titleObj);
            return extra ? `${titleObj.nickname} (${extra})` : titleObj.nickname;
        }
        return titleObj.nickname;
    }
    return '-';
}

if (results.titles) {
    const t = results.titles;
    const highest = t.highest || (results.podium && results.podium[0]);
    document.getElementById('title-fastest').innerText = formatTitle(t.fastest, o => o.ms ? `${(o.ms/1000).toFixed(1)}s` : '');
    document.getElementById('title-highest').innerText = formatTitle(highest, o => o.score ? `${o.score} pts` : '');
    document.getElementById('title-boxes').innerText = formatTitle(t.mostBoxes || t.explorer, o => o.count ? `${o.count} kotak` : '');
    document.getElementById('title-accuracy').innerText = formatTitle(t.bestAccuracy || t.accurate, o => o.accuracy ? `${Math.round(o.accuracy > 1 ? o.accuracy : o.accuracy * 100)}%` : '');
}

const tbody = document.getElementById('ranking-body');
if(results.fullRanking) {
    tbody.innerHTML = results.fullRanking.map((p, i) => {
        const avatarHtml = (typeof SpriteGen !== 'undefined')
            ? SpriteGen.renderAvatarHtml(p.avatar, { size: 28, animation: 'idle' })
            : `<span class="avatar-small">${p.avatar}</span>`;
        return `
        <tr>
            <td><strong>#${i+1}</strong></td>
            <td><div style="display:flex;align-items:center;gap:6px;">${avatarHtml} <span>${escapeHTML(p.nickname)}</span></div></td>
            <td class="glow-gold">${p.score}</td>
            <td>${p.accuracy || 0}%</td>
            <td>🔥 ${p.maxStreak || 0}</td><td>${p.boxesTaken || 0}</td>
        </tr>
    `}).join('');
    if (typeof SpriteGen !== 'undefined') {
        SpriteGen.hydrate(tbody);
    }
}

document.getElementById('btn-home').onclick = () => {
    sessionStorage.clear();
    window.location.href = 'index.html';
};

// Retroactive Session Persistence (HITL Gate 4)
const userStr = sessionStorage.getItem('coc_user');
const currentUser = userStr ? JSON.parse(userStr) : null;
const adminPin = sessionStorage.getItem('coc_admin_pin') || sessionStorage.getItem('coc_pin');

if (!currentUser && adminPin) {
    const banner = document.getElementById('retroactive-save-banner');
    if (banner) banner.classList.remove('hidden');
}

window.openClaimModal = () => {
    const m = document.getElementById('modal-claim');
    if (m) m.classList.remove('hidden');
};

window.closeClaimModal = () => {
    const m = document.getElementById('modal-claim');
    if (m) m.classList.add('hidden');
};

window.submitClaimSession = async (e) => {
    e.preventDefault();
    const username = document.getElementById('claim-username').value.trim();
    const password = document.getElementById('claim-password').value;
    const errorEl = document.getElementById('claim-error');
    errorEl.classList.add('hidden');

    try {
        const resp = await fetch('/api/guru/claim-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: adminPin, username, password })
        });
        const data = await resp.json();
        if (!data.success) {
            errorEl.innerText = data.message || 'Gagal menyimpan sesi';
            errorEl.classList.remove('hidden');
            return;
        }

        closeClaimModal();
        const saveBanner = document.getElementById('retroactive-save-banner');
        if (saveBanner) saveBanner.classList.add('hidden');
        const successBanner = document.getElementById('saved-success-banner');
        if (successBanner) {
            successBanner.classList.remove('hidden');
            if (data.sessionId) {
                const btnDl = document.getElementById('btn-download-excel');
                if (btnDl) btnDl.href = `/api/guru/reports/${data.sessionId}/export-excel`;
            }
        }
        alert('🎉 ' + data.message);
    } catch (err) {
        errorEl.innerText = 'Koneksi gagal: ' + err.message;
        errorEl.classList.remove('hidden');
    }
};
