const { io } = require('socket.io-client');
const http = require('http');

const SERVER_URL = 'http://localhost:3000';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function realisticBrowserTest() {
  console.log('=== REALISTIC BROWSER SIMULATION TEST ===\n');

  // 1. GURU opens admin.html
  const guru = io(SERVER_URL);
  guru.on('error', err => console.log('[GURU ERROR]', err));

  const roomData = await new Promise(res => {
    guru.on('room-created', res);
    guru.emit('create-room', { guruName: 'Bu Matematika', isAnonymous: true });
  });
  const pin = roomData.pin;
  console.log(`1. Guru created room. PIN: ${pin}`);

  // 2. Guru adds 2 questions via admin.js UI
  const questions = [
    { type: 'mc', text: '2 + 3 = ?', options: ['4', '5', '6', '7'], correctIndex: 1, points: 100 },
    { type: 'tf', text: 'Matahari terbit dari barat', correct: false, points: 150 }
  ];

  for (const q of questions) {
    await new Promise(res => {
      guru.once('questions-updated', res);
      guru.emit('add-question', { pin, question: q });
    });
  }
  console.log(`2. Guru added ${questions.length} questions`);

  // 3. Siswa 1 joins via index.html
  const s1_index = io(SERVER_URL);
  const s1Join = await new Promise((res, rej) => {
    s1_index.on('join-success', res);
    s1_index.on('error', rej);
    s1_index.emit('join-room', { pin, nickname: 'Andi', avatar: '🦁', isAnonymous: true });
  });
  console.log(`3. Siswa 1 (Andi) joined via index. PlayerId: ${s1Join.playerId}`);
  
  // Simulate: browser navigates to game.html -> index socket disconnects  
  s1_index.disconnect();
  await new Promise(r => setTimeout(r, 300)); // simulate real page load

  // 4. Siswa 1 connects game.html
  const s1_game = io(SERVER_URL);
  let s1GameStarted = false;
  let s1GameStartedData = null;

  // Register game-started listener BEFORE reconnect (just like game.js does)
  s1_game.on('game-started', (data) => {
    s1GameStarted = true;
    s1GameStartedData = data;
    console.log(`  [SISWA 1] ✓ Received game-started! Boxes: ${data.boxes?.length}`);
  });
  s1_game.on('error', err => console.log('[S1_GAME ERROR]', err));

  const s1Recon = await new Promise((res, rej) => {
    s1_game.on('reconnect-success', res);
    s1_game.on('error', rej);
    s1_game.emit('reconnect-attempt', { pin, playerId: s1Join.playerId });
  });
  console.log(`4. Siswa 1 on game.html. Status: ${s1Recon.roomState.status}, Players: ${s1Recon.roomState.players.length}`);

  // 5. Siswa 2 joins the same way
  const s2_index = io(SERVER_URL);
  const s2Join = await new Promise((res, rej) => {
    s2_index.on('join-success', res);
    s2_index.on('error', rej);
    s2_index.emit('join-room', { pin, nickname: 'Budi', avatar: '🦅', isAnonymous: true });
  });
  s2_index.disconnect();
  await new Promise(r => setTimeout(r, 300));

  const s2_game = io(SERVER_URL);
  let s2GameStarted = false;

  s2_game.on('game-started', (data) => {
    s2GameStarted = true;
    console.log(`  [SISWA 2] ✓ Received game-started! Boxes: ${data.boxes?.length}`);
  });
  s2_game.on('error', err => console.log('[S2_GAME ERROR]', err));

  const s2Recon = await new Promise((res, rej) => {
    s2_game.on('reconnect-success', res);
    s2_game.on('error', rej);
    s2_game.emit('reconnect-attempt', { pin, playerId: s2Join.playerId });
  });
  console.log(`5. Siswa 2 on game.html. Status: ${s2Recon.roomState.status}, Players: ${s2Recon.roomState.players.length}`);

  // Verify room state via API
  const apiPlayers = await fetchJSON(`${SERVER_URL}/api/room/${pin}/players`);
  console.log(`   API confirms players: ${apiPlayers.map(p => p.nickname).join(', ')}`);

  // 6. Wait a moment, then GURU clicks START
  await new Promise(r => setTimeout(r, 500));
  
  console.log(`\n6. Guru clicks START (emitting update-config, update-questions, start-game)...`);
  
  const gameConfig = { timePerQuestion: 30, globalTimeLimit: 60, enablePenalty: false, penaltyPoints: 0 };
  guru.emit('update-config', { pin, config: gameConfig });
  guru.emit('update-questions', { pin, questions });
  guru.emit('start-game', { pin, config: gameConfig, questions });

  // Wait for both students to receive game-started
  await new Promise(r => setTimeout(r, 2000));

  console.log(`\n=== RESULTS ===`);
  console.log(`Siswa 1 (Andi) received game-started: ${s1GameStarted}`);
  console.log(`Siswa 2 (Budi) received game-started: ${s2GameStarted}`);

  if (s1GameStarted && s2GameStarted) {
    console.log('\n✓ ALL STUDENTS RECEIVED GAME-STARTED SUCCESSFULLY!');
    
    // Test that a student can claim a box
    console.log('\n7. Siswa 1 tries to claim box 0...');
    const claimResult = await new Promise((resolve, reject) => {
      s1_game.on('question-data', (data) => resolve({ type: 'question', data }));
      s1_game.on('box-already-taken', (data) => resolve({ type: 'taken', data }));
      s1_game.on('error', (err) => resolve({ type: 'error', err }));
      setTimeout(() => reject(new Error('TIMEOUT claiming box')), 3000);
      s1_game.emit('claim-box', { pin, boxIndex: 0 });
    });
    console.log(`   Claim result: ${claimResult.type}`);
    if (claimResult.type === 'question') {
      console.log(`   Question received: "${claimResult.data.question.text}"`);
    }
  } else {
    console.log('\n✗ SOME STUDENTS DID NOT RECEIVE GAME-STARTED!');
    
    // Debug: check room status
    const roomStatus = await fetchJSON(`${SERVER_URL}/api/room/${pin}/status`);
    console.log('   Room status:', roomStatus);
  }

  guru.close();
  s1_game.close();
  s2_game.close();
  process.exit(s1GameStarted && s2GameStarted ? 0 : 1);
}

realisticBrowserTest().catch(err => {
  console.error('UNHANDLED:', err);
  process.exit(1);
});
