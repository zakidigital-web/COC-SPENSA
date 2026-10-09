const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function testFallbackSync() {
  console.log('=== TESTING LOBBY FALLBACK SYNC & CHECK-ROOM-STATUS ===\n');

  // 1. Teacher creates room
  const teacher = io(SERVER_URL);
  const roomData = await new Promise(res => {
    teacher.on('room-created', res);
    teacher.emit('create-room', { guruName: 'Guru Uji', isAnonymous: true });
  });
  const pin = roomData.pin;
  console.log('1. Room created with PIN:', pin);

  // 2. Add question
  await new Promise(res => {
    teacher.once('questions-updated', res);
    teacher.emit('add-question', {
      pin,
      question: { type: 'mc', text: '1+1=?', options: ['1','2','3','4'], correctIndex: 1, points: 100 }
    });
  });
  console.log('2. Question added');

  // 3. Student joins
  const s_index = io(SERVER_URL);
  const joinData = await new Promise(res => {
    s_index.on('join-success', res);
    s_index.emit('join-room', { pin, nickname: 'SiswaUji', avatar: '🦁', isAnonymous: true });
  });
  s_index.disconnect();

  // 4. Student connects game.html
  const s_game = io(SERVER_URL);
  await new Promise(res => {
    s_game.on('reconnect-success', res);
    s_game.emit('reconnect-attempt', { pin, playerId: joinData.playerId });
  });
  console.log('3. Student in lobby');

  // 5. INTENTIONALLY DO NOT LISTEN to 'game-started' on s_game!
  // Instead, simulate the 2-second background check: 'check-room-status'
  console.log('4. Teacher starts game (student intentionally DOES NOT listen to game-started)...');
  teacher.emit('start-game', {
    pin,
    config: { timePerQuestion: 30, globalTimeLimit: 60 },
    questions: [{ type: 'mc', text: '1+1=?', options: ['1','2','3','4'], correctIndex: 1, points: 100 }]
  });

  // Wait 500ms for teacher start to be processed
  await new Promise(r => setTimeout(r, 500));

  // 6. Student sends check-room-status
  console.log('5. Student emits check-room-status (poll fallback)...');
  const statusRes = await new Promise(res => {
    s_game.on('room-status-response', res);
    s_game.emit('check-room-status', { pin, playerId: joinData.playerId });
  });

  console.log('6. Received room-status-response:', statusRes);
  assert.strictEqual(statusRes.exists, true, 'Room must exist');
  assert.strictEqual(statusRes.status, 'playing', 'Room status must be playing');
  assert.strictEqual(statusRes.boxes.length, 1, 'Must contain 1 box');

  console.log('\n✓ LOBBY FALLBACK SYNC TEST PASSED! Student automatically recovers even if broadcast is missed.');

  teacher.close();
  s_game.close();
  process.exit(0);
}

testFallbackSync().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
