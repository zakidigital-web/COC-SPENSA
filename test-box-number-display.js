const io = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function runTest() {
    console.log('\n🧪 ========================================================');
    console.log('🧪 PENGUJIAN: TAMPILAN NOMOR URUT KOTAK & OPSI POIN DIAWAL');
    console.log('========================================================\n');

    let adminSocket;
    let studentSocket;
    let pin;

    try {
        // 1. Connect Admin
        adminSocket = io(SERVER_URL, { reconnection: false });
        await new Promise((res, rej) => {
            adminSocket.on('connect', res);
            adminSocket.on('connect_error', rej);
        });

        // 2. Create room
        console.log('1. Membuat Room Kuis Baru...');
        const roomCreated = await new Promise((res) => {
            adminSocket.emit('create-room', {
                adminName: 'Guru Uji',
                config: { timePerQuestion: 30, showPointsInitially: false }
            });
            adminSocket.on('room-created', res);
        });
        pin = roomCreated.pin;
        assert(pin, 'PIN room harus tersedia');
        console.log(`  ✅ Room berhasil dibuat dengan PIN: ${pin}`);

        // 3. Connect Student
        studentSocket = io(SERVER_URL, { reconnection: false });
        await new Promise((res) => studentSocket.on('connect', res));
        await new Promise((res) => {
            studentSocket.emit('join-room', {
                pin,
                nickname: 'Siswa Satu',
                avatar: '🐺'
            });
            studentSocket.on('join-success', res);
        });
        console.log('  ✅ Siswa berhasil bergabung ke room');

        // 4. Add questions
        const questions = [
            { type: 'mc', question: 'Soal Nomor Satu', options: ['A', 'B', 'C', 'D'], answer: 0, points: 150 },
            { type: 'mc', question: 'Soal Nomor Dua', options: ['W', 'X', 'Y', 'Z'], answer: 1, points: 200 }
        ];
        adminSocket.emit('update-questions', { pin, questions });
        await new Promise(r => setTimeout(r, 200));

        // 5. Start game with showPointsInitially = false (Default)
        console.log('\n2. Memulai Game dengan Opsi Poin di Awal = FALSE (Nomor Urut Saja)...');
        const startPromise = new Promise((res) => {
            studentSocket.on('game-started', res);
        });
        adminSocket.emit('start-game', {
            pin,
            config: { showPointsInitially: false },
            questions
        });
        const gameData = await startPromise;
        assert.strictEqual(gameData.config.showPointsInitially, false, 'showPointsInitially harus false');
        assert.strictEqual(gameData.boxes.length, 2, 'Harus ada 2 kotak');
        console.log('  ✅ Event game-started diterima dengan showPointsInitially: false');

        // 6. Test Real-time Toggle config-updated from Teacher
        console.log('\n3. Menguji Live Toggle Guru "Tampilkan Nilai di Kotak" (Real-time Broadcast)...');
        const studentConfigPromise = new Promise((res) => {
            studentSocket.on('config-updated', res);
        });
        adminSocket.emit('update-config', {
            pin,
            config: { showPointsInitially: true }
        });
        const updatedConfig = await studentConfigPromise;
        assert.strictEqual(updatedConfig.config.showPointsInitially, true, 'Siswa harus menerima config-updated dengan showPointsInitially: true');
        console.log('  ✅ Socket siswa berhasil menerima event config-updated: showPointsInitially = true');

        // Toggle back to false
        const studentConfigPromise2 = new Promise((res) => {
            studentSocket.on('config-updated', res);
        });
        adminSocket.emit('update-config', {
            pin,
            config: { showPointsInitially: false }
        });
        const updatedConfig2 = await studentConfigPromise2;
        assert.strictEqual(updatedConfig2.config.showPointsInitially, false, 'showPointsInitially dikembalikan ke false');
        console.log('  ✅ Toggle berhasil dikembalikan ke false (hanya nomor urut)');

        // 7. Test Question Open reveals points
        console.log('\n4. Menguji Poin Terungkap Saat Kotak Dibuka...');
        const qDataPromise = new Promise((res) => {
            studentSocket.on('question-data', res);
        });
        studentSocket.emit('claim-box', { pin, boxIndex: 0 });
        const qData = await qDataPromise;
        assert(qData.points === 150 || qData.points === 200, 'Poin soal harus terungkap saat kotak dibuka');
        console.log(`  ✅ Poin soal (${qData.points} Poin) berhasil terungkap saat nomor dibuka!`);

        console.log('\n========================================================');
        console.log('🏁 SEMUA PENGUJIAN TAMPILAN NOMOR URUT & POIN LULUS! (4/4)');
        console.log('========================================================\n');
        process.exit(0);
    } catch (e) {
        console.error('❌ PENGUJIAN GAGAL:', e);
        process.exit(1);
    } finally {
        if (adminSocket) adminSocket.disconnect();
        if (studentSocket) studentSocket.disconnect();
    }
}

runTest();
