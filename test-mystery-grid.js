const assert = require('assert');
const http = require('http');
const io = require('socket.io-client');
const Database = require('./game/Database');
const RoomManager = require('./game/RoomManager');
const GameEngine = require('./game/GameEngine');

const TEST_PORT = 3000;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

async function runTests() {
  console.log('\n🧪 ========================================================');
  console.log('🧪 PENGUJIAN: GRID SOAL MUDAH DI CEK & MODE NILAI ACAK / MISTERI');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. UNIT TEST: GameEngine Mystery Points & Sanitization
  console.log('1. Menguji Logika GameEngine untuk Mode Mystery Points...');
  const fakeIo = {
    to: () => ({ emit: () => {} }),
    emit: () => {}
  };
  const roomManager = new RoomManager();
  const gameEngine = new GameEngine(fakeIo, roomManager);

  const { room, pin } = roomManager.createRoom('fake-socket-id', 50);

  const mockQuestions = [
    { text: 'Apa ibukota Indonesia?', type: 'mc', options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], correctAnswer: 0, points: 100 },
    { text: 'Matahari terbit dari barat.', type: 'tf', correctAnswer: false, points: 100 },
    { text: 'Sebutkan warna bendera Indonesia merah dan apa?', type: 'short', correctAnswer: 'putih', points: 100 }
  ];

  room.questions = mockQuestions;
  room.config = {
    timePerQuestion: 20,
    mysteryPoints: true,
    randomizeMystery: true
  };

  const clientBoxes = gameEngine.startGame(pin, 'fake-socket-id', room.config);

  test('Mode kuis terdeteksi sebagai mysteryPoints', () => {
    assert.strictEqual(room.config.mysteryPoints, true);
  });

  test('Kotak-kotak soal yang dikirim ke siswa memiliki points = "?"', () => {
    assert.strictEqual(clientBoxes.length, 3);
    clientBoxes.forEach(b => {
      assert.strictEqual(b.points, '?', `Poin harus disembunyikan sebagai '?' tapi ditemukan: ${b.points}`);
      assert.strictEqual(b.mystery, true);
    });
  });

  test('GameEngine internal menyimpan poin acak valid (50 - 300) untuk setiap kotak', () => {
    const validMystery = [50, 75, 100, 150, 200, 250, 300];
    room.boxes.forEach(b => {
      assert(typeof b.points === 'number', 'Poin internal harus angka');
      assert(validMystery.includes(b.points), `Poin ${b.points} tidak valid dalam daftar mystery values`);
      assert.strictEqual(b.isMystery, true);
    });
  });

  // 2. UNIT TEST: Admin Inspection Data
  console.log('\n2. Menguji Admin Inspection Data (Grid Soal Mudah Dicek)...');
  const inspection = gameEngine.getAdminBoxesInspection(pin);

  test('Admin inspection menghasilkan data lengkap untuk seluruh kotak', () => {
    assert.strictEqual(inspection.length, 3);
  });

  test('Admin dapat melihat teks soal, cuplikan, tipe, dan kunci jawaban', () => {
    const first = inspection[0];
    assert(first.questionText && first.questionText.length > 0, 'Harus memuat teks soal');
    assert(first.questionSnippet && first.questionSnippet.length > 0, 'Harus memuat cuplikan soal');
    assert(first.questionType, 'Harus memuat tipe soal');
    assert(first.correctAnswer !== undefined, 'Harus memuat kunci jawaban');
  });

  test('Admin dapat melihat poin asli angka meskipun mode misteri aktif', () => {
    inspection.forEach(b => {
      assert(typeof b.points === 'number', 'Poin di layar admin harus berupa angka asli');
      assert(b.points >= 50 && b.points <= 300);
      assert.strictEqual(b.isMystery, true);
    });
  });

  // 3. INTEGRATION TEST: Socket Flow with Real Server
  console.log('\n3. Menguji Integrasi Real-Time Socket (Mystery Reveal & Grid Updates)...');

  const adminSocket = io(SERVER_URL, { reconnection: false });
  const studentSocket = io(SERVER_URL, { reconnection: false });

  await new Promise(r => setTimeout(r, 600));

  let realPin = null;
  let teacherOpenedData = null;
  let studentQuestionData = null;
  let boxCompletedData = null;
  let adminInspectionReceived = null;

  try {
    // A. Guru membuat room
    const roomCreated = await new Promise((resolve, reject) => {
      adminSocket.once('room-created', resolve);
      adminSocket.once('error', reject);
      adminSocket.emit('create-room', { guruName: 'Pak Guru Cekatan', isAnonymous: true });
    });

    realPin = roomCreated.pin;

    adminSocket.on('admin-inspection-data', (data) => {
      adminInspectionReceived = data;
    });

    // Siswa join
    studentSocket.emit('join-room', {
      pin: realPin,
      nickname: 'BudiSiswa',
      avatar: '🦊'
    });

    await new Promise(r => setTimeout(r, 400));

    // B. Start game dengan mystery mode
    const testQuestions = [
      { id: 'q1', text: 'Berapa hasil 15 x 4?', type: 'mc', options: ['50', '60', '70', '80'], correctAnswer: 1, points: 100 },
      { id: 'q2', text: 'Air mendidih pada suhu 100 derajat celcius.', type: 'tf', correctAnswer: true, points: 100 },
      { id: 'q3', text: 'Ibukota Jepang adalah Tokyo.', type: 'tf', correctAnswer: true, points: 100 }
    ];

    let gameStartedData = null;
    studentSocket.on('game-started', (data) => {
      gameStartedData = data;
    });

    studentSocket.on('question-data', (data) => {
      studentQuestionData = data;
    });

    studentSocket.on('box-completed', (data) => {
      boxCompletedData = data;
    });

    adminSocket.emit('start-game', {
      pin: realPin,
      config: {
        mysteryPoints: true,
        randomizeMystery: true,
        timePerQuestion: 25
      },
      questions: testQuestions
    });

    await new Promise(r => setTimeout(r, 600));

    test('Event game-started mengirim kotak misteri ("?") ke socket siswa', () => {
      assert(gameStartedData && gameStartedData.boxes, 'Data game-started harus diterima');
      assert.strictEqual(gameStartedData.boxes.length, 3);
      assert.strictEqual(gameStartedData.boxes[0].points, '?');
    });

    test('Admin langsung menerima event admin-inspection-data saat game dimulai', () => {
      assert(adminInspectionReceived && Array.isArray(adminInspectionReceived.boxes));
      assert.strictEqual(adminInspectionReceived.boxes.length, 3);
      assert.strictEqual(adminInspectionReceived.boxes[0].status, 'available');
      assert(typeof adminInspectionReceived.boxes[0].points === 'number');
    });

    // C. Siswa mengklaim kotak 0
    studentSocket.emit('claim-box', { pin: realPin, boxIndex: 0 });
    await new Promise(r => setTimeout(r, 600));

    test('Siswa menerima event question-data dengan poin asli dan isMystery=true', () => {
      assert(studentQuestionData, 'question-data harus diterima');
      assert.strictEqual(studentQuestionData.boxIndex, 0);
      assert(typeof studentQuestionData.points === 'number', 'Poin harus diungkap ke siswa saat mengerjakan');
      assert.strictEqual(studentQuestionData.isMystery, true);
    });

    test('Admin inspection data terupdate menampilkan status locked oleh siswa', () => {
      assert(adminInspectionReceived);
      const b0 = adminInspectionReceived.boxes.find(b => b.index === 0);
      assert(b0, 'Kotak 0 harus ditemukan');
      assert.strictEqual(b0.status, 'locked');
      assert.strictEqual(b0.lockedByName, 'BudiSiswa');
    });

    // D. Siswa menjawab soal
    studentSocket.emit('submit-answer', {
      pin: realPin,
      boxIndex: 0,
      answer: studentQuestionData.question.options ? 1 : true
    });
    await new Promise(r => setTimeout(r, 600));

    test('Event box-completed mengumumkan poin yang terungkap ke seluruh siswa', () => {
      assert(boxCompletedData, 'box-completed harus diterima');
      assert.strictEqual(boxCompletedData.boxIndex, 0);
      assert(typeof boxCompletedData.points === 'number', 'Poin harus diumumkan');
      assert(boxCompletedData.points >= 50 && boxCompletedData.points <= 300);
      assert(boxCompletedData.box && typeof boxCompletedData.box.points === 'number');
    });

    test('Admin inspection data menandai kotak 0 selesai dan tercatat di rekapan', () => {
      assert(adminInspectionReceived);
      const b0 = adminInspectionReceived.boxes.find(b => b.index === 0);
      assert.strictEqual(b0.status, 'completed');
    });

  } finally {
    adminSocket.disconnect();
    studentSocket.disconnect();
  }

  console.log('\n========================================================');
  console.log(`🏁 HASIL PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
  console.log('========================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
