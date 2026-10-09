let audioCtx = null;

function getAudioContext() {
    if (!audioCtx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {}
    }
    return audioCtx;
}

let isMuted = false;
try {
    isMuted = localStorage.getItem('coc_muted') === 'true';
} catch(e) {}

function playTone(freq, type, duration, vol = 0.1) {
    if (isMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch(e) {
        // Silently ignore audio policy restrictions
    }
}

const sounds = {
    get isMuted() { return isMuted; },
    setMuted: (val) => { 
        isMuted = !!val; 
        try { localStorage.setItem('coc_muted', isMuted); } catch(e) {}
    },
    toggleMute: () => { 
        isMuted = !isMuted; 
        try { localStorage.setItem('coc_muted', isMuted); } catch(e) {}
    },
    playCorrect: () => {
        playTone(523.25, 'sine', 0.1); // C5
        setTimeout(() => playTone(659.25, 'sine', 0.1), 100); // E5
        setTimeout(() => playTone(783.99, 'sine', 0.2), 200); // G5
    },
    playWrong: () => {
        playTone(150, 'sawtooth', 0.3, 0.2);
        setTimeout(() => playTone(100, 'sawtooth', 0.3, 0.2), 150);
    },
    playCombo: () => {
        playTone(440, 'square', 0.1);
        setTimeout(() => playTone(554.37, 'square', 0.1), 100);
        setTimeout(() => playTone(659.25, 'square', 0.1), 200);
        setTimeout(() => playTone(880, 'square', 0.3), 300);
    },
    playClick: () => playTone(800, 'sine', 0.05, 0.05),
    playTick: () => playTone(1000, 'square', 0.05, 0.02),
    playClaim: () => {
        playTone(300, 'sine', 0.1);
        setTimeout(() => playTone(400, 'sine', 0.1), 50);
    },
    playGameStart: () => {
        playTone(440, 'triangle', 0.2, 0.1);
        setTimeout(() => playTone(659.25, 'triangle', 0.2, 0.1), 200);
        setTimeout(() => playTone(880, 'triangle', 0.4, 0.15), 400);
    },
    playGameEnd: () => {
        playTone(523.25, 'triangle', 0.2);
        setTimeout(() => playTone(659.25, 'triangle', 0.2), 200);
        setTimeout(() => playTone(783.99, 'triangle', 0.2), 400);
        setTimeout(() => playTone(1046.50, 'triangle', 0.6), 600);
    }
};

window.sounds = sounds;

document.addEventListener('click', () => {
    try {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
    } catch(e) {}
}, { once: true });
