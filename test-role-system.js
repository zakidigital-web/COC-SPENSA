const http = require('http');
const ioClient = require('socket.io-client');
const AppDatabase = require('./game/Database');

const BASE_URL = 'http://localhost:3000';

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {}
        };

        if (token) {
            options.headers['Authorization'] = 'Bearer ' + token;
        }

        let postData = null;
        if (body) {
            postData = JSON.stringify(body);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = res.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(buffer.toString()), headers: res.headers });
                    } catch (e) {
                        resolve({ status: res.statusCode, raw: buffer.toString(), headers: res.headers });
                    }
                } else {
                    resolve({ status: res.statusCode, buffer, headers: res.headers });
                }
            });
        });

        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('========================================================');
    console.log('🧪 MENJALANKAN PENGUJIAN SISTEM ROLE & FITUR CLASH OF CHAMPION');
    console.log('========================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(desc, condition) {
        if (condition) {
            console.log(`  ✅ ${desc}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${desc}`);
            failed++;
        }
    }

    try {
        // 1. AUTHENTICATION TESTS
        console.log('1. Menguji Endpoint Autentikasi (/api/auth/login)...');
        const adminLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
        assert('Admin berhasil login', adminLogin.status === 200 && adminLogin.data.user.role === 'admin');
        const adminToken = adminLogin.data.token;
        assert('Token otorisasi admin berhasil digenerate', Boolean(adminToken));

        const guruLogin = await request('POST', '/api/auth/login', { username: 'guru', password: 'guru123' });
        assert('Guru berhasil login', guruLogin.status === 200 && guruLogin.data.user.role === 'guru');
        const guruToken = guruLogin.data.token;
        assert('Token otorisasi guru berhasil digenerate', Boolean(guruToken));

        const wrongLogin = await request('POST', '/api/auth/login', { username: 'guru', password: 'wrongpassword' });
        assert('Password salah ditolak dengan 401', wrongLogin.status === 401 && wrongLogin.data.success === false);

        // Verify unauthenticated access to admin endpoint is rejected
        const unauthCheck = await request('GET', '/api/admin/teachers');
        assert('Endpoint admin menolak akses tanpa token otorisasi (401)', unauthCheck.status === 401);

        const studentVerify = await request('POST', '/api/student/verify', { nis: '1001', password: '123' });
        assert('Siswa verifikasi NIS berhasil', studentVerify.status === 200 && studentVerify.data.student.nis === '1001');

        // 2. ADMIN CRUD GURU & SISWA
        console.log('\n2. Menguji Manajemen Akun oleh Super Admin...');
        const uniqueGuruUser = 'test_guru_' + Date.now();
        const createGuru = await request('POST', '/api/admin/teachers', {
            username: uniqueGuruUser,
            password: 'password123',
            name: 'Guru Uji Coba, M.Pd',
            nip: '199001012020',
            subject: 'Fisika'
        }, adminToken);
        assert('Admin berhasil membuat akun guru baru', createGuru.status === 200 && createGuru.data.teacher.username === uniqueGuruUser);
        const testGuruId = createGuru.data.teacher.id;

        const teachersList = await request('GET', '/api/admin/teachers', null, adminToken);
        const foundTeacher = teachersList.data.teachers.some(t => t.id === testGuruId);
        assert('Guru baru muncul di daftar guru', foundTeacher);

        const uniqueSiswa = 'nis_' + Date.now();
        const createStudent = await request('POST', '/api/admin/students', {
            username: uniqueSiswa,
            password: '123',
            name: 'Siswa Uji Coba',
            className: '8-C'
        }, adminToken);
        assert('Admin berhasil mendaftarkan akun siswa baru', createStudent.status === 200 && createStudent.data.student.username === uniqueSiswa);
        const testStudentId = createStudent.data.student.id;

        const bulkRes = await request('POST', '/api/admin/students/bulk', {
            students: [
                { nis: 'bulk_1_' + Date.now(), name: 'Siswa Bulk 1', class: '9A' },
                { nis: 'bulk_2_' + Date.now(), name: 'Siswa Bulk 2', class: '9A' }
            ]
        }, adminToken);
        assert('Admin berhasil import massal siswa', bulkRes.status === 200 && bulkRes.data.createdCount === 2);

        // 3. QUESTION BANK CRUD
        console.log('\n3. Menguji Bank Soal Guru (/api/guru/question-banks)...');
        const sampleQuestions = [
            {
                type: 'multiple_choice',
                text: 'Apa ibukota Indonesia?',
                options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'],
                correctAnswer: 'Jakarta',
                points: 150
            },
            {
                type: 'true_false',
                text: 'Matahari terbit dari timur.',
                correctAnswer: true,
                points: 100
            }
        ];

        const saveBank = await request('POST', '/api/guru/question-banks', {
            guruId: testGuruId,
            title: 'Paket Ujian Fisika 1',
            questions: sampleQuestions
        }, guruToken);
        assert('Guru berhasil menyimpan paket bank soal', saveBank.status === 200 && saveBank.data.id > 0);
        const bankId = saveBank.data.id;

        const listBanks = await request('GET', `/api/guru/question-banks?guruId=${testGuruId}`, null, guruToken);
        assert('Paket soal muncul di daftar bank guru', listBanks.data.banks.some(b => b.id === bankId));

        // 4. MULTIPLAYER WEBSOCKET: ROOM CREATION, KICKING, GAMEPLAY & PERSISTENCE
        console.log('\n4. Menguji Real-Time Sockets: Guru, Siswa, Kick, & DB Session Persistence...');
        
        // Connect Guru Socket
        const guruSocket = ioClient(BASE_URL, { reconnection: false });
        let roomPin = null;

        await new Promise((resolve) => {
            guruSocket.on('connect', () => {
                guruSocket.emit('create-room', {
                    guruId: testGuruId,
                    guruName: 'Guru Uji Coba, M.Pd',
                    isAnonymous: false,
                    title: 'Kuis Evaluasi Fisika'
                });
            });

            guruSocket.on('room-created', (data) => {
                roomPin = data.pin;
                assert('Room dibuat dengan PIN 6-digit', roomPin && roomPin.length === 6);
                assert('Status room bukan anonim', data.isAnonymous === false);
                resolve();
            });
        });

        // Add questions to room
        guruSocket.emit('update-questions', { pin: roomPin, questions: sampleQuestions });
        await wait(200);

        // Connect Student 1 (to be kicked)
        const student1Socket = ioClient(BASE_URL, { reconnection: false });
        let student1Id = null;
        let student1Kicked = false;

        await new Promise((resolve) => {
            student1Socket.emit('join-room', {
                pin: roomPin,
                nickname: 'PemainKasar',
                avatar: '🦁',
                isAnonymous: true
            });

            student1Socket.on('join-success', (data) => {
                student1Id = data.playerId;
                resolve();
            });

            student1Socket.on('kicked', (data) => {
                student1Kicked = true;
            });
        });
        assert('Siswa 1 (Anonim) berhasil join lobby', student1Id !== null);

        // Connect Student 2 (Logged-in Student)
        const student2Socket = ioClient(BASE_URL, { reconnection: false });
        let student2Id = null;

        await new Promise((resolve) => {
            student2Socket.emit('join-room', {
                pin: roomPin,
                nickname: 'Siswa Uji Coba',
                avatar: '🦁',
                studentId: testStudentId,
                studentIdentifier: uniqueSiswa,
                isAnonymous: false
            });

            student2Socket.on('join-success', (data) => {
                student2Id = data.playerId;
                resolve();
            });
        });
        assert('Siswa 2 (Akun Terdaftar) berhasil join lobby', student2Id !== null);

        // Test Guru Kicking Student 1
        console.log('   -> Guru menendang Siswa 1 (PemainKasar)...');
        guruSocket.emit('kick-player', { pin: roomPin, playerId: student1Id });
        await wait(300);
        assert('Siswa 1 menerima event "kicked"', student1Kicked === true);

        // Verify Student 1 is not in room player list
        const roomPlayers = await request('GET', `/api/room/${roomPin}/players`);
        const isS1Present = roomPlayers.data.some(p => p.id === student1Id);
        assert('Siswa 1 berhasil dikeluarkan dari room', isS1Present === false);

        // Start Game
        console.log('   -> Guru memulai permainan...');
        let gameBoxes = [];
        await new Promise((resolve) => {
            student2Socket.on('game-started', (data) => {
                gameBoxes = data.boxes;
                resolve();
            });
            guruSocket.emit('start-game', { pin: roomPin });
        });
        assert('Game berhasil dimulai, boxes diterima', gameBoxes.length === 2);

        // Student 2 claims box 0 and answers correctly
        console.log('   -> Siswa 2 mengklaim dan menjawab kotak 0...');
        let answerResult = null;
        await new Promise((resolve) => {
            student2Socket.on('question-data', (data) => {
                const ans = (data.question.type === 'true_false') ? true : 'Jakarta';
                student2Socket.emit('submit-answer', { pin: roomPin, boxIndex: 0, answer: ans });
            });
            student2Socket.on('answer-result', (res) => {
                answerResult = res;
                resolve();
            });
            student2Socket.emit('claim-box', { pin: roomPin, boxIndex: 0 });
        });
        assert('Siswa 2 menjawab dengan benar dan mendapatkan skor', answerResult && answerResult.correct === true && answerResult.totalPoints > 0);

        // Guru ends game
        console.log('   -> Guru mengakhiri game...');
        let gameEndedData = null;
        await new Promise((resolve) => {
            guruSocket.on('game-ended', (data) => {
                gameEndedData = data;
                resolve();
            });
            guruSocket.emit('end-game', { pin: roomPin });
        });
        assert('Game berhasil diakhiri & event game-ended diterima', gameEndedData !== null);
        assert('Sesi game berhasil disimpan otomatis ke DB (saved=true)', gameEndedData.saved === true && gameEndedData.sessionId);

        // Disconnect sockets
        guruSocket.disconnect();
        student1Socket.disconnect();
        student2Socket.disconnect();

        // 5. VERIFY DATABASE RECORDS & EXCEL EXPORT
        console.log('\n5. Menguji Database Persistensi & Export Excel Nilai...');
        const savedSession = await request('GET', `/api/guru/reports/${gameEndedData.sessionId}`, null, guruToken);
        assert('Data sesi tersimpan lengkap di database', savedSession.status === 200 && savedSession.data.session.pin === roomPin);
        assert('Rekap siswa tercatat di student_records', savedSession.data.session.studentRecords.length > 0);

        const studentRecord = savedSession.data.session.studentRecords[0];
        assert('Nama siswa tersimpan di rapor kuis', studentRecord.student_name === 'Siswa Uji Coba');
        assert('Skor siswa tersimpan di rapor kuis', studentRecord.score > 0);

        // Test Student Profile History
        const studentHistory = await request('GET', `/api/student/history/${uniqueSiswa}`);
        assert('Siswa bisa melihat riwayat kuis mereka via NIS', studentHistory.data.records.length > 0);

        // Test Excel Export
        const excelResp = await request('GET', `/api/guru/reports/${gameEndedData.sessionId}/export-excel`, null, guruToken);
        assert('Export Excel menghasilkan file valid (.xlsx)', excelResp.status === 200 && excelResp.buffer.length > 1000);

        // Clean up test users
        AppDatabase.deleteUser(testGuruId);
        AppDatabase.deleteUser(testStudentId);

    } catch (err) {
        console.error('CRITICAL TEST ERROR:', err);
        failed++;
    }

    console.log('\n========================================================');
    console.log(`🏁 HASIL PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
    console.log('========================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
