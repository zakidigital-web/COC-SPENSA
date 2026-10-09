const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function runTests() {
  console.log('--- STARTING VERIFICATION TESTS ---');

  // 1. Teacher connects and creates room
  const teacherSocket = io(SERVER_URL);
  
  const roomCreatedPromise = new Promise((resolve) => {
    teacherSocket.on('room-created', (data) => resolve(data));
  });

  teacherSocket.emit('create-room', {
    guruName: 'Pak Budi',
    title: 'Kuis IPA Kelas 7',
    isAnonymous: false
  });

  const roomData = await roomCreatedPromise;
  const pin = roomData.pin;
  console.log(`✓ Room created with PIN: ${pin}`);

  // Teacher adds questions
  teacherSocket.emit('add-question', {
    pin,
    question: {
      type: 'mc',
      text: 'Berapakah 2 + 2?',
      options: ['2', '3', '4', '5'],
      correctIndex: 2,
      points: 100
    }
  });
  teacherSocket.emit('add-question', {
    pin,
    question: {
      type: 'tf',
      text: 'Matahari terbit dari timur?',
      correct: true,
      points: 100
    }
  });

  await new Promise(r => setTimeout(r, 200));

  // 2. Student 1 Joins
  const student1Socket = io(SERVER_URL);
  const s1JoinedPromise = new Promise((resolve) => {
    student1Socket.on('join-success', (data) => resolve(data));
  });

  student1Socket.emit('join-room', {
    pin: pin,
    nickname: 'Ahmad',
    avatar: '🦁',
    isAnonymous: true
  });

  const s1Data = await s1JoinedPromise;
  console.log(`✓ Student 1 (Ahmad) joined successfully. PlayerId: ${s1Data.playerId}`);
  assert.strictEqual(s1Data.pin, pin, 'PIN should match in join-success');
  assert.strictEqual(s1Data.roomState.playerCount, 1);
  assert.strictEqual(s1Data.roomState.players.length, 1);
  assert.strictEqual(s1Data.roomState.players[0].nickname, 'Ahmad');

  // 3. Student 2 Joins (Lobby visibility check)
  const student2Socket = io(SERVER_URL);
  
  // Student 1 should receive player-joined with Student 2
  const s1NoticePromise = new Promise((resolve) => {
    student1Socket.on('player-joined', (data) => {
      if (data.player && data.player.nickname === 'Budi') {
        resolve(data);
      }
    });
  });

  const s2JoinedPromise = new Promise((resolve) => {
    student2Socket.on('join-success', (data) => resolve(data));
  });

  student2Socket.emit('join-room', {
    pin: pin,
    nickname: 'Budi',
    avatar: '🦅',
    isAnonymous: true
  });

  const s2Data = await s2JoinedPromise;
  const s1Notice = await s1NoticePromise;

  console.log(`✓ Student 2 (Budi) joined successfully. PlayerId: ${s2Data.playerId}`);
  console.log(`✓ Student 2 received lobby players:`, s2Data.roomState.players.map(p => p.nickname));
  assert.strictEqual(s2Data.roomState.players.length, 2, 'Student 2 must see 2 players in lobby');
  assert.ok(s2Data.roomState.players.some(p => p.nickname === 'Ahmad'), 'Student 2 must see Ahmad');
  assert.ok(s2Data.roomState.players.some(p => p.nickname === 'Budi'), 'Student 2 must see Budi');

  console.log(`✓ Student 1 received player-joined event with players:`, s1Notice.players.map(p => p.nickname));
  assert.strictEqual(s1Notice.players.length, 2, 'Student 1 must be notified of 2 players');

  // 4. Student 3 Joins with same nickname "Ahmad" (Collision Auto-Disambiguation test)
  const student3Socket = io(SERVER_URL);
  const s3JoinedPromise = new Promise((resolve) => {
    student3Socket.on('join-success', (data) => resolve(data));
  });

  student3Socket.emit('join-room', {
    pin: pin,
    nickname: 'Ahmad', // Duplicate!
    avatar: '🦊',
    isAnonymous: true
  });

  const s3Data = await s3JoinedPromise;
  console.log(`✓ Student 3 joined with duplicate name. Assigned nickname:`, s3Data.roomState.players.find(p => p.id === s3Data.playerId)?.nickname);
  const s3Nick = s3Data.roomState.players.find(p => p.id === s3Data.playerId)?.nickname;
  assert.strictEqual(s3Nick, 'Ahmad (2)', 'Duplicate nickname must auto-disambiguate without blocking student');
  assert.strictEqual(s3Data.roomState.players.length, 3, 'Student 3 must see 3 players in lobby');

  // 5. Student 1 Reconnects to lobby (reconnect-attempt)
  const student1ReconnectSocket = io(SERVER_URL);
  const s1ReconnectPromise = new Promise((resolve) => {
    student1ReconnectSocket.on('reconnect-success', (data) => resolve(data));
  });

  student1ReconnectSocket.emit('reconnect-attempt', {
    pin,
    playerId: s1Data.playerId
  });

  const s1ReconnectedData = await s1ReconnectPromise;
  console.log(`✓ Student 1 reconnected. Room status: ${s1ReconnectedData.roomState.status}, Players count: ${s1ReconnectedData.roomState.players?.length}`);
  assert.ok(s1ReconnectedData.roomState.players, 'reconnect-success must include players list for lobby');
  assert.strictEqual(s1ReconnectedData.roomState.players.length, 3, 'Reconnecting student must see all 3 lobby players');

  // 6. Teacher sets global timer and starts game
  console.log(`✓ Testing Global Timer configuration (45 seconds) & start game...`);
  
  const s1GameStartedPromise = new Promise((resolve) => {
    student1Socket.on('game-started', (data) => resolve(data));
  });
  const teacherGameStartedPromise = new Promise((resolve) => {
    teacherSocket.on('game-started', (data) => resolve(data));
  });

  teacherSocket.emit('start-game', {
    pin,
    config: {
      timePerQuestion: 30,
      globalTimeLimit: 45 // 45 seconds countdown for all questions
    }
  });

  const [s1GameStart, teacherGameStart] = await Promise.all([
    s1GameStartedPromise,
    teacherGameStartedPromise
  ]);

  console.log(`✓ Game started event received!`);
  console.log(`  - Boxes count: ${s1GameStart.boxes.length}`);
  console.log(`  - Global time limit: ${s1GameStart.globalTimeLimit}s`);
  console.log(`  - Global end time: ${new Date(s1GameStart.globalEndTime).toISOString()}`);
  
  assert.strictEqual(s1GameStart.globalTimeLimit, 45, 'globalTimeLimit must be 45');
  assert.ok(s1GameStart.globalEndTime > Date.now(), 'globalEndTime must be in the future');
  assert.strictEqual(teacherGameStart.globalTimeLimit, 45, 'Teacher must receive globalTimeLimit');

  // 7. Teacher extends time (+30s)
  const timeExtendedPromise = new Promise((resolve) => {
    student1Socket.on('time-extended', (data) => resolve(data));
  });

  teacherSocket.emit('extend-time', { pin, extraSeconds: 30 });
  const timeExtData = await timeExtendedPromise;

  console.log(`✓ Time extended received. Extra seconds: ${timeExtData.extraSeconds}, New end time: ${new Date(timeExtData.globalEndTime).toISOString()}`);
  assert.strictEqual(timeExtData.extraSeconds, 30);
  assert.ok(timeExtData.globalEndTime > s1GameStart.globalEndTime, 'Extended end time must be greater than previous end time');

  // Cleanup
  teacherSocket.close();
  student1Socket.close();
  student2Socket.close();
  student3Socket.close();
  student1ReconnectSocket.close();

  console.log('--- ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
