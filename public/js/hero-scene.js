/**
 * Clash of Champion - Three.js 3D Bright & Cheerful Hero Experience
 * Didesain khusus untuk siswa SD - SMP: Cerah, Ceria, Bintang Juara 3D,
 * Kristal Berwarna-Warni, dan Partikel Stardust Pelangi Ceria!
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
        console.log('[ThreeJS Hero] WebGL not available or Three.js missing, using fallback.');
        return;
    }

    const container = document.getElementById('three-bg-canvas');
    if (!container) return;

    // 1. Scene, Camera, Renderer (Cerah & Transparan menyatu dengan gradien langit ceria)
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1d4ed8, 0.0015);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 85;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0); // 100% transparan agar gradien cerah CSS tembus
    container.appendChild(renderer.domElement);

    // 2. Pencahayaan Ceria (Hangat, Bersinar, dan Berwarna-warni)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff3b0, 1.8);
    sunLight.position.set(50, 60, 50);
    scene.add(sunLight);

    const pinkLight = new THREE.PointLight(0xff69b4, 2.0, 180);
    pinkLight.position.set(-40, 30, 30);
    scene.add(pinkLight);

    const cyanLight = new THREE.PointLight(0x38bdf8, 2.2, 180);
    cyanLight.position.set(40, -30, 40);
    scene.add(cyanLight);

    const goldLight = new THREE.PointLight(0xfbbf24, 2.5, 200);
    goldLight.position.set(0, 50, 20);
    scene.add(goldLight);

    // 3. Objek 3D Ceria: Bintang Emas 3D, Kristal Permata, & Koin Keberuntungan
    const objectsGroup = new THREE.Group();
    scene.add(objectsGroup);

    // Helper membuat Geometri Bintang 5 Sudut 3D
    function createStarGeometry(innerRadius, outerRadius, thickness) {
        const shape = new THREE.Shape();
        const points = 5;
        for (let i = 0; i < points * 2; i++) {
            const r = (i % 2 === 0) ? outerRadius : innerRadius;
            const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (i === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
        }
        shape.closePath();
        return new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSegments: 2,
            steps: 1,
            bevelSize: 0.6,
            bevelThickness: 0.6
        });
    }

    const starGeom = createStarGeometry(2.4, 5.2, 1.8);
    const gemGeometries = [
        starGeom,
        new THREE.OctahedronGeometry(5.2, 0),
        new THREE.IcosahedronGeometry(4.8, 0),
        new THREE.DodecahedronGeometry(4.6, 0),
        new THREE.CylinderGeometry(4.5, 4.5, 1.6, 16) // Koin Emas
    ];

    // Warna-warni ceria anak-anak (Kids/Youth Friendly: Kuning Emas, Permata Biru, Zamrud Hijau, Permata Merah Muda, Oranye)
    const cheerfulMaterials = [
        new THREE.MeshStandardMaterial({
            color: 0xffbe0b, // Sunshine Gold
            metalness: 0.35,
            roughness: 0.25,
            emissive: 0xffaa00,
            emissiveIntensity: 0.45
        }),
        new THREE.MeshStandardMaterial({
            color: 0x38bdf8, // Sky Cyan
            metalness: 0.3,
            roughness: 0.2,
            emissive: 0x0284c7,
            emissiveIntensity: 0.4
        }),
        new THREE.MeshStandardMaterial({
            color: 0xf43f5e, // Candy Coral/Pink
            metalness: 0.25,
            roughness: 0.3,
            emissive: 0xbe123c,
            emissiveIntensity: 0.35
        }),
        new THREE.MeshStandardMaterial({
            color: 0x10b981, // Mint Emerald
            metalness: 0.3,
            roughness: 0.25,
            emissive: 0x047857,
            emissiveIntensity: 0.4
        }),
        new THREE.MeshStandardMaterial({
            color: 0xa855f7, // Magic Violet
            metalness: 0.35,
            roughness: 0.2,
            emissive: 0x7e22ce,
            emissiveIntensity: 0.4
        })
    ];

    const floatingObjects = [];
    const count = 14;

    for (let i = 0; i < count; i++) {
        const geom = gemGeometries[i % gemGeometries.length];
        const mat = cheerfulMaterials[i % cheerfulMaterials.length].clone();
        const mesh = new THREE.Mesh(geom, mat);

        // Tambahkan bingkai kilau putih lembut pada tiap objek
        const wireMat = new THREE.MeshBasicMaterial({
            color: (i % 2 === 0) ? 0xffffff : 0xfef08a,
            wireframe: true,
            transparent: true,
            opacity: 0.35
        });
        const wireMesh = new THREE.Mesh(geom, wireMat);
        wireMesh.scale.set(1.08, 1.08, 1.08);
        mesh.add(wireMesh);

        // Sebar objek di sekitar kanvas hero
        const angle = (i / count) * Math.PI * 2;
        const radius = 40 + Math.random() * 40;
        const x = Math.cos(angle) * radius + (Math.random() - 0.5) * 20;
        const y = (Math.random() - 0.5) * 55;
        const z = (Math.random() - 0.5) * 40 - 5;

        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

        floatingObjects.push({
            mesh,
            initialY: y,
            speedRotX: (Math.random() - 0.5) * 0.016 + 0.008,
            speedRotY: (Math.random() - 0.5) * 0.02 + 0.01,
            speedRotZ: (Math.random() - 0.5) * 0.012,
            floatSpeed: 0.0015 + Math.random() * 0.002,
            floatDistance: 4 + Math.random() * 5,
            phase: Math.random() * Math.PI * 2,
            scaleMultiplier: 1.0
        });

        objectsGroup.add(mesh);
    }

    // 4. Partikel Bintang Ceria (Stardust Rainbow Confetti Sparks)
    const particleCount = 1200;
    const particleGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const rainbowPalette = [
        new THREE.Color(0xffbe0b), // Sunny Gold
        new THREE.Color(0xffffff), // Pure Sparkle White
        new THREE.Color(0x38bdf8), // Sky Blue
        new THREE.Color(0xf472b6), // Soft Pink
        new THREE.Color(0x4ade80), // Lime Green
        new THREE.Color(0xfb923c)  // Orange Spark
    ];

    for (let i = 0; i < particleCount; i++) {
        const r = Math.random() * 120 + 8;
        const theta = Math.random() * Math.PI * 2;
        const spread = (Math.random() - 0.5) * 60;

        positions[i * 3] = Math.cos(theta) * r;
        positions[i * 3 + 1] = spread + Math.sin(r * 0.08) * 12;
        positions[i * 3 + 2] = Math.sin(theta) * r * 0.7 - 15;

        const color = rainbowPalette[Math.floor(Math.random() * rainbowPalette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Tekstur bulat lembut bersinar
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 32;
    pCanvas.height = 32;
    const pCtx = pCanvas.getContext('2d');
    const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,230,100,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, 32, 32);

    const pTexture = new THREE.CanvasTexture(pCanvas);

    const particleMaterial = new THREE.PointsMaterial({
        size: 2.2,
        vertexColors: true,
        map: pTexture,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const particleSystem = new THREE.Points(particleGeom, particleMaterial);
    scene.add(particleSystem);

    // 5. Interaksi Mouse & Gerakan Parallax Memantul (Bouncy Parallax)
    let mouseX = 0;
    let mouseY = 0;
    let targetCameraX = 0;
    let targetCameraY = 0;

    window.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    window.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            mouseX = (e.touches[0].clientX / window.innerWidth - 0.5) * 2;
            mouseY = (e.touches[0].clientY / window.innerHeight - 0.5) * 2;
        }
    }, { passive: true });

    // Efek Sentuh / Klik: Objek memantul riang (*joyful spin burst*)
    window.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'A') return;
        floatingObjects.forEach(obj => {
            obj.speedRotY += (Math.random() * 0.05 + 0.03);
            obj.mesh.scale.set(1.2, 1.2, 1.2);
            setTimeout(() => {
                obj.mesh.scale.set(1.0, 1.0, 1.0);
            }, 300);
        });
    });

    // 6. Responsive Resize & Pause on Inactive Tab
    let isVisible = true;
    document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 7. Animation Loop
    let clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);
        if (!isVisible) return;

        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        // Parallax Kamera Halus & Ceria
        targetCameraX = mouseX * 12;
        targetCameraY = -mouseY * 8;
        camera.position.x += (targetCameraX - camera.position.x) * 0.04;
        camera.position.y += (targetCameraY - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);

        // Putar Stardust Galaxy
        particleSystem.rotation.y = time * 0.035;
        particleSystem.rotation.x = Math.sin(time * 0.02) * 0.08;

        // Gerakkan Bintang & Permata (Melayang Riang & Berputar)
        floatingObjects.forEach(obj => {
            obj.mesh.rotation.x += obj.speedRotX;
            obj.mesh.rotation.y += obj.speedRotY;
            obj.mesh.rotation.z += obj.speedRotZ;

            // Gerakan mengambang naik-turun elastis
            obj.mesh.position.y = obj.initialY + Math.sin(time * obj.floatSpeed * 1000 + obj.phase) * obj.floatDistance;

            // Redam rotasi kembali normal
            if (Math.abs(obj.speedRotY) > 0.02) {
                obj.speedRotY *= 0.98;
            }
        });

        // Efek denyut lampu emas
        goldLight.intensity = 2.2 + Math.sin(time * 2.5) * 0.6;
        pinkLight.intensity = 1.8 + Math.cos(time * 2.0) * 0.4;

        renderer.render(scene, camera);
    }

    animate();
    console.log('✨ Clash of Champion - 3D Bright & Cheerful Hero Wonderland initialized!');
})();
