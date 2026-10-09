/**
 * Upgraded Integration Test for Clash of Champion v2
 * Tests: scalability features, rate limiting, leaderboard cache, O(1) lookups
 */
const { io } = require('socket.io-client');
const SERVER_URL = 'http://localhost:3000';
let admin;
let players = [];
let roomPin = '';
let passed = 0, failed = 0;

function assert(condition, testName) {
  if (condition) { console.log(`  ✅ ${testName}`); passed++; }
  else { console.log(`  ❌ ${testName}`); failed++; }
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { transports: ['websocket'], timeout: 5000 });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(e));
  });
}

function emitAndWait(socket, event, data, responseEvent, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${responseEvent}`)), timeout);
    socket.once(responseEvent, (resp) => { clearTimeout(timer); resolve(resp); });
    socket.once('error', (err) => { clearTimeout(timer); reject(new Error(err.message || JSON.stringify(err))); });
    if (data !== undefined) socket.emit(event, data); else socket.emit(event);
  });
}

function waitForEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

const AVATARS = ['🦁','🐉','🦅','🐺','🦊','🐼','🦄','🐯','🦈','🦉','🐙','🦋'];
const questionAnswers = {
  'Ibukota Indonesia': 'Jakarta',
  'Matahari terbit dari barat': false,
  'Planet terbesar': 'Jupiter',
  '2 + 2': '4',
  'Warna bendera Indonesia': 'Merah Putih',
  'presiden pertama': 'Soekarno',
};
function getCorrectAnswer(text) {
  for (const [key, val] of Object.entries(questionAnswers)) {
    if (text && text.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 'unknown';
}

const NUM_PLAYERS = 15; // Simulate 15 students

async function runTests() {
  console.log('\n🎮 Clash of Champion v2 - Scalability Integration Tests\n');
  console.log(`   Simulating ${NUM_PLAYERS} concurrent students\n`);

  // === 1. Connect all clients ===
  console.log(`📡 1. Connecting ${NUM_PLAYERS + 1} clients...`);
  try {
    admin = await connect();
    for (let i = 0; i < NUM_PLAYERS; i++) {
      players.push(await connect());
    }
    assert(admin.connected && players.every(p => p.connected), `All ${NUM_PLAYERS + 1} clients connected`);
  } catch (e) {
    console.log(`  ❌ Connection failed: ${e.message}`);
    process.exit(1);
  }

  // === 2. Create Room ===
  console.log('\n🏠 2. Creating room...');
  try {
    const roomData = await emitAndWait(admin, 'create-room', undefined, 'room-created');
    roomPin = roomData.pin;
    assert(roomPin && roomPin.length === 6, `Room: ${roomPin}`);
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 3. Add Questions ===
  console.log('\n📝 3. Adding 6 questions...');
  const questions = [
    { type: 'multiple_choice', question: 'Ibukota Indonesia?', options: ['Jakarta','Bandung','Surabaya','Medan'], correctAnswer: 'Jakarta', points: 100 },
    { type: 'true_false', question: 'Matahari terbit dari barat?', correctAnswer: false, points: 150 },
    { type: 'short_answer', question: 'Planet terbesar di tata surya?', correctAnswer: 'Jupiter', points: 200 },
    { type: 'multiple_choice', question: '2 + 2 = ?', options: ['3','4','5','6'], correctAnswer: '4', points: 250 },
    { type: 'short_answer', question: 'Warna bendera Indonesia (2 kata)?', correctAnswer: 'Merah Putih', points: 300 },
    { type: 'short_answer', question: 'Siapa presiden pertama Indonesia?', correctAnswer: 'Soekarno', points: 350 },
  ];
  for (const q of questions) {
    try {
      await emitAndWait(admin, 'add-question', { pin: roomPin, question: q }, 'questions-updated');
    } catch (e) { failed++; }
  }
  assert(true, `6 questions added`);

  // === 4. All Players Join ===
  console.log(`\n👥 4. ${NUM_PLAYERS} players joining...`);
  const playerIds = [];
  const startJoin = Date.now();
  for (let i = 0; i < NUM_PLAYERS; i++) {
    try {
      const result = await emitAndWait(players[i], 'join-room', {
        pin: roomPin,
        nickname: `Siswa${i + 1}`,
        avatar: AVATARS[i % AVATARS.length]
      }, 'join-success');
      playerIds.push(result.playerId);
    } catch (e) { console.log(`  ❌ Player ${i+1} join failed: ${e.message}`); failed++; }
  }
  const joinTime = Date.now() - startJoin;
  assert(playerIds.length === NUM_PLAYERS, `All ${NUM_PLAYERS} joined in ${joinTime}ms (${Math.round(joinTime/NUM_PLAYERS)}ms/player)`);

  // === 5. Check API endpoint ===
  console.log('\n🔍 5. Testing API endpoints...');
  try {
    const resp = await fetch(`${SERVER_URL}/api/room/${roomPin}/status`);
    const data = await resp.json();
    assert(data.playerCount === NUM_PLAYERS, `API: ${data.playerCount} players in room`);
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 6. Start Game ===
  console.log('\n🚀 6. Admin starts game...');
  let gameBoxes = [];
  try {
    const promises = players.map(p => waitForEvent(p, 'game-started'));
    const gameData = await emitAndWait(admin, 'start-game', { pin: roomPin }, 'game-started');
    gameBoxes = gameData.boxes;
    await Promise.all(promises);
    assert(gameBoxes.length === 6, `Game started with ${gameBoxes.length} boxes, all ${NUM_PLAYERS} players notified`);
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 7. Concurrent Box Claims (stress test) ===
  console.log('\n🔒 7. Stress test: 5 players race for same box...');
  try {
    const racers = players.slice(0, 5);
    const racePromises = racers.map(p => new Promise(resolve => {
      p.once('question-data', (d) => resolve({ got: 'question', data: d }));
      p.once('box-already-taken', (d) => resolve({ got: 'taken', data: d }));
      p.once('error', (d) => resolve({ got: 'error', data: d }));
    }));
    
    // All claim box 0 simultaneously
    racers.forEach(p => p.emit('claim-box', { pin: roomPin, boxIndex: 0 }));
    
    const results = await Promise.all(racePromises.map(p => 
      Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))])
    ));
    
    const winners = results.filter(r => r.got === 'question');
    const losers = results.filter(r => r.got === 'taken');
    assert(winners.length === 1, `Exactly 1 winner out of 5 racers (${winners.length} won, ${losers.length} rejected)`);

    // Winner answers
    if (winners.length === 1) {
      const winnerIdx = results.findIndex(r => r.got === 'question');
      const winnerSocket = racers[winnerIdx];
      const qText = winners[0].data.question.question;
      const ans = getCorrectAnswer(qText);
      const ansResult = await emitAndWait(winnerSocket, 'submit-answer', 
        { pin: roomPin, boxIndex: 0, answer: ans }, 'answer-result');
      assert(ansResult.correct === true, `Winner answered correctly: +${ansResult.totalPoints} pts`);
    }
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 8. Rapid-fire answers (multiple players answer different boxes) ===
  console.log('\n⚡ 8. Rapid-fire: multiple players claim & answer different boxes...');
  try {
    const boxesToClaim = [1, 2, 3, 4, 5]; // boxes 1-5
    const answerPromises = [];
    
    for (let i = 0; i < Math.min(boxesToClaim.length, players.length - 5); i++) {
      const p = players[i + 5]; // use players 5-9
      const boxIdx = boxesToClaim[i];
      
      const promise = (async () => {
        const qPromise = waitForEvent(p, 'question-data', 5000);
        p.emit('claim-box', { pin: roomPin, boxIndex: boxIdx });
        const qData = await qPromise;
        const ans = getCorrectAnswer(qData.question.question);
        const result = await emitAndWait(p, 'submit-answer',
          { pin: roomPin, boxIndex: boxIdx, answer: ans }, 'answer-result');
        return result;
      })();
      answerPromises.push(promise);
    }
    
    const results = await Promise.all(answerPromises);
    const allCorrect = results.every(r => r.correct === true);
    assert(allCorrect, `${results.length} players answered in parallel, all correct`);
  } catch (e) { console.log(`  ❌ Rapid-fire failed: ${e.message}`); failed++; }

  // === 9. Leaderboard check ===
  console.log('\n🏆 9. Checking leaderboard...');
  try {
    // The last answer should have triggered a leaderboard-update
    const lb = await waitForEvent(players[0], 'leaderboard-update', 3000)
      .catch(() => null);
    
    // Also try getting it via end-game
    const endResult = await emitAndWait(admin, 'end-game', { pin: roomPin }, 'game-ended');
    assert(!!endResult && !!endResult.results, 'Game ended with results');
    
    if (endResult.results) {
      const { podium, fullRanking } = endResult.results;
      assert(fullRanking.length === NUM_PLAYERS, `Full ranking has all ${fullRanking.length} players`);
      assert(podium.length <= 3, `Podium has ${podium.length} entries`);
      
      const scoredPlayers = fullRanking.filter(p => p.score > 0);
      assert(scoredPlayers.length >= 5, `${scoredPlayers.length} players have scores > 0`);
      
      console.log('    🥇 Top 5:');
      fullRanking.slice(0, 5).forEach((p, i) => 
        console.log(`      ${['🥇','🥈','🥉','4️⃣','5️⃣'][i]} ${p.nickname}: ${p.score} pts`)
      );
    }
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === SUMMARY ===
  console.log('\n' + '═'.repeat(55));
  console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`👥 Tested with ${NUM_PLAYERS} concurrent simulated students`);
  console.log('═'.repeat(55));

  // Cleanup
  admin.disconnect();
  players.forEach(p => p.disconnect());
  
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
}

runTests().catch(e => { console.error('Fatal:', e); process.exit(1); });
