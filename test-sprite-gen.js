const { io } = require('socket.io-client');
const SpriteGen = require('./public/js/sprite-gen');

async function testSpriteIntegration() {
  console.log('\n⚔️ Testing SpriteGen & Interactive Champion System...\n');
  let passed = 0, failed = 0;

  function assert(condition, desc) {
    if (condition) {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else {
      console.log(`  ❌ ${desc}`);
      failed++;
    }
  }

  // 1. Test Static Sprite Assets serving
  console.log('1. Checking static file serving of sprite-gen.js...');
  const res = await fetch('http://localhost:3000/js/sprite-gen.js');
  assert(res.status === 200, 'sprite-gen.js served with 200 OK');
  const text = await res.text();
  assert(text.includes('class SpriteGen'), 'sprite-gen.js contains SpriteGen class definition');

  // 2. Connect Admin and 2 Champion Players
  console.log('\n2. Testing socket connection with generated sprite avatars...');
  const admin = io('http://localhost:3000');
  const player1 = io('http://localhost:3000');
  const player2 = io('http://localhost:3000');

  await Promise.all([
    new Promise(r => admin.on('connect', r)),
    new Promise(r => player1.on('connect', r)),
    new Promise(r => player2.on('connect', r))
  ]);
  assert(admin.connected && player1.connected && player2.connected, 'All 3 sockets connected');

  // 3. Admin creates room
  const roomData = await new Promise(resolve => {
    admin.once('room-created', resolve);
    admin.emit('create-room');
  });
  const pin = roomData.pin;
  assert(pin && pin.length === 6, `Room created with PIN: ${pin}`);

  // 4. Add questions
  await new Promise(resolve => {
    admin.once('questions-updated', resolve);
    admin.emit('add-question', {
      pin,
      question: {
        type: 'multiple_choice',
        question: 'Siapakah pahlawan pedang?',
        options: ['Ksatria', 'Penyihir', 'Ninja', 'Pemanah'],
        correctAnswer: 'Ksatria',
        points: 100
      }
    });
  });

  // 5. Generate unique champion sprites for both players
  const sprite1 = SpriteGen.stringify({
    isSprite: true,
    class: 'knight',
    palette: 'fire',
    skin: 0,
    seed: 11111
  });

  const sprite2 = SpriteGen.stringify({
    isSprite: true,
    class: 'mage',
    palette: 'ice',
    skin: 1,
    seed: 22222
  });

  // 6. Players join with sprite avatars
  console.log('\n3. Players joining with custom champion sprites...');
  const p1Join = new Promise(resolve => {
    player1.once('join-success', resolve);
    player1.emit('join-room', { pin, nickname: 'Arthur', avatar: sprite1 });
  });
  const p2Join = new Promise(resolve => {
    player2.once('join-success', resolve);
    player2.emit('join-room', { pin, nickname: 'Merlin', avatar: sprite2 });
  });

  const [res1, res2] = await Promise.all([p1Join, p2Join]);
  assert(res1.playerId !== undefined, `Player 1 registered with ID: ${res1.playerId}`);
  assert(res2.playerId !== undefined, `Player 2 registered with ID: ${res2.playerId}`);

  // 7. Start Game
  console.log('\n4. Admin starts game...');
  const startPromise = new Promise(resolve => player1.once('game-started', resolve));
  admin.emit('start-game', { pin });
  const startData = await startPromise;
  assert(startData.boxes.length === 1, 'Game started with 1 box');

  // 8. Player 1 claims box and verifies playerAvatar broadcast
  console.log('\n5. Testing battle sprite claim broadcast...');
  const claimPromiseP2 = new Promise(resolve => player2.once('box-claimed', resolve));
  player1.emit('claim-box', { pin, boxIndex: 0 });
  const claimedDataP2 = await claimPromiseP2;
  assert(claimedDataP2.playerId === res1.playerId, 'Box claimed by Player 1');
  assert(claimedDataP2.playerAvatar === sprite1, `Player 2 received Player 1 battle sprite: ${claimedDataP2.playerAvatar}`);

  // 9. Player 1 submits answer and tests leaderboard sprite broadcast
  console.log('\n6. Testing answer and leaderboard sprite transmission...');
  const lbPromise = new Promise(resolve => player2.once('leaderboard-update', resolve));
  player1.emit('submit-answer', { pin, boxIndex: 0, answer: 'Ksatria' });
  const lbData = await lbPromise;
  assert(lbData.leaderboard.length === 2, 'Leaderboard updated with both players');
  const lbArthur = lbData.leaderboard.find(p => p.nickname === 'Arthur');
  assert(lbArthur && lbArthur.avatar === sprite1, 'Leaderboard retained champion sprite');

  // 10. End game and verify podium sprites
  console.log('\n7. Ending game and verifying podium sprite data...');
  const endPromise = new Promise(resolve => admin.once('game-ended', resolve));
  admin.emit('end-game', { pin });
  const endData = await endPromise;
  const podiumArthur = endData.results.podium[0];
  assert(podiumArthur && podiumArthur.avatar === sprite1, 'Podium champion sprite accurately preserved');

  console.log('\n' + '═'.repeat(55));
  console.log(`📊 SpriteGen Integration Test: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(55) + '\n');

  admin.disconnect();
  player1.disconnect();
  player2.disconnect();

  process.exit(failed > 0 ? 1 : 0);
}

testSpriteIntegration().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
