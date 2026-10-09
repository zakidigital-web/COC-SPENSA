const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function runFullGameLifecycleTest() {
  console.log('=== RUNNING FULL GAME LIFECYCLE TEST ===');

  // 1. Teacher creates room
  const teacher = io(SERVER_URL);
  const roomData = await new Promise((resolve, reject) => {
    teacher.on('room-created', resolve);
    teacher.on('error', reject);
    teacher.emit('create-room', { guruName: 'Guru Test', isAnonymous: true });
  });

  const pin = roomData.pin;
  console.log('1. Room created successfully. PIN:', pin);

  // 2. Questions prepared by teacher
  const testQuestions = [
    {
      type: 'mc',
      text: 'Apa ibukota Indonesia?',
      options: ['Jakarta', 'IKN Nusantara', 'Surabaya', 'Bandung'],
      correctIndex: 1,
      points: 100
    },
    {
      type: 'tf',
      text: 'Matahari terbit dari timur.',
      correct: true,
      points: 150
    },
    {
      type: 'short',
      text: '2 + 2 = ?',
      correctText: '4',
      points: 80
    }
  ];

  // Helper to connect a student through index.html -> game.html
  async function connectStudent(name, avatar) {
    const s_index = io(SERVER_URL);
    const joinRes = await new Promise((resolve, reject) => {
      s_index.on('join-success', resolve);
      s_index.on('error', reject);
      s_index.emit('join-room', { pin, nickname: name, avatar, isAnonymous: true });
    });
    s_index.disconnect();

    const s_game = io(SERVER_URL);
    await new Promise((resolve, reject) => {
      s_game.on('reconnect-success', resolve);
      s_game.on('error', reject);
      s_game.emit('reconnect-attempt', { pin, playerId: joinRes.playerId });
    });

    return {
      playerId: joinRes.playerId,
      nickname: name,
      socket: s_game
    };
  }

  // 3. Connect 2 students
  console.log('2. Connecting Student 1 (Rina) and Student 2 (Budi)...');
  const student1 = await connectStudent('Rina', '🦁');
  const student2 = await connectStudent('Budi', '🦅');
  console.log('   Both students successfully in lobby.');

  // 4. Teacher starts game (passing questions directly with start-game)
  console.log('3. Teacher clicks start (emits start-game with questions & config)...');
  const s1StartPromise = new Promise((resolve, reject) => {
    student1.socket.on('game-started', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: Student 1 did not get game-started')), 3000);
  });
  const s2StartPromise = new Promise((resolve, reject) => {
    student2.socket.on('game-started', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: Student 2 did not get game-started')), 3000);
  });
  const teacherStartPromise = new Promise((resolve, reject) => {
    teacher.on('game-started', resolve);
    teacher.on('error', err => reject(new Error('Teacher error: ' + err.message)));
  });

  teacher.emit('start-game', {
    pin,
    config: {
      timePerQuestion: 30,
      globalTimeLimit: 120,
      enablePenalty: false,
      penaltyPoints: 0
    },
    questions: testQuestions
  });

  const [s1Game, s2Game, tGame] = await Promise.all([
    s1StartPromise,
    s2StartPromise,
    teacherStartPromise
  ]);

  console.log('4. All parties received game-started:');
  console.log('   Total boxes:', s1Game.boxes.length);
  assert.strictEqual(s1Game.boxes.length, 3, 'Should have 3 boxes');
  assert.strictEqual(s2Game.boxes.length, 3, 'Student 2 should have 3 boxes');
  assert.strictEqual(tGame.boxes.length, 3, 'Teacher should have 3 boxes');

  // 5. Student 1 claims Box 0
  console.log('5. Student 1 claims Box 0...');
  const s1QuestionPromise = new Promise((resolve, reject) => {
    student1.socket.on('question-data', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: Student 1 did not get question-data')), 3000);
  });
  const s2ClaimPromise = new Promise((resolve, reject) => {
    student2.socket.on('box-claimed', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: Student 2 did not see box-claimed')), 3000);
  });

  student1.socket.emit('claim-box', { pin, boxIndex: 0 });

  const [qData, claimNotification] = await Promise.all([s1QuestionPromise, s2ClaimPromise]);
  console.log('6. Student 1 got question data:', qData.question.text);
  assert.strictEqual(claimNotification.boxIndex, 0);
  assert.strictEqual(claimNotification.playerId, student1.playerId);

  // 6. Student 1 answers the question
  console.log('7. Student 1 submits answer...');
  const answerPromise = new Promise((resolve, reject) => {
    student1.socket.on('answer-result', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: Student 1 did not get answer result')), 3000);
  });
  const boxCompletedPromise = new Promise((resolve, reject) => {
    student2.socket.on('box-completed', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: Student 2 did not get box-completed')), 3000);
  });

  // Answer correctly if MC index 1, or boolean, or text
  let ans = 1;
  if (qData.question.type === 'tf') ans = true;
  if (qData.question.type === 'short') ans = '4';

  student1.socket.emit('submit-answer', { pin, boxIndex: 0, answer: ans });

  const [answerRes, boxComp] = await Promise.all([answerPromise, boxCompletedPromise]);
  console.log('8. Answer processed. Correct:', answerRes.correct, 'Score gained:', answerRes.score);
  assert.strictEqual(boxComp.boxIndex, 0);

  console.log('=== FULL GAME LIFECYCLE TEST PASSED! ===');

  teacher.close();
  student1.socket.close();
  student2.socket.close();
}

runFullGameLifecycleTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
