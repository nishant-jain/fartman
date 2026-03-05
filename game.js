// ============================================================
// FARTMAN - The Office Stealth Platformer
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

// ---- Constants ----
const GRAVITY = 0.6;
const MOVE_SPEED = 3;
const GAS_RATE = 0.25;
const FART_DRAIN = 10;
const FART_RADIUS = 180; // 1.5x scale
const NOISE_RADIUS = 120; // smaller distraction coverage
const S = 1.5; // sprite scale factor

// ---- Audio System (Web Audio API) ----
let audioCtx = null;
let bgNoiseNode = null;
let bgNoiseGain = null;
let activeNoiseSources = {}; // track playing distraction sounds

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    startBackgroundChatter();
}

let bgChatterNodes = []; // track all bg audio nodes for cleanup

function startBackgroundChatter() {
    bgChatterNodes = [];
    bgNoiseGain = audioCtx.createGain();
    bgNoiseGain.gain.value = 0.12;
    bgNoiseGain.connect(audioCtx.destination);

    // --- Layer 1: Voice-like murmur (multiple formant bands) ---
    const bufferSize = audioCtx.sampleRate * 4;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.04 * white) / 1.04;
        last = data[i];
        data[i] *= 3.0;
    }

    // Voice formant frequencies to simulate distant chatter
    const formants = [
        { freq: 300, Q: 2.0, gain: 0.35 },  // low murmur
        { freq: 600, Q: 2.5, gain: 0.25 },  // mid voice
        { freq: 1200, Q: 3.0, gain: 0.12 }, // higher voice
        { freq: 2500, Q: 2.0, gain: 0.06 }, // sibilance
    ];

    for (const f of formants) {
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;

        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f.freq;
        bp.Q.value = f.Q;

        // Slow volume modulation for conversation rhythm
        const modGain = audioCtx.createGain();
        modGain.gain.value = f.gain;

        const lfo = audioCtx.createOscillator();
        const lfoAmp = audioCtx.createGain();
        lfo.frequency.value = 0.15 + Math.random() * 0.4;
        lfoAmp.gain.value = f.gain * 0.5;
        lfo.connect(lfoAmp);
        lfoAmp.connect(modGain.gain);

        src.connect(bp);
        bp.connect(modGain);
        modGain.connect(bgNoiseGain);

        lfo.start();
        src.start();
        bgChatterNodes.push(src, lfo);
    }

    // --- Layer 2: Intermittent keyboard clicks (filtered impulses) ---
    const clickBufSize = audioCtx.sampleRate * 6;
    const clickBuf = audioCtx.createBuffer(1, clickBufSize, audioCtx.sampleRate);
    const clickData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickBufSize; i++) {
        // Sparse random clicks
        if (Math.random() < 0.003) {
            const vol = 0.2 + Math.random() * 0.4;
            clickData[i] = vol * (Math.random() > 0.5 ? 1 : -1);
            // Short decay
            for (let j = 1; j < 80 && i + j < clickBufSize; j++) {
                clickData[i + j] = clickData[i] * Math.exp(-j * 0.08) * (Math.random() * 0.5 + 0.5);
            }
        }
    }
    const clickSrc = audioCtx.createBufferSource();
    clickSrc.buffer = clickBuf;
    clickSrc.loop = true;
    const clickHp = audioCtx.createBiquadFilter();
    clickHp.type = "highpass";
    clickHp.frequency.value = 2000;
    const clickGain = audioCtx.createGain();
    clickGain.gain.value = 0.08;
    clickSrc.connect(clickHp);
    clickHp.connect(clickGain);
    clickGain.connect(bgNoiseGain);
    clickSrc.start();
    bgChatterNodes.push(clickSrc);

    // --- Layer 3: Subtle HVAC hum ---
    const hvac = audioCtx.createOscillator();
    hvac.type = "sawtooth";
    hvac.frequency.value = 60;
    const hvacFilter = audioCtx.createBiquadFilter();
    hvacFilter.type = "lowpass";
    hvacFilter.frequency.value = 120;
    hvacFilter.Q.value = 1;
    const hvacGain = audioCtx.createGain();
    hvacGain.gain.value = 0.015;
    hvac.connect(hvacFilter);
    hvacFilter.connect(hvacGain);
    hvacGain.connect(bgNoiseGain);
    hvac.start();
    bgChatterNodes.push(hvac);

    bgNoiseNode = bgChatterNodes[0]; // keep reference for stopBackgroundChatter
}

function stopBackgroundChatter() {
    for (const node of bgChatterNodes) {
        try { node.stop(); } catch (e) {}
    }
    bgChatterNodes = [];
    bgNoiseNode = null;
}

// Continuous quiet hiss + whistle for holding space
let leakSoundNode = null;
let leakSoundGain = null;
let whistleOsc = null;
let whistleLfo = null;

function startLeakSound() {
    if (!audioCtx || leakSoundNode) return;
    // Soft hissing
    const bufLen = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    leakSoundNode = audioCtx.createBufferSource();
    leakSoundNode.buffer = buf;
    leakSoundNode.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 250;
    filter.Q.value = 3;
    leakSoundGain = audioCtx.createGain();
    leakSoundGain.gain.value = 0.12;
    leakSoundNode.connect(filter);
    filter.connect(leakSoundGain);
    leakSoundGain.connect(audioCtx.destination);
    leakSoundNode.start();

    // Whistling fart tone - thin airy sine that wobbles in pitch
    whistleOsc = audioCtx.createOscillator();
    whistleOsc.type = "sine";
    whistleOsc.frequency.value = 1800;

    // LFO to wobble the pitch for a squeaky whistle effect
    whistleLfo = audioCtx.createOscillator();
    whistleLfo.frequency.value = 6;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 400;
    whistleLfo.connect(lfoGain);
    lfoGain.connect(whistleOsc.frequency);

    // Bandpass to keep it thin and airy
    const whistleFilter = audioCtx.createBiquadFilter();
    whistleFilter.type = "bandpass";
    whistleFilter.frequency.value = 1800;
    whistleFilter.Q.value = 5;

    const whistleGain = audioCtx.createGain();
    whistleGain.gain.value = 0.04;

    whistleOsc.connect(whistleFilter);
    whistleFilter.connect(whistleGain);
    whistleGain.connect(audioCtx.destination);

    whistleLfo.start();
    whistleOsc.start();
}

function stopLeakSound() {
    if (leakSoundNode) {
        try { leakSoundNode.stop(); } catch (e) {}
        leakSoundNode = null;
        leakSoundGain = null;
    }
    if (whistleOsc) {
        try { whistleOsc.stop(); } catch (e) {}
        try { whistleLfo.stop(); } catch (e) {}
        whistleOsc = null;
        whistleLfo = null;
    }
}

function playBlastFartSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    // BIG loud rumbling blast
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.8);

    filter.type = "lowpass";
    filter.frequency.value = 250;
    filter.Q.value = 8;

    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.9);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.9);

    // Big noise burst
    const bufLen = audioCtx.sampleRate * 0.8;
    const noiseBuf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.4));
    }
    const noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 400;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.35;
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noiseSrc.start();
    noiseSrc.stop(audioCtx.currentTime + 0.8);
}

function playPrinterSound(id, volume) {
    if (!audioCtx) return;
    if (activeNoiseSources[id]) {
        activeNoiseSources[id].gain.gain.value = volume * 0.12;
        return;
    }
    // Mechanical whirring and clicking
    const osc = audioCtx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 120;

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 8;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 500;
    filter.Q.value = 2;

    const gain = audioCtx.createGain();
    gain.gain.value = volume * 0.12;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    lfo.start();
    osc.start();
    activeNoiseSources[id] = { osc, lfo, gain, stop() { osc.stop(); lfo.stop(); } };
}

function playSneezeSound(id, volume) {
    if (!audioCtx) return;
    if (activeNoiseSources[id]) {
        activeNoiseSources[id].gain.gain.value = volume * 0.15;
        return;
    }
    // Sniffly, sneezy noise
    const bufLen = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
        // Periodic sneezes
        const t = i / audioCtx.sampleRate;
        const sneezeCycle = (t % 1.5);
        const env = sneezeCycle < 0.15 ? Math.sin(sneezeCycle / 0.15 * Math.PI) :
                    sneezeCycle < 0.5 ? Math.exp(-(sneezeCycle - 0.15) * 8) * 0.3 : 0;
        data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000;
    filter.Q.value = 1;

    const gain = audioCtx.createGain();
    gain.gain.value = volume * 0.15;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    src.start();
    activeNoiseSources[id] = { src, gain, stop() { src.stop(); } };
}

function playDrillSound(id, volume) {
    if (!audioCtx) return;
    if (activeNoiseSources[id]) {
        activeNoiseSources[id].gain.gain.value = volume * 0.08;
        return;
    }
    // Drilling / hammering noise
    const osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 200;

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 15;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 100;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 400;

    const gain = audioCtx.createGain();
    gain.gain.value = volume * 0.08;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    lfo.start();
    osc.start();
    activeNoiseSources[id] = { osc, lfo, gain, stop() { osc.stop(); lfo.stop(); } };
}

function updateDistrationSounds() {
    if (!audioCtx || state !== "playing") return;
    const hearDist = 500; // how far you can hear distractions

    for (let i = 0; i < noiseSources.length; i++) {
        const ns = noiseSources[i];
        const dist = Math.abs(fartman.x - ns.x);
        const vol = Math.max(0, 1 - dist / hearDist);
        const id = "ns_" + i;

        if (ns.disabled > 0) {
            // Disabled - stop its sound
            if (activeNoiseSources[id]) {
                try { activeNoiseSources[id].stop(); } catch (e) {}
                delete activeNoiseSources[id];
            }
            continue;
        }

        if (vol > 0.01) {
            if (ns.type === "printer") playPrinterSound(id, vol);
            else if (ns.type === "sneezer") playSneezeSound(id, vol);
            else if (ns.type === "drill") playDrillSound(id, vol);
        } else {
            // Stop if too far
            if (activeNoiseSources[id]) {
                try { activeNoiseSources[id].stop(); } catch (e) {}
                delete activeNoiseSources[id];
            }
        }
    }
}

function stopAllDistractionSounds() {
    for (const id in activeNoiseSources) {
        try { activeNoiseSources[id].stop(); } catch (e) {}
    }
    activeNoiseSources = {};
}

function playGameOverSound() {
    if (!audioCtx) return;
    // Sad trombone-ish
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    const gain = audioCtx.createGain();
    gain.gain.value = 0.2;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.setValueAtTime(280, t + 0.3);
    osc.frequency.setValueAtTime(260, t + 0.6);
    osc.frequency.exponentialRampToValueAtTime(100, t + 1.2);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0, t + 1.3);
    osc.start(t);
    osc.stop(t + 1.3);
}

function playWinSound() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const notes = [523, 659, 784, 1047]; // C E G C
    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        osc.type = "triangle";
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.15, t + i * 0.15);
        gain.gain.linearRampToValueAtTime(0, t + i * 0.15 + 0.4);
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t + i * 0.15);
        osc.stop(t + i * 0.15 + 0.4);
    });
}

// ---- Game State ----
let state = "start"; // start | playing | caught | gameover | win
let camera = { x: 0 };
let fartman, platforms, noiseSources, coworkers, particles, levelEnd;
let keys = {};
let fartCooldown = 0;
let blastTimer = 0; // visual timer for the big 100% blast
let shameTimer = 0; // timer for the caught shame animation
let caughtByCoworker = null; // which coworker caught fartman
let flickerLightIndex = 0; // which ceiling light flickers
let fallenLight = null; // { x, y, vy, fallen, flickerTimer }
let closeCalls = 0; // number of near-misses (heard but masked)
let popups = []; // { text, x, y, life, maxLife, color } floating feedback texts
let gameStartTime = 0; // for scoring
let lastScore = 0;
let speedEscalationTimer = 0; // ticks up, speeds coworkers every 30s

// ---- Input ----
window.addEventListener("keydown", e => {
    keys[e.code] = true;
    if (e.code === "Space") e.preventDefault();
    if (state === "start" && e.code === "Enter") { initAudio(); startGame(); }
    if (state === "gameover" && e.code === "Enter") { state = "start"; stopAllDistractionSounds(); stopLeakSound(); }
    if (state === "win" && e.code === "Enter") { state = "start"; stopAllDistractionSounds(); stopLeakSound(); }
});
window.addEventListener("keyup", e => { keys[e.code] = false; });

// ---- Mobile Touch Controls ----
let isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Virtual button regions (in canvas coordinates)
const BTN_SIZE = 100;
const BTN_PAD = 20;
const BTN_Y = H - BTN_SIZE - BTN_PAD;
const touchBtns = {
    left:  { x: BTN_PAD, y: BTN_Y, w: BTN_SIZE, h: BTN_SIZE, key: "ArrowLeft", label: "◀", active: false },
    right: { x: BTN_PAD + BTN_SIZE + 12, y: BTN_Y, w: BTN_SIZE, h: BTN_SIZE, key: "ArrowRight", label: "▶", active: false },
    fart:  { x: W - BTN_SIZE * 2 - BTN_PAD, y: BTN_Y, w: BTN_SIZE * 2, h: BTN_SIZE, key: "Space", label: "FART", active: false },
};

function canvasTouchPos(touch) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (touch.clientX - rect.left) * (W / rect.width),
        y: (touch.clientY - rect.top) * (H / rect.height)
    };
}

function hitTestBtn(pos) {
    for (const id in touchBtns) {
        const b = touchBtns[id];
        if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
            return id;
        }
    }
    return null;
}

function updateTouchButtons(touches) {
    // Reset all
    for (const id in touchBtns) {
        touchBtns[id].active = false;
        keys[touchBtns[id].key] = false;
    }
    // Activate touched ones
    for (let i = 0; i < touches.length; i++) {
        const pos = canvasTouchPos(touches[i]);
        const id = hitTestBtn(pos);
        if (id) {
            touchBtns[id].active = true;
            keys[touchBtns[id].key] = true;
        }
    }
}

canvas.addEventListener("touchstart", e => {
    e.preventDefault();
    if (state === "caught") return; // no input during shame animation
    if (state !== "playing") {
        initAudio();
        // Try fullscreen + landscape lock on mobile
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().then(() => {
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock("landscape").catch(() => {});
                }
                setTimeout(resizeCanvas, 200);
            }).catch(() => {});
        }
        if (state === "start") startGame();
        else if (state === "gameover" || state === "win") { state = "start"; stopAllDistractionSounds(); stopLeakSound(); }
        return;
    }
    updateTouchButtons(e.touches);
}, { passive: false });

canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    if (state === "playing") updateTouchButtons(e.touches);
}, { passive: false });

canvas.addEventListener("touchend", e => {
    e.preventDefault();
    if (state === "playing") updateTouchButtons(e.touches);
}, { passive: false });

canvas.addEventListener("touchcancel", e => {
    e.preventDefault();
    if (state === "playing") updateTouchButtons(e.touches);
}, { passive: false });

function drawTouchControls() {
    if (!isTouchDevice || state !== "playing") return;

    for (const id in touchBtns) {
        const b = touchBtns[id];
        // Button background
        ctx.fillStyle = b.active ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.15)";
        ctx.beginPath();
        const r = 12;
        ctx.moveTo(b.x + r, b.y);
        ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
        ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
        ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
        ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
        ctx.closePath();
        ctx.fill();

        // Border
        ctx.strokeStyle = b.active ? "rgba(255, 255, 255, 0.6)" : "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;

        // Label
        ctx.fillStyle = b.active ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.6)";
        ctx.font = id === "fart" ? "bold 28px monospace" : "bold 40px monospace";
        ctx.textAlign = "center";
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + (id === "fart" ? 10 : 14));
    }
}

// ---- Landscape / Resize Support ----
function resizeCanvas() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aspect = W / H; // 960/540 = 16:9
    let drawW, drawH;
    if (vw / vh > aspect) {
        drawH = vh;
        drawW = vh * aspect;
    } else {
        drawW = vw;
        drawH = vw / aspect;
    }
    canvas.style.width = Math.floor(drawW) + "px";
    canvas.style.height = Math.floor(drawH) + "px";
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => {
    setTimeout(resizeCanvas, 150);
});
document.addEventListener("fullscreenchange", () => {
    setTimeout(resizeCanvas, 150);
});

// ---- Particle System ----
function spawnFartCloud(x, y, big) {
    const count = big ? 30 : 4;
    const sizeBase = big ? 20 : 6;
    const sizeRange = big ? 25 : 8;
    const speed = big ? 5 : 2;
    const lifeBase = big ? 60 : 20;
    const lifeRange = big ? 50 : 15;
    const maxLife = big ? 110 : 35;
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y: y + Math.random() * 15 - 7,
            vx: (Math.random() - 0.5) * speed,
            vy: (Math.random() - 0.8) * speed * 0.8,
            life: lifeBase + Math.random() * lifeRange,
            maxLife,
            size: sizeBase + Math.random() * sizeRange,
            color: Math.random() > 0.5 ? "#8BC34A" : "#6d9b2b"
        });
    }
}

// ---- Level Design ----
// Ground Y position (characters walk on this)
const GROUND_Y = 460;
const CHAR_GROUND = GROUND_Y - 60 * S / 2; // character center-ish

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

function buildLevel() {
    platforms = [
        { x: 0, y: GROUND_Y, w: 5000, h: 80, color: "#5d5d5d" },
    ];

    // Randomize distraction positions across the level
    // Place 6 distractions with varied spacing between x=200 and x=2900
    const distractionTypes = [
        { type: "printer", label: "LOUD PRINTER" },
        { type: "sneezer", label: "SICK COWORKER" },
        { type: "drill", label: "MAINTENANCE" },
        { type: "printer", label: "PRINTER" },
        { type: "sneezer", label: "SICK COWORKER" },
        { type: "drill", label: "MAINTENANCE" },
    ];
    // Shuffle distraction types
    for (let i = distractionTypes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [distractionTypes[i], distractionTypes[j]] = [distractionTypes[j], distractionTypes[i]];
    }
    // Generate randomized positions with minimum gap
    const nsPositions = [];
    const MIN_GAP = 500;
    let cursor = randRange(300, 500);
    for (let i = 0; i < 6; i++) {
        nsPositions.push(Math.floor(cursor));
        cursor += randRange(MIN_GAP, 900);
        if (cursor > 4600) cursor = 4600;
    }
    noiseSources = nsPositions.map((x, i) => ({
        x, y: GROUND_Y,
        type: distractionTypes[i].type,
        label: distractionTypes[i].label,
        radius: NOISE_RADIUS, animFrame: 0, disabled: 0,
    }));

    // Randomize coworker positions — ensure no overlap with distractions
    const cwPositions = [];
    let cwCursor = randRange(400, 600);
    for (let i = 0; i < 6; i++) {
        let pos = Math.floor(cwCursor);
        // Nudge away from any distraction that's too close
        for (const nsX of nsPositions) {
            if (Math.abs(pos - nsX) < 120) {
                pos = nsX + (pos >= nsX ? 140 : -140);
            }
        }
        cwPositions.push(pos);
        cwCursor += randRange(550, 850);
        if (cwCursor > 4800) cwCursor = 4800;
    }
    const speeds = [0.8, 1, 1, 1.2, 1.3, 1.5];
    // Shuffle speeds
    for (let i = speeds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [speeds[i], speeds[j]] = [speeds[j], speeds[i]];
    }
    // Randomly assign 2-3 coworkers as sitting (static at desks)
    const sittingIndices = new Set();
    const numSitting = 2 + Math.floor(Math.random() * 2); // 2 or 3
    while (sittingIndices.size < numSitting) {
        sittingIndices.add(Math.floor(Math.random() * 6));
    }
    coworkers = cwPositions.map((x, i) => {
        const sitting = sittingIndices.has(i);
        const patrolRange = randRange(80, 150);
        return {
            x, y: GROUND_Y,
            dir: Math.random() < 0.5 ? -1 : 1,
            patrolMin: sitting ? x : Math.max(50, Math.floor(x - patrolRange)),
            patrolMax: sitting ? x : Math.min(4950, Math.floor(x + patrolRange)),
            speed: sitting ? 0 : speeds[i],
            baseSpeed: sitting ? 0 : speeds[i],
            alert: 0,
            sitting,
            hunting: false,
            huntTimer: 0,
        };
    });

    // Place level end shortly after the last content
    const lastContentX = Math.max(
        nsPositions[nsPositions.length - 1],
        cwPositions[cwPositions.length - 1]
    );
    const levelWidth = Math.floor(lastContentX + 400);
    levelEnd = { x: levelWidth - 100, y: GROUND_Y - 120, w: 90, h: 120 };
    platforms[0].w = levelWidth;

    // Pick a random light index to flicker (skip first 4 lights)
    const totalLights = Math.floor((levelWidth - 100) / 300) + 1;
    flickerLightIndex = 4 + Math.floor(Math.random() * Math.max(1, totalLights - 6));
    const flickerWorldX = flickerLightIndex * 300 + 100;
    fallenLight = { x: flickerWorldX, y: 33, vy: 0, fallen: false, triggered: false, flickerTimer: 90 + Math.floor(Math.random() * 60) };

    particles = [];
}

function startGame() {
    state = "playing";
    fartman = {
        x: 60, y: GROUND_Y, w: 45 * S, h: 60 * S,
        vx: 0, vy: 0,
        gas: 0,
        onGround: true,
        facing: 1,
        farting: false,
        fartTimer: 0,
        walkFrame: 0,
        shameProgress: 0,
    };
    fartCooldown = 0;
    shameTimer = 0;
    caughtByCoworker = null;
    closeCalls = 0;
    popups = [];
    gameStartTime = Date.now();
    speedEscalationTimer = 0;
    camera.x = 0;
    buildLevel();
}

// ---- Fart Mechanic ----
// Check if fart sound is masked by a distraction, return true if heard by coworker
function checkFartHeard(radius) {
    // If fartman is inside any active noise source, his fart is masked
    let masked = false;
    for (const ns of noiseSources) {
        if (ns.disabled > 0) continue;
        if (Math.abs(fartman.x - ns.x) < ns.radius) { masked = true; break; }
    }

    if (masked) {
        // Check if a coworker would have heard — close call!
        let gotPhew = false;
        for (const cw of coworkers) {
            if (Math.abs(fartman.x - cw.x) < radius) {
                cw.alert = 60;
                if (!cw.sitting) {
                    cw.hunting = true;
                    cw.huntTimer = 180; // 3 seconds at 60fps
                }
                if (!gotPhew) {
                    closeCalls++;
                    spawnPopup("PHEW!", fartman.x - camera.x, fartman.y - 80, "#4CAF50");
                    gotPhew = true;
                }
            }
        }
        return false;
    }

    // Not masked — check if any coworker is close enough to hear
    for (const cw of coworkers) {
        if (Math.abs(fartman.x - cw.x) < radius) {
            cw.alert = 60;
            caughtByCoworker = cw;
            state = "caught";
            shameTimer = 150; // ~2.5 seconds at 60fps
            stopLeakSound();
            stopAllDistractionSounds();
            for (const c of coworkers) {
                c.laughing = true;
                c.dir = c.x < fartman.x ? 1 : -1;
            }
            return true;
        }
    }
    return false;
}

function spawnPopup(text, x, y, color) {
    popups.push({ text, x, y, life: 80, maxLife: 80, color: color || "#fff" });
}

// Big blast when meter hits 100%
function triggerBlast() {
    fartman.farting = true;
    fartman.fartTimer = 50; // longer visual
    blastTimer = 50;
    spawnFartCloud(fartman.x, fartman.y - 10, true); // big cloud
    playBlastFartSound();

    // Disable nearby noise sources - the blast knocks them out
    const BLAST_DISABLE_RADIUS = FART_RADIUS * 1.5;
    const DISABLE_DURATION = 300; // ~5 seconds at 60fps
    for (let i = 0; i < noiseSources.length; i++) {
        const ns = noiseSources[i];
        if (Math.abs(fartman.x - ns.x) < BLAST_DISABLE_RADIUS) {
            ns.disabled = DISABLE_DURATION;
            // Stop its sound immediately
            const id = "ns_" + i;
            if (activeNoiseSources[id]) {
                try { activeNoiseSources[id].stop(); } catch (e) {}
                delete activeNoiseSources[id];
            }
        }
    }

    // 2x the normal fart radius for detection
    checkFartHeard(FART_RADIUS * 1.5);

    fartman.gas = Math.max(0, fartman.gas - 50);
}

// ---- Update ----
let soundUpdateTimer = 0;
let leakParticleTimer = 0;

function update() {
    if (state !== "playing") return;

    const isLeaking = keys["Space"] && fartman.gas > 0;

    // Gas builds up (slower while leaking since you're releasing)
    if (!isLeaking) {
        fartman.gas += GAS_RATE;
    }

    // Space held = slow continuous release at 10 per second (~0.167 per frame at 60fps)
    if (isLeaking) {
        fartman.gas = Math.max(0, fartman.gas - (10 / 60));
        fartman.farting = true;
        fartman.fartTimer = 5; // keep alive while held

        // Small continuous bubbles
        leakParticleTimer++;
        if (leakParticleTimer % 6 === 0) {
            spawnFartCloud(fartman.x, fartman.y - 10, false);
        }

        // Start leak hiss sound
        startLeakSound();

        // Gas stages: silent below 40%, normal 40-70%, loud 70%+
        if (fartman.gas >= 70) {
            checkFartHeard(FART_RADIUS * 1.2);
        } else if (fartman.gas >= 40) {
            checkFartHeard(FART_RADIUS * 1);
        }
        // below 40%: silent — no detection
    } else {
        stopLeakSound();
        leakParticleTimer = 0;
    }

    // 100% = BIG BLAST
    if (fartman.gas >= 100) {
        fartman.gas = 100;
        triggerBlast();
    }

    // Movement (no jump - ground only)
    if (keys["ArrowLeft"] || keys["KeyA"]) {
        fartman.vx = -MOVE_SPEED;
        fartman.facing = -1;
    } else if (keys["ArrowRight"] || keys["KeyD"]) {
        fartman.vx = MOVE_SPEED;
        fartman.facing = 1;
    } else {
        fartman.vx = 0;
    }

    fartman.x += fartman.vx;
    fartman.x = Math.max(0, Math.min(fartman.x, platforms[0].w - fartman.w));
    fartman.y = GROUND_Y; // always on ground

    // Walk animation
    if (Math.abs(fartman.vx) > 0) fartman.walkFrame += 0.15;

    // Fart visual timer
    if (fartman.fartTimer > 0) fartman.fartTimer--;
    else fartman.farting = false;

    // Blast timer
    if (blastTimer > 0) blastTimer--;

    // Popup update
    for (let i = popups.length - 1; i >= 0; i--) {
        popups[i].life--;
        popups[i].y -= 0.7;
        if (popups[i].life <= 0) popups.splice(i, 1);
    }

    // Coworker patrol
    for (const cw of coworkers) {
        if (!cw.sitting) {
            if (cw.hunting && cw.huntTimer > 0) {
                // Chase toward fartman at 1.5x speed
                cw.dir = fartman.x > cw.x ? 1 : -1;
                cw.x += cw.speed * 1.5 * cw.dir;
                cw.huntTimer--;
                if (cw.huntTimer <= 0) {
                    cw.hunting = false;
                    // Face direction back into patrol zone
                    cw.dir = cw.x < (cw.patrolMin + cw.patrolMax) / 2 ? 1 : -1;
                }
            } else {
                cw.x += cw.speed * cw.dir;
                if (cw.x <= cw.patrolMin) cw.dir = 1;
                if (cw.x >= cw.patrolMax) cw.dir = -1;
            }
        }
        if (cw.alert > 0) cw.alert--;
    }

    // Speed escalation: every 30 seconds coworkers get 10% faster (cap 2x)
    speedEscalationTimer++;
    if (speedEscalationTimer >= 60 * 30) {
        speedEscalationTimer = 0;
        for (const cw of coworkers) {
            if (!cw.sitting) {
                cw.speed = Math.min(cw.baseSpeed * 2, cw.speed * 1.1);
            }
        }
        spawnPopup("Office getting busy...", W / 2, H / 2 - 60, "#FF9800");
    }

    // Hunting coworker catches fartman if close enough and not masked
    for (const cw of coworkers) {
        if (cw.hunting && Math.abs(fartman.x - cw.x) < 50) {
            let masked = false;
            for (const ns of noiseSources) {
                if (ns.disabled > 0) continue;
                if (Math.abs(fartman.x - ns.x) < ns.radius) { masked = true; break; }
            }
            if (!masked) {
                caughtByCoworker = cw;
                state = "caught";
                shameTimer = 150;
                stopLeakSound();
                stopAllDistractionSounds();
                for (const c of coworkers) {
                    c.laughing = true;
                    c.dir = c.x < fartman.x ? 1 : -1;
                }
            }
        }
    }

    // Noise source animation & disabled countdown
    for (const ns of noiseSources) {
        if (ns.disabled > 0) {
            ns.disabled--;
        } else {
            ns.animFrame++;
        }
    }

    // Falling light update
    if (fallenLight) {
        if (!fallenLight.fallen) {
            // Only start flickering countdown when the light is visible on screen
            const lightScreenX = fallenLight.x - camera.x;
            if (!fallenLight.triggered && lightScreenX >= 0 && lightScreenX <= W) {
                fallenLight.triggered = true;
            }
            if (fallenLight.triggered && fallenLight.flickerTimer > 0) {
                fallenLight.flickerTimer--;
            } else if (fallenLight.triggered && fallenLight.flickerTimer <= 0) {
                // Falling
                fallenLight.vy += 0.5; // gravity
                fallenLight.y += fallenLight.vy;
                if (fallenLight.y >= GROUND_Y - 5) {
                    fallenLight.y = GROUND_Y - 5;
                    fallenLight.fallen = true;
                    // Spawn spark particles
                    for (let i = 0; i < 12; i++) {
                        particles.push({
                            x: fallenLight.x, y: GROUND_Y - 5,
                            vx: (Math.random() - 0.5) * 6,
                            vy: -Math.random() * 5 - 1,
                            life: 20 + Math.floor(Math.random() * 20),
                        });
                    }
                    // Disable the nearest noise source
                    let closestNs = null;
                    let closestDist = Infinity;
                    for (const ns of noiseSources) {
                        const d = Math.abs(ns.x - fallenLight.x);
                        if (d < closestDist) {
                            closestDist = d;
                            closestNs = ns;
                        }
                    }
                    if (closestNs) {
                        closestNs.disabled = 999999; // permanently disabled
                        closestNs.crushedByLight = true;
                    }
                }
            }
        }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }

    // Update distraction sounds every ~10 frames for performance
    soundUpdateTimer++;
    if (soundUpdateTimer % 10 === 0) {
        updateDistrationSounds();
    }

    // Camera follow
    const targetCam = fartman.x - W / 3;
    camera.x += (targetCam - camera.x) * 0.08;
    camera.x = Math.max(0, Math.min(camera.x, platforms[0].w - W));

    // Win condition
    if (fartman.x + fartman.w > levelEnd.x && fartman.x < levelEnd.x + levelEnd.w) {
        state = "win";
        stopAllDistractionSounds();
        stopLeakSound();
        playWinSound();
        lastScore = calcScore();
        const pb = parseInt(localStorage.getItem("fartman_best") || "0");
        if (lastScore > pb) localStorage.setItem("fartman_best", lastScore);
    }
}

function calcScore() {
    const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    const score = Math.max(0, 10000 - elapsed * 20 + closeCalls * 200);
    return score;
}

function getGrade(score) {
    if (score >= 8000) return { grade: "S", color: "#FFD700" };
    if (score >= 6000) return { grade: "A", color: "#4CAF50" };
    if (score >= 4000) return { grade: "B", color: "#2196F3" };
    if (score >= 2000) return { grade: "C", color: "#FF9800" };
    return { grade: "D", color: "#f44336" };
}

// ---- Caught / Shame Animation ----
function updateCaught() {
    if (state !== "caught") return;
    shameTimer--;

    // Fartman progressively bends over in shame
    fartman.shameProgress = Math.min(1, (150 - shameTimer) / 40); // 0 to 1 over ~40 frames

    // Coworkers bob while laughing
    for (const cw of coworkers) {
        cw.laughFrame = (cw.laughFrame || 0) + 1;
    }

    // Particles still move
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }

    if (shameTimer <= 0) {
        state = "gameover";
        playGameOverSound();
        // Reset laughing state
        for (const cw of coworkers) {
            cw.laughing = false;
            cw.laughFrame = 0;
        }
    }
}

function drawFartmanShame() {
    const sx = fartman.x - camera.x;
    const baseY = fartman.y;
    const f = fartman.facing;
    const sp = fartman.shameProgress || 0;

    // Bend angle: 0 to ~35 degrees forward
    const bendAngle = sp * 35 * Math.PI / 180;

    ctx.save();
    // Pivot at feet
    ctx.translate(sx + 22 * S, baseY);
    ctx.rotate(f * bendAngle);
    ctx.translate(-(sx + 22 * S), -baseY);

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(sx + 22 * S, baseY - 2, 25 * S, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (still, no walking)
    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(sx + 10 * S, baseY - 18 * S, 10 * S, 18 * S);
    ctx.fillRect(sx + 24 * S, baseY - 18 * S, 10 * S, 18 * S);
    // Shoes
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.ellipse(sx + 15 * S, baseY - 2, 8 * S, 4 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sx + 29 * S, baseY - 2, 8 * S, 4 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    // Torso - turns red with shame
    const torsoX = sx + 22 * S;
    const torsoY = baseY - 38 * S;
    const torsoRX = 20 * S;
    const torsoRY = 22 * S;

    const r = Math.floor(52 + sp * 180);
    const g = Math.floor(152 - sp * 100);
    const b = Math.floor(219 - sp * 150);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY, torsoRX, torsoRY, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms covering face (move up as shame progresses)
    const armColor = `rgb(${Math.floor(41 + sp * 100)}, ${Math.floor(128 - sp * 60)}, ${Math.floor(185 - sp * 120)})`;
    ctx.fillStyle = armColor;
    const armRaise = sp * 22 * S;
    // Left arm - covers face
    ctx.save();
    ctx.translate(torsoX - torsoRX + 3 * S, torsoY - 6 * S - armRaise);
    ctx.rotate(-30 * sp * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 12 * S, 5 * S, 12 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Right arm - covers face
    ctx.save();
    ctx.translate(torsoX + torsoRX - 3 * S, torsoY - 6 * S - armRaise);
    ctx.rotate(30 * sp * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 12 * S, 5 * S, 12 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Hands in front of face when fully shamed
    if (sp > 0.5) {
        const handAlpha = (sp - 0.5) * 2;
        ctx.fillStyle = `rgba(244, 194, 138, ${handAlpha})`;
        const headX = torsoX;
        const headY = torsoY - 26 * S;
        ctx.beginPath();
        ctx.ellipse(headX - 8 * S, headY + 2 * S, 7 * S, 6 * S, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(headX + 8 * S, headY + 2 * S, 7 * S, 6 * S, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Head - increasingly red
    const headX = torsoX;
    const headY = torsoY - 26 * S;
    const headR = 16 * S;
    const faceR = Math.floor(244 + sp * 11);
    const faceG = Math.floor(194 - sp * 120);
    const faceB = Math.floor(138 - sp * 80);
    ctx.fillStyle = `rgb(${Math.min(255, faceR)}, ${Math.max(50, faceG)}, ${Math.max(50, faceB)})`;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = "#4a3520";
    ctx.beginPath();
    ctx.arc(headX, headY - 3 * S, headR, Math.PI, 0);
    ctx.fill();

    // Collar (at neck)
    const shameNeckY = headY + headR - 2 * S;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(torsoX, shameNeckY);
    ctx.lineTo(torsoX - 12 * S, shameNeckY - 4 * S);
    ctx.lineTo(torsoX - 8 * S, shameNeckY + 6 * S);
    ctx.lineTo(torsoX - 2 * S, shameNeckY + 3 * S);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(torsoX, shameNeckY);
    ctx.lineTo(torsoX + 12 * S, shameNeckY - 4 * S);
    ctx.lineTo(torsoX + 8 * S, shameNeckY + 6 * S);
    ctx.lineTo(torsoX + 2 * S, shameNeckY + 3 * S);
    ctx.fill();

    // Tie
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.moveTo(torsoX, shameNeckY);
    ctx.lineTo(torsoX + 4 * S, shameNeckY + 14 * S);
    ctx.lineTo(torsoX, shameNeckY + 22 * S);
    ctx.lineTo(torsoX - 4 * S, shameNeckY + 14 * S);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(torsoX, shameNeckY + 2 * S, 3 * S, 0, Math.PI * 2);
    ctx.fill();

    // Eyes - squinting shut in shame (visible before hands cover)
    if (sp < 0.8) {
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 2.5;
        // Squinting lines
        ctx.beginPath();
        ctx.moveTo(headX - 9 * S, headY - 1 * S);
        ctx.lineTo(headX - 1 * S, headY - 1 * S);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(headX + 1 * S, headY - 1 * S);
        ctx.lineTo(headX + 9 * S, headY - 1 * S);
        ctx.stroke();
        ctx.lineWidth = 1;

        // Grimacing mouth
        ctx.strokeStyle = "#c0392b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(headX, headY + 12 * S, 5 * S, Math.PI, 0);
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    // Sweat drops (shame sweat)
    const sweatBob = Math.sin(Date.now() * 0.015) * 3;
    ctx.fillStyle = "#5dade2";
    ctx.beginPath();
    ctx.arc(headX + headR + 2 * S, headY - 4 * S + sweatBob, 3 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headX - headR - 1 * S, headY + sweatBob * 0.7, 2.5 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headX + headR - 3 * S, headY + 8 * S - sweatBob, 2 * S, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Shame text floating above
    if (sp > 0.3) {
        const textAlpha = Math.min(1, (sp - 0.3) * 2);
        ctx.fillStyle = `rgba(255, 50, 50, ${textAlpha})`;
        ctx.font = "bold 16px monospace";
        ctx.textAlign = "center";
        const floatY = Math.sin(Date.now() * 0.005) * 4;
        ctx.fillText("*dying inside*", sx + 22 * S, baseY - 95 * S + floatY);
    }
}

function drawCoworkerLaughing(cw) {
    const sx = cw.x - camera.x;
    const baseY = cw.y;

    if (sx < -80 || sx > W + 80) return;

    const laughBob = Math.abs(Math.sin((cw.laughFrame || 0) * 0.2)) * 5;

    // Legs - bouncing with laughter
    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(sx - 8 * S, baseY - 15 * S + laughBob, 7 * S, 15 * S);
    ctx.fillRect(sx + 2 * S, baseY - 15 * S - laughBob, 7 * S, 15 * S);

    // Body bouncing
    ctx.fillStyle = "#95a5a6";
    ctx.beginPath();
    ctx.ellipse(sx, baseY - 28 * S - laughBob, 14 * S, 16 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pointing arm toward fartman
    ctx.fillStyle = "#7f8c8d";
    const pointDir = cw.dir;
    ctx.save();
    ctx.translate(sx + pointDir * 12 * S, baseY - 32 * S - laughBob);
    ctx.rotate(pointDir * 10 * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(pointDir * 10 * S, 0, 12 * S, 4 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pointing finger
    ctx.fillStyle = "#f4c28a";
    ctx.beginPath();
    ctx.ellipse(pointDir * 22 * S, 0, 4 * S, 3 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Head bouncing
    ctx.fillStyle = "#f4c28a";
    ctx.beginPath();
    ctx.arc(sx, baseY - 48 * S - laughBob, 13 * S, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(sx, baseY - 52 * S - laughBob, 13 * S, Math.PI, 0);
    ctx.fill();

    // Collar (at neck)
    const lNeckY = baseY - 48 * S - laughBob + 13 * S - 2 * S;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(sx, lNeckY);
    ctx.lineTo(sx - 10 * S, lNeckY - 3 * S);
    ctx.lineTo(sx - 7 * S, lNeckY + 5 * S);
    ctx.lineTo(sx - 2 * S, lNeckY + 2 * S);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx, lNeckY);
    ctx.lineTo(sx + 10 * S, lNeckY - 3 * S);
    ctx.lineTo(sx + 7 * S, lNeckY + 5 * S);
    ctx.lineTo(sx + 2 * S, lNeckY + 2 * S);
    ctx.fill();

    // Tie
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.moveTo(sx, lNeckY);
    ctx.lineTo(sx + 3 * S, lNeckY + 12 * S);
    ctx.lineTo(sx, lNeckY + 20 * S);
    ctx.lineTo(sx - 3 * S, lNeckY + 12 * S);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, lNeckY + 1.5 * S, 2.5 * S, 0, Math.PI * 2);
    ctx.fill();

    // Eyes - happy squinting from laughing
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx - 4 * S, baseY - 49 * S - laughBob, 3 * S, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx + 4 * S, baseY - 49 * S - laughBob, 3 * S, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Big open laughing mouth
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.arc(sx, baseY - 43 * S - laughBob, 5 * S, 0, Math.PI);
    ctx.fill();
    // Teeth
    ctx.fillStyle = "#fff";
    ctx.fillRect(sx - 4 * S, baseY - 43 * S - laughBob, 8 * S, 3 * S);

    // "HA HA" text floating up
    const haFrame = (cw.laughFrame || 0);
    if (haFrame % 40 < 25) {
        const haAlpha = 1 - (haFrame % 40) / 25;
        const haY = -(haFrame % 40) * 1.2;
        ctx.fillStyle = `rgba(255, 100, 100, ${haAlpha})`;
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("HA HA!", sx, baseY - 65 * S - laughBob + haY);
    }
}

// ---- Drawing ----
function drawBackground() {
    // Office wall
    ctx.fillStyle = "#e8e0d0";
    ctx.fillRect(0, 0, W, H);

    // Wall pattern
    ctx.strokeStyle = "#d4cbb8";
    for (let x = -camera.x % 200; x < W; x += 200) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, GROUND_Y);
        ctx.stroke();
    }

    // Baseboard
    ctx.fillStyle = "#6B4226";
    ctx.fillRect(0, GROUND_Y - 15, W, 15);

    // Ceiling
    ctx.fillStyle = "#d0d0d0";
    ctx.fillRect(0, 0, W, 30);

    // Ceiling lights
    for (let x = -camera.x % 300 + 100; x < W; x += 300) {
        const worldLightIdx = Math.round((x + camera.x - 100) / 300);
        const isFlicker = worldLightIdx === flickerLightIndex;
        const lightFalling = isFlicker && fallenLight && fallenLight.triggered && fallenLight.flickerTimer <= 0;

        if (lightFalling) {
            // Light has detached — draw empty fixture mount
            ctx.fillStyle = "#555";
            ctx.fillRect(x - 30, 25, 60, 8);
            // Dangling wires
            ctx.strokeStyle = "#333";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 10, 33);
            ctx.lineTo(x - 14, 50);
            ctx.moveTo(x + 10, 33);
            ctx.lineTo(x + 14, 50);
            ctx.stroke();
            ctx.lineWidth = 1;
        } else if (isFlicker && fallenLight && fallenLight.triggered && fallenLight.flickerTimer > 0) {
            // Triggered and flickering before falling
            const flickerOn = Math.random() > 0.3;
            if (flickerOn) {
                const bright = 0.5 + Math.random() * 0.5;
                ctx.globalAlpha = bright;
                ctx.fillStyle = "#fff8e0";
                ctx.fillRect(x - 30, 25, 60, 8);
                ctx.fillStyle = "rgba(255, 248, 200, 0.15)";
                ctx.beginPath();
                ctx.moveTo(x - 30, 33);
                ctx.lineTo(x + 30, 33);
                ctx.lineTo(x + 80, 200);
                ctx.lineTo(x - 80, 200);
                ctx.fill();
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = "#888";
                ctx.fillRect(x - 30, 25, 60, 8);
            }
        } else {
            // Normal light
            ctx.fillStyle = "#fff8e0";
            ctx.fillRect(x - 30, 25, 60, 8);
            ctx.fillStyle = "rgba(255, 248, 200, 0.15)";
            ctx.beginPath();
            ctx.moveTo(x - 30, 33);
            ctx.lineTo(x + 30, 33);
            ctx.lineTo(x + 80, 200);
            ctx.lineTo(x - 80, 200);
            ctx.fill();
        }
    }

    // Draw falling / fallen light
    if (fallenLight && fallenLight.flickerTimer <= 0) {
        const sx = fallenLight.x - camera.x;
        if (sx > -100 && sx < W + 100) {
            // The light fixture falling or on the ground
            const angle = fallenLight.fallen ? 0.3 : Math.sin(fallenLight.y * 0.05) * 0.15;
            ctx.save();
            ctx.translate(sx, fallenLight.y);
            ctx.rotate(angle);
            // Fixture body
            ctx.fillStyle = fallenLight.fallen ? "#777" : "#fff8e0";
            ctx.fillRect(-30, -4, 60, 8);
            // Glass tube
            ctx.fillStyle = fallenLight.fallen ? "#999" : "#ffe";
            ctx.fillRect(-25, -2, 50, 4);
            ctx.restore();

            if (fallenLight.fallen) {
                // Broken glass shards on the ground
                ctx.fillStyle = "rgba(200, 200, 200, 0.5)";
                for (let i = -20; i < 20; i += 7) {
                    ctx.fillRect(sx + i, GROUND_Y - 3, 4, 3);
                }
                // "SMASH!" text fading
                ctx.fillStyle = "rgba(255, 100, 0, 0.7)";
                ctx.font = "bold 14px monospace";
                ctx.textAlign = "center";
                ctx.fillText("CRASH!", sx, GROUND_Y - 20);
            }
        }
    }

    // Windows
    for (let x = -camera.x % 400 + 50; x < W; x += 400) {
        ctx.fillStyle = "#87CEEB";
        ctx.fillRect(x, 60, 100, 120);
        ctx.strokeStyle = "#8B7355";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, 60, 100, 120);
        ctx.beginPath();
        ctx.moveTo(x + 50, 60);
        ctx.lineTo(x + 50, 180);
        ctx.moveTo(x, 120);
        ctx.lineTo(x + 100, 120);
        ctx.stroke();
        ctx.lineWidth = 1;
    }
}

function drawPlatforms() {
    for (const p of platforms) {
        const sx = p.x - camera.x;
        if (sx + p.w < -50 || sx > W + 50) continue;

        // Ground - carpet
        ctx.fillStyle = "#7B8D6E";
        ctx.fillRect(sx, p.y, p.w, p.h);
        ctx.fillStyle = "#6d7f60";
        for (let tx = sx; tx < sx + p.w; tx += 20) {
            ctx.fillRect(tx, p.y, 1, p.h);
        }
    }

    // Draw some desks as background decoration (not collidable)
    const desks = [
        { x: 250, w: 150 }, { x: 500, w: 120 }, { x: 750, w: 180 },
        { x: 1050, w: 100 }, { x: 1250, w: 160 }, { x: 1500, w: 140 },
        { x: 1750, w: 120 }, { x: 1950, w: 180 }, { x: 2250, w: 100 },
        { x: 2450, w: 160 }, { x: 2700, w: 140 }, { x: 2900, w: 120 },
        { x: 3150, w: 150 }, { x: 3400, w: 130 }, { x: 3700, w: 160 },
        { x: 3950, w: 110 }, { x: 4200, w: 140 }, { x: 4500, w: 120 },
    ];
    for (const d of desks) {
        const sx = d.x - camera.x;
        if (sx + d.w < -50 || sx > W + 50) continue;
        const deskH = 45 * S;
        const deskY = GROUND_Y - deskH;
        // Desk top
        ctx.fillStyle = "#8B7355";
        ctx.fillRect(sx, deskY, d.w, 10 * S);
        // Legs
        ctx.fillStyle = "#7a6545";
        ctx.fillRect(sx + 5, deskY + 10 * S, 6 * S, deskH - 10 * S);
        ctx.fillRect(sx + d.w - 5 - 6 * S, deskY + 10 * S, 6 * S, deskH - 10 * S);
        // Items on desk
        ctx.fillStyle = "#555";
        ctx.fillRect(sx + 20, deskY - 8 * S, 12 * S, 8 * S); // monitor
        ctx.fillStyle = "#333";
        ctx.fillRect(sx + 22, deskY - 7 * S, 10 * S, 5 * S); // screen
        ctx.fillStyle = "#87CEEB";
        ctx.fillRect(sx + 23, deskY - 6.5 * S, 8.5 * S, 4 * S); // screen glow
    }
}

function drawNoiseSource(ns) {
    const sx = ns.x - camera.x;
    if (sx < -250 || sx > W + 250) return;

    // If disabled, draw dimmed with "knocked out" indicator
    if (ns.disabled > 0) {
        if (ns.crushedByLight) {
            // Permanently destroyed by fallen light — draw smashed/dimmed
            ctx.globalAlpha = 0.2;
            drawNoiseSourceSprite(ns, sx);
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#ff6600";
            ctx.font = "bold 13px monospace";
            ctx.textAlign = "center";
            ctx.fillText("DESTROYED!", sx, ns.y - 68 * S);
            return;
        }
        ctx.globalAlpha = 0.3;
        drawNoiseSourceSprite(ns, sx);
        ctx.globalAlpha = 1;
        // "Knocked out" label
        ctx.fillStyle = "#ff4444";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        const flashOn = Math.floor(ns.disabled / 15) % 2 === 0;
        if (flashOn) {
            ctx.fillText("KNOCKED OUT!", sx, ns.y - 68 * S);
        }
        // Recovery bar
        const maxDur = 300;
        const pct = ns.disabled / maxDur;
        const barW = 60;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(sx - barW / 2, ns.y - 58 * S, barW, 6);
        ctx.fillStyle = "#ff8c00";
        ctx.fillRect(sx - barW / 2, ns.y - 58 * S, barW * (1 - pct), 6);
        return;
    }

    const pulse = Math.sin(ns.animFrame * 0.08) * 15;

    // Noise radius - BOLD orange circle
    ctx.strokeStyle = "rgba(255, 165, 0, 0.6)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.arc(sx, ns.y - 30 * S, ns.radius + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Filled glow area
    const grad = ctx.createRadialGradient(sx, ns.y - 30 * S, 0, sx, ns.y - 30 * S, ns.radius + pulse);
    grad.addColorStop(0, "rgba(255, 165, 0, 0.08)");
    grad.addColorStop(0.7, "rgba(255, 165, 0, 0.04)");
    grad.addColorStop(1, "rgba(255, 165, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, ns.y - 30 * S, ns.radius + pulse, 0, Math.PI * 2);
    ctx.fill();

    // Sound wave rings - bolder
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
        const waveR = 30 + ((ns.animFrame * 2 + i * 30) % 80);
        const alpha = 1 - waveR / 110;
        if (alpha > 0) {
            ctx.strokeStyle = `rgba(255, 180, 0, ${alpha * 0.7})`;
            ctx.beginPath();
            ctx.arc(sx, ns.y - 40 * S, waveR, -Math.PI * 0.6, -Math.PI * 0.1);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(sx, ns.y - 40 * S, waveR, -Math.PI * 0.9, -Math.PI * 0.4);
            ctx.stroke();
        }
    }
    ctx.lineWidth = 1;

    drawNoiseSourceSprite(ns, sx);
}

function drawNoiseSourceSprite(ns, sx) {
    const by = ns.y;

    if (ns.type === "printer") {
        const shake = ns.disabled > 0 ? 0 : Math.sin(ns.animFrame * 0.5) * 3;
        ctx.fillStyle = "#888";
        ctx.fillRect(sx - 30 + shake, by - 25 * S, 60, 35 * S);
        ctx.fillStyle = "#666";
        ctx.fillRect(sx - 27 + shake, by - 22 * S, 54, 12 * S);
        const paperOff = ns.disabled > 0 ? 0 : Math.sin(ns.animFrame * 0.1) * 4;
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx - 15 + shake, by - 30 * S + paperOff, 30, 12 * S);
        ctx.fillStyle = "#777";
        ctx.fillRect(sx - 30 + shake, by - 25 * S + 35 * S, 60, 6 * S);
    } else if (ns.type === "sneezer") {
        ctx.fillStyle = "#4a90d9";
        ctx.fillRect(sx - 12 * S, by - 30 * S, 24 * S, 35 * S);
        ctx.fillStyle = "#f4c28a";
        ctx.beginPath();
        ctx.arc(sx, by - 38 * S, 15 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff4444";
        ctx.beginPath();
        ctx.arc(sx + 7 * S, by - 35 * S, 4.5 * S, 0, Math.PI * 2);
        ctx.fill();
        if (ns.disabled <= 0 && ns.animFrame % 80 < 20) {
            ctx.fillStyle = "rgba(255, 255, 100, 0.7)";
            for (let i = 0; i < 5; i++) {
                const sx2 = sx + 15 * S + (ns.animFrame % 80) * 2 + i * 8;
                ctx.beginPath();
                ctx.arc(sx2, by - 36 * S + Math.sin(i * 2) * 8, 3 * S, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx + 10 * S, by - 48 * S, 12 * S, 9 * S);
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(sx - 8 * S, by - 30 * S + 35 * S, 7 * S, 15 * S);
        ctx.fillRect(sx + 2 * S, by - 30 * S + 35 * S, 7 * S, 15 * S);
    } else if (ns.type === "drill") {
        ctx.fillStyle = "#ff8c00";
        ctx.fillRect(sx - 12 * S, by - 30 * S, 24 * S, 35 * S);
        ctx.fillStyle = "#ffcc00";
        ctx.beginPath();
        ctx.arc(sx, by - 40 * S, 15 * S, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(sx - 18 * S, by - 40 * S, 36 * S, 7 * S);
        ctx.fillStyle = "#f4c28a";
        ctx.beginPath();
        ctx.arc(sx, by - 35 * S, 12 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(sx - 4 * S, by - 36 * S, 2 * S, 0, Math.PI * 2);
        ctx.arc(sx + 4 * S, by - 36 * S, 2 * S, 0, Math.PI * 2);
        ctx.fill();
        const drillShake = ns.disabled > 0 ? 0 : Math.sin(ns.animFrame * 0.8) * 3;
        ctx.fillStyle = "#555";
        ctx.fillRect(sx + 15 * S, by - 25 * S + drillShake, 30 * S, 9 * S);
        ctx.fillStyle = "#999";
        ctx.fillRect(sx + 42 * S, by - 23 * S + drillShake, 12 * S, 5 * S);
        ctx.fillStyle = "#cc7000";
        ctx.fillRect(sx - 8 * S, by - 30 * S + 35 * S, 7 * S, 15 * S);
        ctx.fillRect(sx + 2 * S, by - 30 * S + 35 * S, 7 * S, 15 * S);
    }

    // Label
    if (ns.disabled <= 0) {
        ctx.fillStyle = "#ff8c00";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText(ns.label, sx, by - 58 * S);
        ctx.font = "bold 16px monospace";
        ctx.fillText("♪ ♫ ♪", sx, by - 68 * S);
    }
}

function drawFartman() {
    const sx = fartman.x - camera.x;
    const baseY = fartman.y; // ground Y
    const f = fartman.facing;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(sx + 22 * S, baseY - 2, 25 * S, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Walk bob
    const bob = Math.abs(Math.sin(fartman.walkFrame)) * 3;

    // --- ROUND BODY CHARACTER ---

    // Legs (stumpy)
    const legOff = Math.sin(fartman.walkFrame * 2) * 6;
    ctx.fillStyle = "#2c3e50";
    // Left leg
    ctx.fillRect(sx + 10 * S, baseY - 18 * S - bob + legOff, 10 * S, 18 * S);
    // Right leg
    ctx.fillRect(sx + 24 * S, baseY - 18 * S - bob - legOff, 10 * S, 18 * S);
    // Shoes
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.ellipse(sx + 15 * S, baseY - 2 + legOff, 8 * S, 4 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sx + 29 * S, baseY - 2 - legOff, 8 * S, 4 * S, 0, 0, Math.PI * 2);
    ctx.fill();

    // Big round torso (the signature round body)
    const torsoX = sx + 22 * S;
    const torsoY = baseY - 38 * S - bob;
    const torsoRX = 20 * S;
    const torsoRY = 22 * S;

    ctx.fillStyle = fartman.farting ? "#7dbe5a" : "#3498db";
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoY, torsoRX, torsoRY, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shirt buttons
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(torsoX, torsoY - 8 * S + i * 8 * S, 2 * S, 0, Math.PI * 2);
        ctx.fill();
    }

    // Arms
    const armColor = fartman.farting ? "#6aa84f" : "#2980b9";
    ctx.fillStyle = armColor;
    const armWave = Math.sin(fartman.walkFrame * 2) * 12;
    // Left arm
    ctx.save();
    ctx.translate(torsoX - torsoRX + 3 * S, torsoY - 6 * S);
    ctx.rotate((armWave - 10) * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 12 * S, 5 * S, 12 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Right arm
    ctx.save();
    ctx.translate(torsoX + torsoRX - 3 * S, torsoY - 6 * S);
    ctx.rotate((-armWave + 10) * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 12 * S, 5 * S, 12 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Head (round)
    const headX = torsoX;
    const headY = torsoY - 26 * S;
    const headR = 16 * S;
    ctx.fillStyle = "#f4c28a";
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = "#4a3520";
    ctx.beginPath();
    ctx.arc(headX, headY - 3 * S, headR, Math.PI, 0);
    ctx.fill();

    // Collar (at neck, visible below chin)
    const neckY = headY + headR - 2 * S;
    ctx.fillStyle = "#fff";
    // Left collar flap
    ctx.beginPath();
    ctx.moveTo(torsoX, neckY);
    ctx.lineTo(torsoX - 12 * S, neckY - 4 * S);
    ctx.lineTo(torsoX - 8 * S, neckY + 6 * S);
    ctx.lineTo(torsoX - 2 * S, neckY + 3 * S);
    ctx.fill();
    // Right collar flap
    ctx.beginPath();
    ctx.moveTo(torsoX, neckY);
    ctx.lineTo(torsoX + 12 * S, neckY - 4 * S);
    ctx.lineTo(torsoX + 8 * S, neckY + 6 * S);
    ctx.lineTo(torsoX + 2 * S, neckY + 3 * S);
    ctx.fill();

    // Tie
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.moveTo(torsoX, neckY);
    ctx.lineTo(torsoX + 4 * S, neckY + 14 * S);
    ctx.lineTo(torsoX, neckY + 22 * S);
    ctx.lineTo(torsoX - 4 * S, neckY + 14 * S);
    ctx.fill();
    // Tie knot
    ctx.beginPath();
    ctx.arc(torsoX, neckY + 2 * S, 3 * S, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeX = headX + f * 4 * S;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(eyeX - 5 * S, headY - 1 * S, 5 * S, 0, Math.PI * 2);
    ctx.arc(eyeX + 5 * S, headY - 1 * S, 5 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(eyeX - 4 * S + f * 2 * S, headY - 1 * S, 2.5 * S, 0, Math.PI * 2);
    ctx.arc(eyeX + 6 * S + f * 2 * S, headY - 1 * S, 2.5 * S, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    if (fartman.farting) {
        // Relief / open mouth
        ctx.fillStyle = "#c0392b";
        ctx.beginPath();
        ctx.arc(headX + f * 2 * S, headY + 8 * S, 5 * S, 0, Math.PI);
        ctx.fill();
    } else if (fartman.gas > 80) {
        // Stressed grimace
        ctx.strokeStyle = "#c0392b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(headX + f * 2 * S, headY + 12 * S, 5 * S, Math.PI, 0);
        ctx.stroke();
        ctx.lineWidth = 1;
        // Sweat drops
        ctx.fillStyle = "#5dade2";
        const sweatBob = Math.sin(Date.now() * 0.01) * 3;
        ctx.beginPath();
        ctx.arc(headX + headR + 2 * S, headY - 4 * S + sweatBob, 3 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(headX - headR - 1 * S, headY + 2 * S + sweatBob * 0.7, 2 * S, 0, Math.PI * 2);
        ctx.fill();
        // Red cheeks
        ctx.fillStyle = "rgba(255, 100, 100, 0.4)";
        ctx.beginPath();
        ctx.arc(headX - 10 * S, headY + 5 * S, 5 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(headX + 10 * S, headY + 5 * S, 5 * S, 0, Math.PI * 2);
        ctx.fill();
    } else if (fartman.gas > 50) {
        // Worried flat mouth
        ctx.strokeStyle = "#8B4513";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(headX - 4 * S, headY + 8 * S);
        ctx.lineTo(headX + 6 * S, headY + 8 * S);
        ctx.stroke();
        ctx.lineWidth = 1;
    } else {
        // Happy smile
        ctx.fillStyle = "#8B4513";
        ctx.beginPath();
        ctx.arc(headX + f * S, headY + 7 * S, 4 * S, 0, Math.PI);
        ctx.fill();
    }

    // Fart visual effect
    if (blastTimer > 0) {
        // BIG BLAST - huge expanding gas bubble
        const blastProgress = 1 - blastTimer / 50;
        const blastSize = 40 * S + blastProgress * 60 * S;
        const blastAlpha = (1 - blastProgress) * 0.6;
        // Outer glow
        ctx.fillStyle = `rgba(100, 160, 40, ${blastAlpha * 0.3})`;
        ctx.beginPath();
        ctx.arc(sx + 22 * S - f * 15 * S, baseY - 20 * S, blastSize * 1.4, 0, Math.PI * 2);
        ctx.fill();
        // Main bubble
        ctx.fillStyle = `rgba(139, 195, 74, ${blastAlpha})`;
        ctx.beginPath();
        ctx.arc(sx + 22 * S - f * 15 * S, baseY - 20 * S, blastSize, 0, Math.PI * 2);
        ctx.fill();
        // Inner darker core
        ctx.fillStyle = `rgba(80, 140, 30, ${blastAlpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(sx + 22 * S - f * 20 * S, baseY - 15 * S, blastSize * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Shockwave ring
        ctx.strokeStyle = `rgba(139, 195, 74, ${blastAlpha * 0.8})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(sx + 22 * S - f * 15 * S, baseY - 20 * S, blastSize * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
    } else if (fartman.farting) {
        // Small continuous leak bubble
        const leakSize = 10 * S + Math.sin(Date.now() * 0.02) * 3 * S;
        ctx.fillStyle = "rgba(139, 195, 74, 0.35)";
        ctx.beginPath();
        ctx.arc(sx + 22 * S - f * 18 * S, baseY - 12 * S, leakSize, 0, Math.PI * 2);
        ctx.fill();
        // Smaller trailing puff
        ctx.fillStyle = "rgba(120, 180, 60, 0.2)";
        ctx.beginPath();
        ctx.arc(sx + 22 * S - f * 26 * S, baseY - 8 * S, leakSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCoworker(cw) {
    const sx = cw.x - camera.x;
    const baseY = cw.y;

    if (sx < -80 || sx > W + 80) return;

    // Hearing radius - BOLD red circle
    ctx.strokeStyle = cw.alert > 0 ? "rgba(255, 0, 0, 0.5)" : "rgba(255, 50, 50, 0.2)";
    ctx.lineWidth = cw.alert > 0 ? 4 : 3;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(sx, baseY - 30 * S, FART_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // Red glow for danger zone
    const cwGrad = ctx.createRadialGradient(sx, baseY - 30 * S, 0, sx, baseY - 30 * S, FART_RADIUS);
    cwGrad.addColorStop(0, "rgba(255, 0, 0, 0.05)");
    cwGrad.addColorStop(0.8, "rgba(255, 0, 0, 0.02)");
    cwGrad.addColorStop(1, "rgba(255, 0, 0, 0)");
    ctx.fillStyle = cwGrad;
    ctx.beginPath();
    ctx.arc(sx, baseY - 30 * S, FART_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (cw.sitting) {
        // --- Sitting coworker at desk with computer ---
        const deskW = 60;
        const deskH = 40 * S;
        const deskY = baseY - deskH;
        const chairDir = cw.dir;

        // Desk
        ctx.fillStyle = "#8B7355";
        ctx.fillRect(sx + chairDir * 10 - deskW / 2, deskY, deskW, 8 * S);
        // Desk legs
        ctx.fillStyle = "#7a6545";
        ctx.fillRect(sx + chairDir * 10 - deskW / 2 + 3, deskY + 8 * S, 5 * S, deskH - 8 * S);
        ctx.fillRect(sx + chairDir * 10 + deskW / 2 - 3 - 5 * S, deskY + 8 * S, 5 * S, deskH - 8 * S);

        // Monitor on desk
        const monX = sx + chairDir * 10;
        ctx.fillStyle = "#222";
        ctx.fillRect(monX - 12, deskY - 22, 24, 18); // screen
        ctx.fillStyle = "#4488ff";
        ctx.fillRect(monX - 10, deskY - 20, 20, 14); // screen glow
        ctx.fillStyle = "#333";
        ctx.fillRect(monX - 3, deskY - 4, 6, 4); // stand

        // Chair (behind coworker)
        ctx.fillStyle = "#444";
        ctx.fillRect(sx - 10, baseY - 28 * S, 20, 5 * S); // seat
        ctx.fillRect(sx - 8, baseY - 40 * S, 4, 15 * S); // backrest post
        ctx.fillRect(sx - 12, baseY - 42 * S, 16, 10 * S); // backrest

        // Legs (seated, bent forward)
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(sx - 8 * S, baseY - 15 * S, 7 * S, 15 * S);
        ctx.fillRect(sx + 2 * S, baseY - 15 * S, 7 * S, 15 * S);

        // Body (slightly leaned forward)
        ctx.fillStyle = cw.alert > 0 ? "#e74c3c" : "#95a5a6";
        ctx.beginPath();
        ctx.ellipse(sx, baseY - 30 * S, 14 * S, 14 * S, 0, 0, Math.PI * 2);
        ctx.fill();

        // Arms reaching toward desk
        ctx.fillStyle = "#f4c28a";
        ctx.fillRect(sx + chairDir * 5, baseY - 28 * S, chairDir * 15, 5 * S);

        // Head
        ctx.fillStyle = "#f4c28a";
        ctx.beginPath();
        ctx.arc(sx, baseY - 48 * S, 13 * S, 0, Math.PI * 2);
        ctx.fill();

        // Hair
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(sx, baseY - 52 * S, 13 * S, Math.PI, 0);
        ctx.fill();

        // Collar (drawn after head so it's visible at the neck)
        const sNeckY = baseY - 48 * S + 13 * S - 2 * S;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(sx, sNeckY);
        ctx.lineTo(sx - 10 * S, sNeckY - 3 * S);
        ctx.lineTo(sx - 7 * S, sNeckY + 5 * S);
        ctx.lineTo(sx - 2 * S, sNeckY + 2 * S);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx, sNeckY);
        ctx.lineTo(sx + 10 * S, sNeckY - 3 * S);
        ctx.lineTo(sx + 7 * S, sNeckY + 5 * S);
        ctx.lineTo(sx + 2 * S, sNeckY + 2 * S);
        ctx.fill();

        // Tie
        ctx.fillStyle = "#c0392b";
        ctx.beginPath();
        ctx.moveTo(sx, sNeckY);
        ctx.lineTo(sx + 3 * S, sNeckY + 10 * S);
        ctx.lineTo(sx, sNeckY + 16 * S);
        ctx.lineTo(sx - 3 * S, sNeckY + 10 * S);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sNeckY + 1.5 * S, 2.5 * S, 0, Math.PI * 2);
        ctx.fill();

        // Eyes (looking at screen)
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(sx - 4 * S + chairDir * 3 * S, baseY - 48 * S, 2.5 * S, 0, Math.PI * 2);
        ctx.arc(sx + 4 * S + chairDir * 3 * S, baseY - 48 * S, 2.5 * S, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // --- Walking coworker ---
        // Legs
        const legAnim = Math.sin(Date.now() * 0.005 * cw.speed) * 4;
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(sx - 8 * S, baseY - 15 * S + legAnim, 7 * S, 15 * S);
        ctx.fillRect(sx + 2 * S, baseY - 15 * S - legAnim, 7 * S, 15 * S);

        // Body - 1.5x
        ctx.fillStyle = cw.alert > 0 ? "#e74c3c" : "#95a5a6";
        ctx.beginPath();
        ctx.ellipse(sx, baseY - 28 * S, 14 * S, 16 * S, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head - 1.5x
        ctx.fillStyle = "#f4c28a";
        ctx.beginPath();
        ctx.arc(sx, baseY - 48 * S, 13 * S, 0, Math.PI * 2);
        ctx.fill();

        // Hair
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(sx, baseY - 52 * S, 13 * S, Math.PI, 0);
        ctx.fill();

        // Collar (drawn after head so it's visible at neck)
        const wNeckY = baseY - 48 * S + 13 * S - 2 * S;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(sx, wNeckY);
        ctx.lineTo(sx - 10 * S, wNeckY - 3 * S);
        ctx.lineTo(sx - 7 * S, wNeckY + 5 * S);
        ctx.lineTo(sx - 2 * S, wNeckY + 2 * S);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx, wNeckY);
        ctx.lineTo(sx + 10 * S, wNeckY - 3 * S);
        ctx.lineTo(sx + 7 * S, wNeckY + 5 * S);
        ctx.lineTo(sx + 2 * S, wNeckY + 2 * S);
        ctx.fill();

        // Tie
        ctx.fillStyle = "#c0392b";
        ctx.beginPath();
        ctx.moveTo(sx, wNeckY);
        ctx.lineTo(sx + 3 * S, wNeckY + 12 * S);
        ctx.lineTo(sx, wNeckY + 20 * S);
        ctx.lineTo(sx - 3 * S, wNeckY + 12 * S);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, wNeckY + 1.5 * S, 2.5 * S, 0, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(sx - 4 * S + cw.dir * 3 * S, baseY - 48 * S, 2.5 * S, 0, Math.PI * 2);
        ctx.arc(sx + 4 * S + cw.dir * 3 * S, baseY - 48 * S, 2.5 * S, 0, Math.PI * 2);
        ctx.fill();
    }

    // Alert indicator
    if (cw.alert > 0) {
        ctx.fillStyle = "#e74c3c";
        ctx.font = `bold ${24 * S}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText("!!", sx, baseY - 68 * S);
        // Shocked open mouth
        ctx.fillStyle = "#e74c3c";
        ctx.beginPath();
        ctx.arc(sx, baseY - 42 * S, 5 * S, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawGasBar() {
    const barW = W / 2;
    const barH = 28;
    const bx = 20;
    const by = 20;

    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(bx - 3, by - 3, barW + 6, barH + 6);

    // Bar fill — color stages: green (silent <40%), yellow (normal 40-70%), red (loud 70%+)
    const ratio = fartman.gas / 100;
    let barColor;
    if (fartman.gas < 40) {
        barColor = "#4CAF50"; // green = silent zone
    } else if (fartman.gas < 70) {
        barColor = "#FFC107"; // yellow = normal detection
    } else {
        barColor = "#f44336"; // red = loud, 1.2x radius
    }
    ctx.fillStyle = barColor;
    ctx.fillRect(bx, by, barW * ratio, barH);

    // Stage zone markers
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + barW * 0.4, by);
    ctx.lineTo(bx + barW * 0.4, by + barH);
    ctx.moveTo(bx + barW * 0.7, by);
    ctx.lineTo(bx + barW * 0.7, by + barH);
    ctx.stroke();

    // Pulsing glow when loud
    if (ratio > 0.7) {
        const glowAlpha = Math.sin(Date.now() * 0.01) * 0.15 + 0.15;
        ctx.fillStyle = `rgba(255, 0, 0, ${glowAlpha})`;
        ctx.fillRect(bx, by, barW * ratio, barH);
    }

    // Border
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, barW, barH);
    ctx.lineWidth = 1;

    // Text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px monospace";
    ctx.textAlign = "left";
    const stageLabel = fartman.gas < 40 ? "SILENT" : fartman.gas < 70 ? "NORMAL" : "LOUD";
    ctx.fillText(`GAS: ${Math.floor(fartman.gas)}% [${stageLabel}]`, bx + 8, by + 20);

    // Warning flash
    if (fartman.gas > 80) {
        if (Math.floor(Date.now() / 200) % 2 === 0) {
            ctx.fillStyle = "#ff0000";
            ctx.font = "bold 16px monospace";
            ctx.fillText("⚠ DANGER!", bx + barW + 12, by + 20);
        }
    }

    // Controls hint
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px monospace";
    ctx.fillText(isTouchDevice ? "HOLD FART = Release Gas  |  ◀ ▶ = Move" : "HOLD SPACE = Release Gas  |  ← → = Move", bx, by + 44);
}

function drawLevelEnd() {
    const sx = levelEnd.x - camera.x;
    if (sx < -150 || sx > W + 150) return;

    // Bathroom door - 1.5x
    ctx.fillStyle = "#8B6914";
    ctx.fillRect(sx, levelEnd.y, levelEnd.w, levelEnd.h);
    // Door frame
    ctx.strokeStyle = "#6B4910";
    ctx.lineWidth = 4;
    ctx.strokeRect(sx, levelEnd.y, levelEnd.w, levelEnd.h);
    ctx.lineWidth = 1;
    // Door knob
    ctx.fillStyle = "#DAA520";
    ctx.beginPath();
    ctx.arc(sx + 72, levelEnd.y + 65, 6, 0, Math.PI * 2);
    ctx.fill();
    // Sign
    ctx.fillStyle = "#2196F3";
    ctx.fillRect(sx + 15, levelEnd.y + 8, 60, 38);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("REST", sx + 45, levelEnd.y + 27);
    ctx.fillText("ROOM", sx + 45, levelEnd.y + 41);

    // Arrow indicator
    const arrowBob = Math.sin(Date.now() * 0.005) * 7;
    ctx.fillStyle = "#4CAF50";
    ctx.font = "bold 24px monospace";
    ctx.fillText("▼", sx + 45, levelEnd.y - 15 + arrowBob);
    ctx.font = "bold 14px monospace";
    ctx.fillText("GOAL!", sx + 45, levelEnd.y - 35 + arrowBob);
}

function drawParticles() {
    for (const p of particles) {
        const alpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.7;
        ctx.beginPath();
        ctx.arc(p.x - camera.x, p.y, p.size * (1 - alpha * 0.3), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawPopups() {
    ctx.textAlign = "center";
    for (const p of popups) {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.font = "bold 22px monospace";
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
}

// ---- Screens ----
function drawStartScreen() {
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    // Office silhouette
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 350, W, 200);
    for (let x = 50; x < W; x += 120) {
        ctx.fillStyle = "#1a2740";
        ctx.fillRect(x, 280, 80, 70);
        ctx.fillStyle = "rgba(255, 200, 100, 0.3)";
        ctx.fillRect(x + 10, 290, 25, 20);
        ctx.fillRect(x + 45, 290, 25, 20);
    }

    // Title
    ctx.fillStyle = "#4CAF50";
    ctx.font = "bold 64px monospace";
    ctx.textAlign = "center";
    ctx.fillText("FARTMAN", W / 2, 140);

    ctx.fillStyle = "#8BC34A";
    ctx.font = "20px monospace";
    ctx.fillText("The Office Stealth Game", W / 2, 175);

    // Gas cloud decorations
    const t = Date.now() * 0.002;
    ctx.fillStyle = "rgba(139, 195, 74, 0.2)";
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(
            W / 2 + Math.sin(t + i * 1.5) * 180,
            200 + Math.cos(t + i * 2) * 30,
            20 + Math.sin(t * 0.5 + i) * 8,
            0, Math.PI * 2
        );
        ctx.fill();
    }

    // Instructions box
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(W / 2 - 220, 220, 440, 160);
    ctx.strokeStyle = "#4CAF50";
    ctx.strokeRect(W / 2 - 220, 220, 440, 160);

    ctx.font = "14px monospace";
    const lines = isTouchDevice ? [
        "Your gas builds up constantly!",
        "HOLD the FART button to release gas.",
        "If you reach 100% you'll have a BIG BLAST!",
        "",
        "♪ Release near noisy distractions! ♪",
        "",
        "If a coworker hears you... GAME OVER!",
        "Reach the RESTROOM to WIN!",
    ] : [
        "Your gas builds up constantly!",
        "HOLD SPACE to slowly release gas.",
        "If you reach 100% you'll have a BIG BLAST!",
        "",
        "♪ Release near noisy distractions! ♪",
        "",
        "If a coworker hears you... GAME OVER!",
        "Reach the RESTROOM to WIN!",
    ];
    lines.forEach((line, i) => {
        ctx.fillStyle = i === 4 ? "#ff8c00" : "#ddd";
        ctx.fillText(line, W / 2, 248 + i * 18);
    });

    if (Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillStyle = "#4CAF50";
        ctx.font = "bold 22px monospace";
        ctx.fillText(isTouchDevice ? "[ Tap to Start ]" : "[ Press ENTER to Start ]", W / 2, 440);
    }

    ctx.fillStyle = "#888";
    ctx.font = "12px monospace";
    ctx.fillText(isTouchDevice ? "◀ ▶ Move  |  HOLD FART = Release Gas" : "← → Move  |  HOLD SPACE = Release Gas", W / 2, 490);
}

function drawGameOverScreen() {
    ctx.fillStyle = "rgba(139, 0, 0, 0.75)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#ff0000";
    ctx.font = "bold 56px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", W / 2, 180);

    ctx.fillStyle = "#ff6666";
    ctx.font = "24px monospace";
    ctx.fillText("Everyone heard that...", W / 2, 230);

    // Embarrassed fartman (bigger)
    ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.arc(W / 2, 310, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4c28a";
    ctx.fillRect(W / 2 - 30, 290, 60, 30);
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(W / 2 - 10, 302, 3, 0, Math.PI * 2);
    ctx.arc(W / 2 + 10, 302, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ddd";
    ctx.font = "16px monospace";
    ctx.fillText("Fartman died of embarrassment!", W / 2, 390);

    if (Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillStyle = "#ff6666";
        ctx.font = "bold 20px monospace";
        ctx.fillText(isTouchDevice ? "[ Tap to Retry ]" : "[ Press ENTER to Retry ]", W / 2, 440);
    }
}

function drawWinScreen() {
    ctx.fillStyle = "rgba(0, 80, 0, 0.85)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#4CAF50";
    ctx.font = "bold 56px monospace";
    ctx.textAlign = "center";
    ctx.fillText("YOU WIN!", W / 2, 160);

    ctx.fillStyle = "#8BC34A";
    ctx.font = "22px monospace";
    ctx.fillText("Fartman made it to the restroom!", W / 2, 210);

    // Stall (bigger)
    ctx.fillStyle = "#8B7355";
    ctx.fillRect(W / 2 - 55, 245, 110, 140);
    ctx.fillStyle = "#a08060";
    ctx.fillRect(W / 2 - 48, 250, 96, 130);
    ctx.fillStyle = "#9B8555";
    ctx.fillRect(W / 2 - 42, 256, 84, 118);
    // Fartman head
    ctx.fillStyle = "#f4c28a";
    ctx.beginPath();
    ctx.arc(W / 2, 250, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(W / 2 - 7, 248, 3, 0, Math.PI * 2);
    ctx.arc(W / 2 + 7, 248, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, 255, 8, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Relief clouds
    ctx.fillStyle = "rgba(139, 195, 74, 0.4)";
    const t2 = Date.now() * 0.003;
    for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc(
            W / 2 + Math.sin(t2 + i) * 80,
            230 + Math.cos(t2 + i * 1.2) * 25 - 30,
            12 + Math.sin(t2 * 0.7 + i) * 6,
            0, Math.PI * 2
        );
        ctx.fill();
    }

    // Score + grade
    const { grade, color: gradeColor } = getGrade(lastScore);
    const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    const pb = parseInt(localStorage.getItem("fartman_best") || "0");
    const isNewBest = lastScore >= pb;

    ctx.font = "bold 48px monospace";
    ctx.fillStyle = gradeColor;
    ctx.fillText(grade, W / 2 - 120, 420);

    ctx.font = "bold 22px monospace";
    ctx.fillStyle = "#fff";
    ctx.fillText(`SCORE: ${lastScore}`, W / 2 + 20, 400);
    ctx.font = "14px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`Time: ${elapsed}s  |  Close calls: ${closeCalls}`, W / 2 + 20, 425);

    if (isNewBest) {
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 16px monospace";
        ctx.fillText("NEW PERSONAL BEST!", W / 2 + 20, 448);
    } else {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "14px monospace";
        ctx.fillText(`Best: ${pb}`, W / 2 + 20, 448);
    }

    if (Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillStyle = "#4CAF50";
        ctx.font = "bold 20px monospace";
        ctx.fillText(isTouchDevice ? "[ Tap for Menu ]" : "[ Press ENTER for Menu ]", W / 2, 490);
    }
}

// ---- Main Loop ----
function gameLoop() {
    ctx.clearRect(0, 0, W, H);

    if (state === "start") {
        drawStartScreen();
    } else if (state === "playing") {
        update();
        ctx.save();
        drawBackground();
        drawPlatforms();
        for (const ns of noiseSources) drawNoiseSource(ns);
        drawLevelEnd();
        for (const cw of coworkers) drawCoworker(cw);
        drawFartman();
        drawParticles();
        ctx.restore();
        drawPopups();
        drawGasBar();
        drawTouchControls();
    } else if (state === "caught") {
        updateCaught();
        ctx.save();
        drawBackground();
        drawPlatforms();
        for (const ns of noiseSources) drawNoiseSource(ns);
        drawLevelEnd();
        for (const cw of coworkers) {
            if (cw.laughing) drawCoworkerLaughing(cw);
            else drawCoworker(cw);
        }
        drawFartmanShame();
        drawParticles();
        ctx.restore();
    } else if (state === "gameover") {
        ctx.save();
        drawBackground();
        drawPlatforms();
        for (const ns of noiseSources) drawNoiseSource(ns);
        drawLevelEnd();
        for (const cw of coworkers) drawCoworker(cw);
        drawFartman();
        drawParticles();
        ctx.restore();
        drawGameOverScreen();
    } else if (state === "win") {
        drawWinScreen();
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
