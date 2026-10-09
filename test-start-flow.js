const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testStartGameFlow() {
  console.log('--- TESTING START GAME FLOW ---');

  // 1. Teacher connects and creates room
  const teacher = io(SERVER_URL);
  const pin = await new Promise(res => {
    teacher.on('room-created', d => res(d.pin));
    teacher.emit('create-room', { guruName: 'Guru Test', isAnonymous: true });
  });
  console.log('1. Room created:', pin);

  // 2. Teacher adds a question
  await new Promise(res => {
    teacher.on('questions-updated', res);
    teacher.emit('add-question', {
      pin,
      question: {
        type: 'mc',
        text: 'Soal 1: Berapa 1+1?',
        options: ['1', '2', '3', '4'],
        correctIndex: 1,
        points: 100
      }
    });
  });
  console.log('2. Question added');

  // 3. Student joins via index.html
  const s_index = io(SERVER_URL);
  const joinData = await new Promise(res => {
    s_index.on('join-success', res);
    s_index.emit('join-room', { pin, nickname: 'Siswa Satu', avatar: '🦁', isAnonymous: true });
  });
  console.log('3. Student joined:', joinData.playerId);
  s_index.disconnect();

  // 4. Student connects game.html
  const s_game = io(SERVER_URL);
  const reconData = await new Promise(res => {
    s_game.on('reconnect-success', res);
    s_game.emit('reconnect-attempt', { pin, playerId: joinData.playerId });
  });
  console.log('4. Student game.html reconnected. Room status:', reconData.roomState.status);

  // 5. Teacher clicks start
  console.log('5. Teacher emits start-game...');
  const studentGameStartedPromise = new Promise((resolve, reject) => {
    s_game.on('game-started', resolve);
    setTimeout(() => reject(new Error('TIMEOUT: student never received game-started!')), 3000);
  });

  const teacherGameStartedPromise = new Promise((resolve, reject) => {
    teacher.on('game-started', resolve);
    teacher.on('error', err => reject(new Error('Teacher error: ' + err.message)));
  });

  teacher.emit('start-game', {
    pin,
    config: {
      timePerQuestion: 30,
      globalTimeLimit: 60,
      enablePenalty: false,
      penaltyPoints: 0
    }
  });

  const [sGameStarted, tGameStarted] = await Promise.all([
    studentGameStartedPromise,
    teacherGameStartedPromise
  ]);

  console.log('6. Student received game-started successfully!');
  console.log('   Boxes:', sGameStarted.boxes);
  console.log('   GlobalEndTime:', sGameStarted.globalEndTime);

  teacher.close();
  s_game.close();
}

testStartGameFlow().catch(console.error);
