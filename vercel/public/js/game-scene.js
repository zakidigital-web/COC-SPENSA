/**
 * Clash of Champion - In-Game 3D Bright & Cheerful Arena (Three.js)
 * Didesain khusus untuk siswa SD - SMP: Cerah, Ceria, Arena Kompetisi Penuh Semangat,
 * Pesta Konfeti Meriah saat Jawaban Benar, Efek Bintang Kombo Pelangi, dan Minim Beban GPU!
 */
(function() {
    function isWebGLAvailable() {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    }

    if (!isWebGLAvailable() || typeof THREE === 'undefined') {
        console.log('[ThreeJS Game Arena] WebGL not available or Three.js missing.');
        window.game3D = {
            triggerCorrect: () => {},
            triggerWrong: () => {},
            triggerCombo: () => {},
            triggerClaim: () => {},
            triggerEmote: () => {},
            triggerGameStart: () => {},
            triggerBoxCompleted: () => {}
        };
        return;
    }

    const container = document.getElementById('game-three-canvas');
    if (!container) return;

    try {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1e3a8a, 0.0018);

    const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 16, 78);
    camera.lookAt(0, 2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x0f172a, 0.7); // Transparan lembut menyatu dengan arena
    container.appendChild(renderer.domElement);

    // 2. Pencahayaan Stadion Ceria
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const mainSun = new THREE.DirectionalLight(0xfffbeb, 1.6);
    mainSun.position.set(20, 60, 40);
    scene.add(mainSun);

    const arenaGoldLight = new THREE.PointLight(0xfbbf24, 2.5, 220);
    arenaGoldLight.position.set(30, 35, 20);
    scene.add(arenaGoldLight);

    const arenaBlueLight = new THREE.PointLight(0x38bdf8, 2.5, 220);
    arenaBlueLight.position.set(-30, 35, 20);
    scene.add(arenaBlueLight);

    // 3. Lantai Grid Arena Ceria
    const gridHelper = new THREE.GridHelper(220, 32, 0xfbbf24, 0x60a5fa);
    gridHelper.position.y = -22;
    gridHelper.material.opacity = 0.35;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // 4. Pilar Kristal Warna-Warni di Sudut Arena
    const pillarsGroup = new THREE.Group();
    scene.add(pillarsGroup);

    const pGeom = new THREE.OctahedronGeometry(6, 0);
    const pMatGold = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        metalness: 0.3,
        roughness: 0.2,
        emissive: 0xd97706,
        emissiveIntensity: 0.5
    });
    const pMatCyan = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.3,
        roughness: 0.2,
        emissive: 0x0284c7,
        emissiveIntensity: 0.5
    });
    const pMatPink = new THREE.MeshStandardMaterial({
        color: 0xf43f5e,
        metalness: 0.3,
        roughness: 0.2,
        emissive: 0xbe123c,
        emissiveIntensity: 0.5
    });
    const pMatEmerald = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        metalness: 0.3,
        roughness: 0.2,
        emissive: 0x047857,
        emissiveIntensity: 0.5
    });

    const pillarConfigs = [
        [-52, 10, -25, pMatGold],
        [52, 10, -25, pMatCyan],
        [-58, -12, -5, pMatPink],
        [58, -12, -5, pMatEmerald],
        [0, 32, -35, pMatGold]
    ];

    const pillars = [];
    pillarConfigs.forEach(([x, y, z, mat]) => {
        const mesh = new THREE.Mesh(pGeom, mat);
        mesh.position.set(x, y, z);
        
        // Bingkai kilau luar
        const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.4 });
        const wire = new THREE.Mesh(pGeom, wireMat);
        wire.scale.set(1.1, 1.1, 1.1);
        mesh.add(wire);

        pillarsGroup.add(mesh);
        pillars.push({ mesh, rotSpeed: 0.012 + Math.random() * 0.008 });
    });

    // 5. Partikel Konfeti Pesta (*Confetti & Party Celebration Cannon*)
    const MAX_CONFETTI = 300;
    const confettiGeom = new THREE.BufferGeometry();
    const confettiPos = new Float32Array(MAX_CONFETTI * 3);
    const confettiVel = new Float32Array(MAX_CONFETTI * 3);
    const confettiCol = new Float32Array(MAX_CONFETTI * 3);
    const confettiLife = new Float32Array(MAX_CONFETTI);

    const confettiPalette = [
        new THREE.Color(0xffbe0b), // Kuning Terang
        new THREE.Color(0xff006e), // Merah Muda Ceria
        new THREE.Color(0x3a86ff), // Biru Langit
        new THREE.Color(0x06d6a0), // Hijau Mint
        new THREE.Color(0xfb5607), // Oranye Segar
        new THREE.Color(0xffffff)  // Putih Kilau
    ];

    for (let i = 0; i < MAX_CONFETTI; i++) {
        confettiPos[i * 3] = 0;
        confettiPos[i * 3 + 1] = -999;
        confettiPos[i * 3 + 2] = 0;
        confettiLife[i] = 0;

        const c = confettiPalette[i % confettiPalette.length];
        confettiCol[i * 3] = c.r;
        confettiCol[i * 3 + 1] = c.g;
        confettiCol[i * 3 + 2] = c.b;
    }

    confettiGeom.setAttribute('position', new THREE.BufferAttribute(confettiPos, 3));
    confettiGeom.setAttribute('color', new THREE.BufferAttribute(confettiCol, 3));

    // Tekstur konfeti persegi ceria
    const cCanvas = document.createElement('canvas');
    cCanvas.width = 16;
    cCanvas.height = 16;
    const cCtx = cCanvas.getContext('2d');
    cCtx.fillStyle = '#ffffff';
    cCtx.fillRect(2, 2, 12, 12);
    const cTexture = new THREE.CanvasTexture(cCanvas);

    const confettiMat = new THREE.PointsMaterial({
        size: 3.5,
        vertexColors: true,
        map: cTexture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
    });

    const confettiSystem = new THREE.Points(confettiGeom, confettiMat);
    scene.add(confettiSystem);

    // 6. Gelombang Getaran Kamera Halus
    let cameraShake = 0;
    let cameraBaseY = 16;

    // 7. PUBLIC INTERACTIVE TRIGGERS
    window.game3D = {
        /**
         * Pesta Konfeti Meriah saat Jawaban Benar!
         */
        triggerCorrect: function(points = 100) {
            let spawned = 0;
            const targetCount = 75;

            for (let i = 0; i < MAX_CONFETTI && spawned < targetCount; i++) {
                if (confettiLife[i] <= 0) {
                    confettiLife[i] = 1.0;
                    // Titik ledakan dari bawah layar melesat ke atas seperti kembang api
                    confettiPos[i * 3] = (Math.random() - 0.5) * 30;
                    confettiPos[i * 3 + 1] = -12;
                    confettiPos[i * 3 + 2] = 20 + (Math.random() - 0.5) * 20;

                    // Kecepatan melesat ke atas + menyebar
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 18 + Math.random() * 22;
                    confettiVel[i * 3] = Math.cos(angle) * (speed * 0.45);
                    confettiVel[i * 3 + 1] = speed;
                    confettiVel[i * 3 + 2] = Math.sin(angle) * (speed * 0.35);

                    spawned++;
                }
            }

            // Kilatan cahaya gembira
            arenaGoldLight.intensity = 4.5;
            setTimeout(() => { arenaGoldLight.intensity = 2.5; }, 400);
        },

        /**
         * Efek Kartun Ramah saat Jawaban Salah (bukan menakutkan, tapi lucu & memotivasi)
         */
        triggerWrong: function() {
            cameraShake = 0.8;
            arenaBlueLight.color.setHex(0xf43f5e);
            setTimeout(() => { arenaBlueLight.color.setHex(0x38bdf8); }, 500);
        },

        /**
         * Tornado Bintang Kombo Pelangi
         */
        triggerCombo: function(streak = 2) {
            let spawned = 0;
            const count = Math.min(50, streak * 15);
            for (let i = 0; i < MAX_CONFETTI && spawned < count; i++) {
                if (confettiLife[i] <= 0) {
                    confettiLife[i] = 1.2;
                    const theta = (spawned / count) * Math.PI * 2;
                    const r = 24;
                    confettiPos[i * 3] = Math.cos(theta) * r;
                    confettiPos[i * 3 + 1] = -5;
                    confettiPos[i * 3 + 2] = Math.sin(theta) * r + 15;

                    confettiVel[i * 3] = -Math.sin(theta) * 12;
                    confettiVel[i * 3 + 1] = 14 + Math.random() * 8;
                    confettiVel[i * 3 + 2] = Math.cos(theta) * 12;
                    spawned++;
                }
            }
        },

        /**
         * Denyut Riang saat Kotak Diklaim
         */
        triggerClaim: function(boxIndex, isMe) {
            arenaGoldLight.position.x = ((boxIndex % 8) - 4) * 8;
            arenaGoldLight.intensity = isMe ? 4.0 : 2.8;
            setTimeout(() => { arenaGoldLight.intensity = 2.5; }, 300);
        },

        /**
         * Gelembung Emote Ceria
         */
        triggerEmote: function(emote) {
            let spawned = 0;
            for (let i = 0; i < MAX_CONFETTI && spawned < 20; i++) {
                if (confettiLife[i] <= 0) {
                    confettiLife[i] = 0.9;
                    confettiPos[i * 3] = (Math.random() - 0.5) * 15;
                    confettiPos[i * 3 + 1] = -15;
                    confettiPos[i * 3 + 2] = 30;

                    confettiVel[i * 3] = (Math.random() - 0.5) * 8;
                    confettiVel[i * 3 + 1] = 16 + Math.random() * 10;
                    confettiVel[i * 3 + 2] = (Math.random() - 0.5) * 6;
                    spawned++;
                }
            }
        },

        /**
         * Transisi Mulai Game: Zoom-in Semangat
         */
        triggerGameStart: function() {
            camera.position.z = 120;
            const zoomIn = () => {
                if (camera.position.z > 78) {
                    camera.position.z -= 2.2;
                    requestAnimationFrame(zoomIn);
                } else {
                    camera.position.z = 78;
                }
            };
            zoomIn();
            this.triggerCorrect(200); // Semburan sambutan di awal kuis!
        }
    };

    // 8. Responsive Window Resize & Auto-Pause
    let isVisible = true;
    document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 9. Render & Physics Loop
    let clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);
        if (!isVisible) return;

        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        // Putar Pilar Kristal
        pillars.forEach(p => {
            p.mesh.rotation.y += p.rotSpeed;
            p.mesh.rotation.x = Math.sin(time * 1.5) * 0.15;
        });

        // Update Fisika Konfeti Ceria (Meluncur, Melayang, & Jatuh Halus)
        let posChanged = false;
        const posAttr = confettiGeom.attributes.position;
        const gravity = -18 * delta;

        for (let i = 0; i < MAX_CONFETTI; i++) {
            if (confettiLife[i] > 0) {
                confettiLife[i] -= delta * 0.5;

                // Kecepatan + Gravitasi
                confettiVel[i * 3 + 1] += gravity;
                confettiPos[i * 3] += confettiVel[i * 3] * delta;
                confettiPos[i * 3 + 1] += confettiVel[i * 3 + 1] * delta;
                confettiPos[i * 3 + 2] += confettiVel[i * 3 + 2] * delta;

                // Hambatan udara ringan (flutter effect)
                confettiVel[i * 3] *= 0.98;
                confettiVel[i * 3 + 2] *= 0.98;

                posChanged = true;
                if (confettiLife[i] <= 0 || confettiPos[i * 3 + 1] < -25) {
                    confettiLife[i] = 0;
                    confettiPos[i * 3 + 1] = -999;
                }
            }
        }

        if (posChanged) {
            posAttr.needsUpdate = true;
        }

        // Kamera Shake ramah kartun
        if (cameraShake > 0) {
            camera.position.x = (Math.random() - 0.5) * cameraShake * 2;
            camera.position.y = cameraBaseY + (Math.random() - 0.5) * cameraShake * 2;
            cameraShake -= delta * 2.5;
            if (cameraShake < 0) cameraShake = 0;
        } else {
            camera.position.x = Math.sin(time * 0.4) * 2;
            camera.position.y = cameraBaseY + Math.cos(time * 0.3) * 1.5;
        }
        camera.lookAt(0, 2, 0);

        renderer.render(scene, camera);
    }

    animate();
    console.log('⚔️ Clash of Champion - 3D Bright & Cheerful Battle Arena initialized!');
    } catch (e) {
        console.warn('[ThreeJS Game Arena] Error during 3D setup, falling back to 2D mode:', e);
        window.game3D = {
            triggerCorrect: () => {},
            triggerWrong: () => {},
            triggerCombo: () => {},
            triggerClaim: () => {},
            triggerEmote: () => {},
            triggerGameStart: () => {},
            triggerBoxCompleted: () => {}
        };
    }
})();
