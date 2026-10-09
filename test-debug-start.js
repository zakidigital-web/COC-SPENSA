const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function debugStartGameFlow() {
  console.log('=== DEBUG: WHY STUDENT STAYS ON WAITING ROOM ===\n');

  // 1. Teacher creates room
  const teacher = io(SERVER_URL);
  teacher.on('error', (err) => console.log('  [TEACHER ERROR]', err));

  const roomData = await new Promise(res => {
    teacher.on('room-created', res);
    teacher.emit('create-room', { guruName: 'Bu Guru', isAnonymous: true });
  });
  const pin = roomData.pin;
  console.log('1. Room created. PIN:', pin);

  // 2. Teacher adds questions one-by-one (like clicking "Tambah Soal" in admin UI)
  const q1Promise = new Promise(res => {
    teacher.once('questions-updated', res);
  });
  teacher.emit('add-question', {
    pin,
    question: {
      type: 'mc',
      text: 'Berapa 2+3?',
      options: ['4', '5', '6', '7'],
      correctIndex: 1,
      points: 100
    }
  });
  await q1Promise;
  console.log('2. Question 1 added via add-question');

  // 3. Student 1 joins (simulating index.html)
  const s1_index = io(SERVER_URL);
  s1_index.on('error', (err) => console.log('  [S1 INDEX ERROR]', err));

  const s1JoinData = await new Promise((res, rej) => {
    s1_index.on('join-success', res);
    s1_index.on('error', rej);
    s1_index.emit('join-room', { pin, nickname: 'Rina', avatar: '🦁', isAnonymous: true });
  });
  console.log('3. Student 1 (Rina) joined. PlayerId:', s1JoinData.playerId);
  
  // Student navigates to game.html -> index socket disconnects
  s1_index.disconnect();
  await new Promise(r => setTimeout(r, 200)); // simulate page transition

  // 4. Student 1 connects game.html and does reconnect-attempt
  const s1_game = io(SERVER_URL);
  s1_game.on('error', (err) => console.log('  [S1 GAME ERROR]', err));

  // Track ALL events on student's game socket
  const eventsReceived = [];
  const originalOnevent = s1_game.onevent;
  s1_game.onevent = function(packet) {
    const eventName = packet.data[0];
    eventsReceived.push({ event: eventName, time: Date.now() });
    if (eventName === 'game-started') {
      console.log('  >>> [S1_GAME] RECEIVED game-started EVENT! Data keys:', Object.keys(packet.data[1] || {}));
    }
    originalOnevent.call(this, packet);
  };

  const s1ReconData = await new Promise((res, rej) => {
    s1_game.on('reconnect-success', res);
    s1_game.on('error', rej);
    s1_game.emit('reconnect-attempt', { pin, playerId: s1JoinData.playerId });
  });
  console.log('4. Student 1 reconnected on game.html. Status:', s1ReconData.roomState.status);
  console.log('   Student rooms (socket.io):', s1_game.id);

  // 5. Check room membership via API
  const roomCheck1 = await fetch(`${SERVER_URL}/api/room/${pin}/status`).then(r => r.json());
  console.log('5. Room status before start:', roomCheck1);

  const playersCheck = await fetch(`${SERVER_URL}/api/room/${pin}/players`).then(r => r.json());
  console.log('   Players in room:', playersCheck.map(p => `${p.nickname} (connected: ${p.connected})`));

  // 6. Teacher emits start-game (exactly like admin.js btnStart.onclick)
  console.log('\n6. Teacher clicking START (exactly like admin.js does):');
  
  const questions = [{
    type: 'mc',
    text: 'Berapa 2+3?',
    options: ['4', '5', '6', '7'],
    correctIndex: 1,
    points: 100
  }];

  const gameConfig = {
    timePerQuestion: 30,
    globalTimeLimit: 60,
    enablePenalty: false,
    penaltyPoints: 0
  };

  // These 3 emits mirror exactly what admin.js does:
  teacher.emit('update-config', { pin, config: gameConfig });
  teacher.emit('update-questions', { pin, questions });
  teacher.emit('start-game', { pin, config: gameConfig, questions });
  console.log('   Emitted: update-config, update-questions, start-game');

  // 7. Wait for student to receive game-started (or timeout)
  let s1ReceivedGameStarted = false;
  let teacherReceivedGameStarted = false;
  
  try {
    const result = await Promise.race([
      new Promise((resolve) => {
        s1_game.on('game-started', (data) => {
          s1ReceivedGameStarted = true;
          resolve({ who: 'student', data });
        });
      }),
      new Promise((resolve) => {
        teacher.on('game-started', (data) => {
          teacherReceivedGameStarted = true;
          resolve({ who: 'teacher', data });
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT after 5s')), 5000))
    ]);

    // Wait a bit more for the other party
    await new Promise(r => setTimeout(r, 500));

    console.log('\n7. RESULTS:');
    console.log('   Teacher received game-started:', teacherReceivedGameStarted);
    console.log('   Student received game-started:', s1ReceivedGameStarted);
    console.log('   First responder:', result.who);
    if (result.data && result.data.boxes) {
      console.log('   Boxes count:', result.data.boxes.length);
    }
  } catch (err) {
    console.log('\n7. TIMEOUT! Neither teacher nor student received game-started within 5s');
    console.log('   Teacher received game-started:', teacherReceivedGameStarted);
    console.log('   Student received game-started:', s1ReceivedGameStarted);
  }

  // 8. Check all events student game socket received
  console.log('\n8. All events received by student game socket:');
  eventsReceived.forEach(e => console.log('   -', e.event));

  // 9. Check room status after start
  try {
    const roomCheck2 = await fetch(`${SERVER_URL}/api/room/${pin}/status`).then(r => r.json());
    console.log('\n9. Room status after start attempt:', roomCheck2);
  } catch (e) {
    console.log('\n9. Room status check failed:', e.message);
  }

  teacher.close();
  s1_game.close();
  process.exit(0);
}

debugStartGameFlow().catch(err => {
  console.error('UNHANDLED ERROR:', err);
  process.exit(1);
});
