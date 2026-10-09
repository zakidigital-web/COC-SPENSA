const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function testTeacherSoloMode() {
  console.log('\n🧪 ========================================================');
  console.log('🧪 PENGUJIAN: MODE MANDIRI GURU & OPERASI KOTAK LANGSUNG');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function testAssert(desc, condition) {
    if (condition) {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ GAGAL: ${desc}`);
      failed++;
    }
  }

  const teacherSocket = io(SERVER_URL);

  try {
    // 1. Create Room by Teacher
    console.log('1. Membuat Room Kuis Baru oleh Guru...');
    const roomCreated = await new Promise((resolve, reject) => {
      teacherSocket.on('room-created', resolve);
      teacherSocket.on('error', reject);
      teacherSocket.emit('create-room', { guruName: 'Pak Budi Guru Mandiri', isAnonymous: true });
    });

    const pin = roomCreated.pin;
    testAssert('Room berhasil dibuat dengan PIN 6-digit', Boolean(pin && pin.length === 6));
    testAssert('Token admin room diterima', Boolean(roomCreated.adminToken));

    // 2. Add Questions
    console.log('\n2. Menambahkan Soal ke Room...');
    const sampleQuestions = [
      {
        id: 'q1',
        type: 'multiple_choice',
        text: 'Berapakah hasil dari 25 x 4?',
        options: ['50', '75', '100', '125'],
        correctAnswer: '100',
        correctIndex: 2,
        points: 150
      },
      {
        id: 'q2',
        type: 'true_false',
        text: 'Air mendidih pada suhu 100 derajat Celcius.',
        correct: true,
        correctAnswer: true,
        points: 100
      },
      {
        id: 'q3',
        type: 'short_answer',
        text: 'Sebutkan ibukota Jawa Barat!',
        correctAnswer: 'Bandung',
        correctText: 'Bandung',
        points: 120
      }
    ];

    await new Promise((resolve) => {
      teacherSocket.on('questions-updated', resolve);
      teacherSocket.emit('update-questions', { pin, questions: sampleQuestions });
    });
    testAssert('3 Soal berhasil disimpan ke dalam room', true);

    // 3. Start Game in Solo Mode (0 Students)
    console.log('\n3. Memulai Game Tanpa Kehadiran Siswa (0 Siswa Joined)...');
    const gameStarted = await new Promise((resolve, reject) => {
      teacherSocket.on('game-started', resolve);
      teacherSocket.on('error', reject);
      teacherSocket.emit('start-game', {
        pin,
        config: { timePerQuestion: 45, globalTimeLimit: 0 },
        questions: sampleQuestions
      });
    });

    testAssert('Game berhasil dimulai dengan 0 siswa (Mode Mandiri)', Boolean(gameStarted && gameStarted.boxes));
    testAssert('Grid memuat tepat 3 kotak soal', gameStarted.boxes.length === 3);

    // 4. Teacher Opens / Claims Box 0
    console.log('\n4. Guru Membuka Kotak #0 Langsung dari Layar Guru...');
    const box0Data = await new Promise((resolve, reject) => {
      teacherSocket.on('admin-box-opened', resolve);
      teacherSocket.on('error', reject);
      teacherSocket.emit('admin-claim-box', { pin, boxIndex: 0 });
    });

    testAssert('Event admin-box-opened diterima oleh socket guru', Boolean(box0Data));
    testAssert('Data soal diterima lengkap termasuk opsi dan poin', box0Data.question && box0Data.question.text);
    testAssert('Kotak bernilai poin yang sesuai', box0Data.points > 0);

    // 5. Teacher Completes Box 0 as Correct (+Poin)
    console.log('\n5. Guru Menandai Kotak #0 Sebagai Jawaban BENAR (✓)...');
    const completeBox0 = await new Promise((resolve) => {
      teacherSocket.on('admin-box-completed', resolve);
      teacherSocket.emit('admin-complete-box', { pin, boxIndex: 0, correct: true, points: box0Data.points });
    });

    testAssert('Kotak #0 berhasil diselesaikan sebagai BENAR', completeBox0.correct === true);
    testAssert('Skor kelas/mandiri bertambah', completeBox0.soloScore === box0Data.points);

    // 5b. Verify Re-opening completed box opens in review mode with answer key
    const reviewBox0 = await new Promise((resolve) => {
      teacherSocket.once('admin-box-opened', resolve);
      teacherSocket.emit('admin-claim-box', { pin, boxIndex: 0 });
    });
    testAssert('Membuka kotak yang sudah selesai menandai alreadyCompleted: true', reviewBox0.alreadyCompleted === true);
    testAssert('Kunci jawaban tetap tersedia saat membuka kotak selesai', Boolean(reviewBox0.question && (reviewBox0.question.correctAnswer || reviewBox0.question.correctIndex !== undefined)));

    // 6. Teacher Claims Box 1, Tests Release Back to Available, Then Re-claims
    console.log('\n6. Guru Membuka Kotak #1, Menguji Batal/Release Kembali ke Pool...');
    const box1Data = await new Promise((resolve) => {
      teacherSocket.once('admin-box-opened', resolve);
      teacherSocket.emit('admin-claim-box', { pin, boxIndex: 1 });
    });
    testAssert('Kotak #1 berhasil dibuka oleh guru', Boolean(box1Data));

    // Release box 1
    const releasePromise = new Promise((resolve) => {
      teacherSocket.once('box-released', resolve);
      teacherSocket.emit('admin-release-box', { pin, boxIndex: 1 });
    });
    const releaseRes = await releasePromise;
    testAssert('Kotak #1 berhasil dibatalkan dan dilepas kembali ke pool (Tersedia)', releaseRes.boxIndex === 1);

    // Re-claim and mark Box 1 as Wrong
    console.log('   -> Guru membuka kembali Kotak #1 dan menandai SALAH...');
    await new Promise((resolve) => {
      teacherSocket.once('admin-box-opened', resolve);
      teacherSocket.emit('admin-claim-box', { pin, boxIndex: 1 });
    });

    const completeBox1 = await new Promise((resolve) => {
      teacherSocket.once('admin-box-completed', resolve);
      teacherSocket.emit('admin-complete-box', { pin, boxIndex: 1, correct: false });
    });
    testAssert('Kotak #1 berhasil ditandai SALAH (0 poin)', completeBox1.correct === false && completeBox1.points === 0);

    // 7. Teacher Completes Box 2, Triggering End of Game
    console.log('\n7. Guru Membuka dan Menyelesaikan Kotak Terakhir (#2)...');
    await new Promise((resolve) => {
      teacherSocket.once('admin-box-opened', resolve);
      teacherSocket.emit('admin-claim-box', { pin, boxIndex: 2 });
    });

    const gameEndedPromise = new Promise((resolve) => {
      teacherSocket.on('game-ended', resolve);
    });

    teacherSocket.emit('admin-complete-box', { pin, boxIndex: 2, correct: true });
    const endedData = await gameEndedPromise;

    testAssert('Game otomatis selesai saat semua kotak terjawab', Boolean(endedData && endedData.results));
    testAssert('Hasil game menandai mode mandiri (isSolo: true)', endedData.results.isSolo === true);
    testAssert('Total skor solo tercatat akurat di rekap hasil', endedData.results.soloScore > 0);
    testAssert('Statistik soal benar tercatat (2 dari 3 soal)', endedData.results.soloCorrectCount === 2);

    teacherSocket.disconnect();

  } catch (err) {
    console.error('Critical Error in testTeacherSoloMode:', err);
    failed++;
    teacherSocket.disconnect();
  }

  console.log('\n========================================================');
  console.log(`🏁 HASIL PENGUJIAN MODE MANDIRI: ${passed} LULUS, ${failed} GAGAL`);
  console.log('========================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testTeacherSoloMode();
