const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function testMultipleStudentsDetection() {
  console.log('--- STARTING MULTI-STUDENT DETECTION TEST ---');

  // 1. Teacher creates room
  const teacher = io(SERVER_URL);
  let teacherPlayers = [];
  teacher.on('player-joined', (d) => {
    if (d.players) teacherPlayers = d.players;
    else if (d.player) {
      const idx = teacherPlayers.findIndex(x => x.id === d.player.id);
      if (idx >= 0) teacherPlayers[idx] = d.player;
      else teacherPlayers.push(d.player);
    }
  });
  teacher.on('player-reconnected', (d) => {
    if (d.players) teacherPlayers = d.players;
    else if (d.player) {
      const idx = teacherPlayers.findIndex(x => x.id === d.player.id);
      if (idx >= 0) teacherPlayers[idx] = d.player;
      else teacherPlayers.push(d.player);
    }
  });

  const pin = await new Promise(res => {
    teacher.on('room-created', d => res(d.pin));
    teacher.emit('create-room', { guruName: 'Bu Guru', isAnonymous: true });
  });
  console.log(`✓ Room created with PIN: ${pin}`);

  // Helper to simulate student join from index.html -> game.html transition
  async function joinStudent(nickname, avatar) {
    const indexSocket = io(SERVER_URL);
    const joinRes = await new Promise((resolve, reject) => {
      indexSocket.on('join-success', resolve);
      indexSocket.on('error', reject);
      indexSocket.emit('join-room', { pin, nickname, avatar, isAnonymous: true });
    });

    const playerId = joinRes.playerId;
    // Simulate page unload / navigation disconnect
    indexSocket.disconnect();

    // Small delay simulating navigation to game.html
    await new Promise(r => setTimeout(r, 50));

    // Game.html socket connects
    const gameSocket = io(SERVER_URL);
    let myLobbyPlayers = [];

    gameSocket.on('player-joined', (d) => {
      if (d.players) myLobbyPlayers = d.players;
      else if (d.player && !myLobbyPlayers.some(p => p.id === d.player.id)) {
        myLobbyPlayers.push(d.player);
      }
    });

    gameSocket.on('player-reconnected', (d) => {
      if (d.players) myLobbyPlayers = d.players;
      else if (d.player && !myLobbyPlayers.some(p => p.id === d.player.id)) {
        myLobbyPlayers.push(d.player);
      }
    });

    const reconRes = await new Promise((resolve, reject) => {
      gameSocket.on('reconnect-success', resolve);
      gameSocket.on('error', reject);
      gameSocket.emit('reconnect-attempt', { pin, playerId });
    });

    myLobbyPlayers = reconRes.roomState.players || [];

    return {
      playerId,
      nickname,
      gameSocket,
      getLobby: () => myLobbyPlayers
    };
  }

  // 2. Student 1 joins
  console.log('Joining Student 1 ("Andi")...');
  const s1 = await joinStudent('Andi', '🦁');
  await new Promise(r => setTimeout(r, 100));
  console.log('Teacher sees:', teacherPlayers.map(p => p.nickname));
  assert.strictEqual(teacherPlayers.length, 1);
  assert.strictEqual(teacherPlayers[0].nickname, 'Andi');

  // 3. Student 2 joins ("Budi")
  console.log('Joining Student 2 ("Budi")...');
  const s2 = await joinStudent('Budi', '🦅');
  await new Promise(r => setTimeout(r, 100));
  console.log('Teacher sees:', teacherPlayers.map(p => p.nickname));
  assert.strictEqual(teacherPlayers.length, 2, 'Teacher must see 2 students');
  assert.ok(teacherPlayers.some(p => p.nickname === 'Andi'), 'Andi must remain detected');
  assert.ok(teacherPlayers.some(p => p.nickname === 'Budi'), 'Budi must be detected');

  // 4. Student 3 joins with same name ("Andi") - collision disambiguation
  console.log('Joining Student 3 with duplicate name ("Andi")...');
  const s3 = await joinStudent('Andi', '🦊');
  await new Promise(r => setTimeout(r, 100));
  console.log('Teacher sees:', teacherPlayers.map(p => p.nickname));
  assert.strictEqual(teacherPlayers.length, 3, 'Teacher must see 3 students');
  assert.ok(teacherPlayers.some(p => p.nickname === 'Andi'), 'Original Andi must remain');
  assert.ok(teacherPlayers.some(p => p.nickname === 'Andi (2)'), 'Duplicate Andi must be Andi (2)');

  // 5. Student 4 joins with default name ("Pemain")
  console.log('Joining Student 4 ("Pemain")...');
  const s4 = await joinStudent('Pemain', '🐯');
  await new Promise(r => setTimeout(r, 100));
  console.log('Teacher sees:', teacherPlayers.map(p => p.nickname));
  assert.strictEqual(teacherPlayers.length, 4, 'Teacher must see 4 students');

  // 6. Student 5 joins with default name ("Pemain") - must not hijack Student 4
  console.log('Joining Student 5 ("Pemain")...');
  const s5 = await joinStudent('Pemain', '🐼');
  await new Promise(r => setTimeout(r, 100));
  console.log('Teacher sees:', teacherPlayers.map(p => p.nickname));
  assert.strictEqual(teacherPlayers.length, 5, 'Teacher must see all 5 students without any disappearing');
  assert.ok(teacherPlayers.some(p => p.nickname === 'Pemain'), 'Pemain must remain');
  assert.ok(teacherPlayers.some(p => p.nickname === 'Pemain (2)'), 'Pemain (2) must be present');

  // 7. Check student lobbies: all students must see all other students
  console.log('Checking S1 lobby:', s1.getLobby().map(p => p.nickname));
  console.log('Checking S5 lobby:', s5.getLobby().map(p => p.nickname));
  assert.strictEqual(s5.getLobby().length, 5, 'S5 must see all 5 students in lobby');

  // Cleanup
  teacher.close();
  s1.gameSocket.close();
  s2.gameSocket.close();
  s3.gameSocket.close();
  s4.gameSocket.close();
  s5.gameSocket.close();

  console.log('--- ALL MULTI-STUDENT DETECTION TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

testMultipleStudentsDetection().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
