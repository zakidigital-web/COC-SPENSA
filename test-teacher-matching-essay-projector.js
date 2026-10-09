const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function runTests() {
  console.log('\n🧪 ========================================================');
  console.log('🧪 PENGUJIAN: INTERAKSI MENJODOHKAN, ESSAY, & PROYEKTOR GURU');
  console.log('========================================================\n');

  let passed = 0;
  function assert(cond, msg) {
    if (!cond) {
      console.error(`  ❌ GAGAL: ${msg}`);
      process.exit(1);
    }
    console.log(`  ✅ ${msg}`);
    passed++;
  }

  const teacherSocket = io(SERVER_URL);
  await new Promise(r => teacherSocket.once('connect', r));

  // 1. Create Room by Teacher
  console.log('1. Membuat Room Kuis Baru oleh Guru...');
  const roomCreated = await new Promise((resolve, reject) => {
    teacherSocket.on('room-created', resolve);
    teacherSocket.on('error', reject);
    teacherSocket.emit('create-room', { guruName: 'Ibu Guru IPA', isAnonymous: true });
  });

  const pin = roomCreated.pin;
  assert(Boolean(pin && pin.length === 6), `Room berhasil dibuat dengan PIN: ${pin}`);
  assert(Boolean(roomCreated.adminToken), 'Token admin room diterima');

  // 2. Add Questions (Matching & Essay)
  console.log('\n2. Menambahkan Soal Menjodohkan dan Essay ke Room...');
  const sampleQuestions = [
    {
      id: 'q_match_1',
      type: 'matching',
      text: 'Jodohkan nama ibukota dengan negaranya yang tepat!',
      points: 150,
      matchingPairs: [
        { left: 'Indonesia', right: 'Jakarta' },
        { left: 'Jepang', right: 'Tokyo' },
        { left: 'Inggris', right: 'London' }
      ]
    },
    {
      id: 'q_essay_1',
      type: 'essay',
      text: 'Jelaskan secara ringkas proses terjadinya fotosintesis pada tumbuhan hijau!',
      points: 200,
      correctAnswer: 'Proses tumbuhan menggunakan cahaya matahari, air, dan CO2 untuk menghasilkan glukosa dan oksigen.',
      explanation: 'Klorofil menyerap cahaya matahari di dalam kloroplas.'
    }
  ];

  await new Promise((resolve) => {
    teacherSocket.on('questions-updated', resolve);
    teacherSocket.emit('update-questions', { pin, questions: sampleQuestions });
  });
  assert(true, '2 Soal (Menjodohkan & Essay) berhasil ditambahkan ke room');

  // 3. Start Game (Mode Mandiri Guru)
  console.log('\n3. Memulai Game Mandiri Tanpa Kehadiran Siswa...');
  teacherSocket.emit('start-game', { pin });
  const gameStarted = await new Promise(resolve => teacherSocket.on('game-started', resolve));
  assert(gameStarted.boxes.length === 2, 'Game dimulai dengan 2 kotak soal');

  // Process Both Boxes (Box 0 and Box 1)
  let foundMatching = false;
  let foundEssay = false;

  for (let boxIdx = 0; boxIdx < 2; boxIdx++) {
    console.log(`\n4. Guru Membuka Kotak #${boxIdx}...`);
    teacherSocket.emit('admin-claim-box', { pin, boxIndex: boxIdx });

    const openedData = await new Promise(resolve => teacherSocket.once('admin-box-opened', resolve));
    assert(openedData.boxIndex === boxIdx, `Kotak #${boxIdx} berhasil dibuka oleh guru`);
    assert(typeof openedData.points === 'number' && openedData.points > 0, `Poin kotak #${boxIdx} valid (${openedData.points} poin)`);

    const q = openedData.question;
    const isMatch = (q.type || '').toLowerCase().includes('match');
    const isEssay = (q.type || '').toLowerCase().includes('essay') || (q.type || '').toLowerCase().includes('uraian');

    if (isMatch) {
      foundMatching = true;
      console.log(`   -> Terdeteksi sebagai Soal MENJODOHKAN`);
      const pairs = q.matchingPairs || q.pairs;
      assert(Array.isArray(pairs) && pairs.length === 3, 'Soal menjodohkan memuat 3 pasangan lengkap');
      assert(pairs.some(p => p.left === 'Indonesia' && p.right === 'Jakarta'), 'Pasangan terverifikasi akurat (Indonesia ➔ Jakarta)');

      // Complete as correct
      teacherSocket.emit('admin-complete-box', {
        pin,
        boxIndex: boxIdx,
        correct: true,
        points: openedData.points
      });
      const doneData = await new Promise(r => teacherSocket.once('admin-box-completed', r));
      assert(doneData.correct === true, 'Kotak soal menjodohkan berhasil diselesaikan sebagai BENAR');
    } else if (isEssay) {
      foundEssay = true;
      console.log(`   -> Terdeteksi sebagai Soal ESSAY`);
      assert(q.correctAnswer && q.correctAnswer.includes('glukosa'), 'Data kata kunci jawaban essay tersedia lengkap untuk guru');

      // Complete manual as correct
      teacherSocket.emit('admin-complete-box', {
        pin,
        boxIndex: boxIdx,
        correct: true,
        points: openedData.points
      });
      const doneData = await new Promise(r => teacherSocket.once('admin-box-completed', r));
      assert(doneData.correct === true, 'Kotak essay berhasil dinilai manual sebagai BENAR');
    }
  }

  assert(foundMatching, 'Tipe soal Menjodohkan teruji dengan sukses');
  assert(foundEssay, 'Tipe soal Essay teruji dengan sukses');

  teacherSocket.disconnect();

  console.log('\n========================================================');
  console.log(`🏁 SEMUA PENGUJIAN MENJODOHKAN & ESSAY LULUS (${passed} pengujian)!`);
  console.log('========================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
