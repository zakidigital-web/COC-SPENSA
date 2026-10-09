const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function testAdminRecovery() {
  console.log('--- STARTING ADMIN PIN & RECOVERY TEST ---');

  // Scenario 1: Admin connects with stale/dead PIN
  console.log('1. Simulating admin reconnecting with expired/stale PIN (999999)...');
  const adminSocket = io(SERVER_URL);

  const staleErrorPromise = new Promise((resolve) => {
    adminSocket.on('error', (err) => resolve(err));
  });

  adminSocket.emit('reconnect-attempt', {
    pin: '999999',
    playerId: 'admin',
    adminToken: 'fake_expired_token'
  });

  const err = await staleErrorPromise;
  console.log('✓ Received expected error on stale PIN:', err.message);
  assert.ok(err.message.includes('tidak ditemukan') || err.message.includes('telah berakhir'));

  // Scenario 2: Admin self-heals by emitting create-room
  console.log('2. Simulating client self-healing: requesting fresh room...');
  const roomCreatedPromise = new Promise((resolve) => {
    adminSocket.on('room-created', (data) => resolve(data));
  });

  adminSocket.emit('create-room', {
    guruName: 'Pak Guru Cek PIN',
    isAnonymous: true
  });

  const newRoom = await roomCreatedPromise;
  console.log('✓ Successfully created fresh room with PIN:', newRoom.pin);
  assert.ok(newRoom.pin && newRoom.pin.length === 6, 'PIN must be 6 digits');
  assert.ok(newRoom.adminToken, 'adminToken must be returned');

  // Scenario 3: Admin reconnects with the valid PIN
  console.log('3. Simulating admin reconnect with the active PIN...');
  const adminSocket2 = io(SERVER_URL);
  const reconnectPromise = new Promise((resolve) => {
    adminSocket2.on('reconnect-success', (data) => resolve(data));
  });

  adminSocket2.emit('reconnect-attempt', {
    pin: newRoom.pin,
    playerId: 'admin',
    adminToken: newRoom.adminToken
  });

  const reconData = await reconnectPromise;
  console.log('✓ Reconnect success payload received:', reconData.pin);
  assert.strictEqual(reconData.pin, newRoom.pin, 'reconnect-success must contain the active PIN');

  // Scenario 4: Query active rooms API to verify PIN is listed for students
  console.log('4. Verifying /api/active-rooms includes the new PIN...');
  const resp = await fetch(`${SERVER_URL}/api/active-rooms`);
  const activeRooms = await resp.json();
  assert.ok(activeRooms.success);
  const matchedRoom = activeRooms.rooms.find(r => r.pin === newRoom.pin);
  assert.ok(matchedRoom, 'Newly created room must be present in /api/active-rooms');
  console.log('✓ Room confirmed in active-rooms API with PIN:', matchedRoom.pin);

  adminSocket.close();
  adminSocket2.close();
  console.log('--- ALL ADMIN PIN RECOVERY TESTS PASSED! ---');
  process.exit(0);
}

testAdminRecovery().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
