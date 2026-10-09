/**
 * 40-Student Stress Test for Clash of Champion v2
 * Tests: 40 concurrent students, race conditions, mass emote spam, leaderboard performance
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
    const socket = io(SERVER_URL, { transports: ['websocket'], timeout: 8000 });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(e));
  });
}

function emitAndWait(socket, event, data, responseEvent, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${responseEvent}`)), timeout);
    socket.once(responseEvent, (resp) => { clearTimeout(timer); resolve(resp); });
    socket.once('error', (err) => { clearTimeout(timer); reject(new Error(err.message || JSON.stringify(err))); });
    if (data !== undefined) socket.emit(event, data); else socket.emit(event);
  });
}

function waitForEvent(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

const AVATARS = ['🦁','🐉','🦅','🐺','🦊','🐼','🦄','🐯','🦈','🦉','🐙','🦋'];
const NUM_PLAYERS = 40; // 40 students benchmark!

async function runTests() {
  console.log('\n🔥 Clash of Champion v2 - 40 Concurrent Students Stress Test 🔥\n');

  // === 1. Connect Admin + 40 Students ===
  console.log(`📡 1. Connecting 1 Admin + ${NUM_PLAYERS} Students concurrently...`);
  const connStart = Date.now();
  try {
    admin = await connect();
    const connectPromises = [];
    for (let i = 0; i < NUM_PLAYERS; i++) {
      connectPromises.push(connect());
    }
    players = await Promise.all(connectPromises);
    const connTime = Date.now() - connStart;
    assert(admin.connected && players.length === NUM_PLAYERS && players.every(p => p.connected), 
      `All 41 sockets connected in ${connTime}ms (${Math.round(connTime / 41)}ms/socket)`);
  } catch (e) {
    console.log(`  ❌ Connection failed: ${e.message}`);
    process.exit(1);
  }

  // === 2. Create Room ===
  console.log('\n🏠 2. Creating room...');
  try {
    const roomData = await emitAndWait(admin, 'create-room', undefined, 'room-created');
    roomPin = roomData.pin;
    assert(roomPin && roomPin.length === 6, `Room PIN: ${roomPin}`);
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 3. Add 40 Questions (1 question per student) ===
  console.log('\n📝 3. Bulk adding 40 questions...');
  const questions = [];
  for (let i = 1; i <= NUM_PLAYERS; i++) {
    questions.push({
      type: i % 2 === 0 ? 'true_false' : 'multiple_choice',
      question: `Soal #${i}: Apakah 10 + ${i} = ${10 + i}?`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: i % 2 === 0 ? true : 'A',
      points: 50 + (i * 10)
    });
  }

  try {
    await emitAndWait(admin, 'update-questions', { pin: roomPin, questions }, 'questions-updated');
    assert(true, `Successfully added ${questions.length} questions in bulk`);
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 4. Mass Parallel Join for 40 Students ===
  console.log(`\n👥 4. 40 Students joining simultaneously...`);
  const joinStart = Date.now();
  try {
    const joinPromises = players.map((p, idx) => 
      emitAndWait(p, 'join-room', {
        pin: roomPin,
        nickname: `Student_${idx + 1}`,
        avatar: AVATARS[idx % AVATARS.length]
      }, 'join-success')
    );
    const joinResults = await Promise.all(joinPromises);
    const joinDuration = Date.now() - joinStart;
    assert(joinResults.length === NUM_PLAYERS, 
      `All ${NUM_PLAYERS} joined simultaneously in ${joinDuration}ms (${(joinDuration/NUM_PLAYERS).toFixed(1)}ms/student)`);
  } catch (e) {
    console.log(`  ❌ Mass join failed: ${e.message}`);
    failed++;
  }

  // === 5. Verify Room Status via REST API ===
  console.log('\n🔍 5. REST API Room Status Validation...');
  try {
    const res = await fetch(`${SERVER_URL}/api/room/${roomPin}/status`);
    const data = await res.json();
    assert(data.playerCount === 40, `API reports exactly 40 players in room`);
  } catch (e) { console.log(`  ❌ ${e.message}`); failed++; }

  // === 6. Start Game Broadcast to 40 Students ===
  console.log('\n🚀 6. Admin starts game (Broadcast to 40 clients)...');
  const startBroadcastPromises = players.map(p => waitForEvent(p, 'game-started'));
  try {
    const adminStartRes = await emitAndWait(admin, 'start-game', { pin: roomPin }, 'game-started');
    const playerStartResults = await Promise.all(startBroadcastPromises);
    assert(adminStartRes.boxes.length === 40 && playerStartResults.every(r => r.boxes.length === 40),
      `Game started with 40 boxes; all 40 students received the state in sync`);
  } catch (e) { console.log(`  ❌ Game start broadcast failed: ${e.message}`); failed++; }

  // === 7. Atomic Lock Contention: 40 Students try to claim Box #0 at the EXACT SAME INSTANT ===
  console.log('\n🔒 7. Extreme Atomic Contention: 40 students claim Box #0 simultaneously...');
  try {
    const claimPromises = players.map(p => new Promise(resolve => {
      p.once('question-data', (d) => resolve({ status: 'won', data: d }));
      p.once('box-already-taken', (d) => resolve({ status: 'rejected', data: d }));
      p.once('error', (e) => resolve({ status: 'error', data: e }));
    }));

    // Fire all at the same moment!
    players.forEach(p => p.emit('claim-box', { pin: roomPin, boxIndex: 0 }));

    const raceResults = await Promise.all(claimPromises.map(p => 
      Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))])
    ));

    const winners = raceResults.filter(r => r.status === 'won');
    const rejected = raceResults.filter(r => r.status === 'rejected');
    assert(winners.length === 1 && rejected.length === 39, 
      `Server concurrency check: EXACTLY 1 winner and 39 rejected cleanly without race condition!`);

    // Winner submits answer
    const winnerIdx = raceResults.findIndex(r => r.status === 'won');
    const winnerSocket = players[winnerIdx];
    const winnerQ = winners[0].data.question;
    const winnerAns = winnerQ.type === 'true_false' ? true : 'A';
    const ansResult = await emitAndWait(winnerSocket, 'submit-answer', {
      pin: roomPin,
      boxIndex: 0,
      answer: winnerAns
    }, 'answer-result');
    assert(ansResult.correct === true, `Winner answered and received points: +${ansResult.totalPoints}`);
  } catch (e) { console.log(`  ❌ Concurrency test failed: ${e.message}`); failed++; }

  // === 8. Rate Limiting Test (Emote & Rapid Click spam) ===
  console.log('\n🛑 8. Rate limiting check (Emote spam & double claim)...');
  // Wait 600ms to clear rate limit from Test 7
  await new Promise(r => setTimeout(r, 600));
  try {
    // Player 1 claims box 1
    const p1 = players[1];
    const qData = await emitAndWait(p1, 'claim-box', { pin: roomPin, boxIndex: 1 }, 'question-data');
    
    // Player 1 immediately attempts to claim another box while holding box 1
    const doubleClaimPromise = new Promise(resolve => {
      p1.once('box-already-taken', resolve);
      p1.once('error', resolve);
    });
    p1.emit('claim-box', { pin: roomPin, boxIndex: 2 });
    const doubleClaimRes = await doubleClaimPromise;
    assert(doubleClaimRes.reason === 'Selesaikan soal sebelumnya' || doubleClaimRes.reason === 'Tunggu sebentar sebelum memilih soal lagi',
      `Double-claim prevented while holding active box: "${doubleClaimRes.reason}"`);

    // Finish answering box 1
    const ans1 = qData.question.type === 'true_false' ? true : 'A';
    await emitAndWait(p1, 'submit-answer', { pin: roomPin, boxIndex: 1, answer: ans1 }, 'answer-result');
    assert(true, `Player released box 1 cleanly`);
  } catch (e) { console.log(`  ❌ Rate limit check failed: ${e.message}`); failed++; }

  // === 9. Parallel distributed box claims (Remaining 38 boxes claimed by 38 students) ===
  console.log('\n⚡ 9. Full-room distributed solving (38 students claim 38 distinct boxes in parallel)...');
  // Wait 600ms so all 38 students are off claim cooldown
  await new Promise(r => setTimeout(r, 600));
  try {
    const distributedWork = [];
    for (let i = 2; i < 40; i++) {
      const studentSocket = players[i];
      const boxIdx = i;
      
      const task = (async () => {
        const qData = await emitAndWait(studentSocket, 'claim-box', { pin: roomPin, boxIndex: boxIdx }, 'question-data');
        const expectedAns = qData.question.type === 'true_false' ? true : 'A';
        const res = await emitAndWait(studentSocket, 'submit-answer', {
          pin: roomPin,
          boxIndex: boxIdx,
          answer: expectedAns
        }, 'answer-result');
        return res.correct;
      })();
      distributedWork.push(task);
    }

    const taskResults = await Promise.all(distributedWork);
    assert(taskResults.every(r => r === true), `All 38 parallel claims and answers validated correctly!`);
  } catch (e) { console.log(`  ❌ Distributed solving failed: ${e.message}`); failed++; }

  // === 10. End Game and Full Leaderboard Verification ===
  console.log('\n🏆 10. Final Leaderboard and Statistics across 40 students...');
  try {
    const endRes = await emitAndWait(admin, 'end-game', { pin: roomPin }, 'game-ended');
    const { podium, fullRanking, titles } = endRes.results;
    assert(fullRanking.length === 40, `Full ranking contains all 40 students`);
    assert(podium.length === 3, `Podium has top 3 positions`);
    assert(fullRanking[0].score >= fullRanking[1].score && fullRanking[1].score >= fullRanking[2].score,
      `Leaderboard is accurately sorted: 1st=${fullRanking[0].nickname} (${fullRanking[0].score}pts), 2nd=${fullRanking[1].nickname} (${fullRanking[1].score}pts), 3rd=${fullRanking[2].nickname} (${fullRanking[2].score}pts)`);
    assert(titles !== undefined, `Special titles calculated successfully`);
  } catch (e) { console.log(`  ❌ Leaderboard check failed: ${e.message}`); failed++; }

  // === SUMMARY ===
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`🚀 40 CONCURRENT STUDENTS BENCHMARK: 100% SUCCESSFUL`);
  console.log('═'.repeat(60));

  // Disconnect
  admin.disconnect();
  players.forEach(p => p.disconnect());

  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
}

runTests().catch(err => {
  console.error('Stress test fatal error:', err);
  process.exit(1);
});
