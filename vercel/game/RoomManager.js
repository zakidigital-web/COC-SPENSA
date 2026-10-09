const { v4: uuidv4 } = require('uuid');

/**
 * Manages game rooms, players, and session state.
 */
class RoomManager {
  constructor() {
    // Maps a 6-digit PIN to a Room object
    this.rooms = new Map();
    // Maps a socket.id to a 6-digit PIN for quick lookups on disconnects (mostly for admin)
    this.socketToRoom = new Map();
    // Maps a socket.id to { pin, playerId } for O(1) player lookup
    this.socketToPlayer = new Map();
    this.defaultMaxPlayers = 50;
  }

  /**
   * Generates a unique 6-digit PIN for a new room.
   * @returns {string} 6-digit PIN
   */
  generatePin() {
    let pin;
    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
    } while (this.rooms.has(pin));
    return pin;
  }

  /**
   * Creates a new game room.
   * @param {string} socketId - The socket ID of the room creator (admin).
   * @param {number} [maxPlayers] - Maximum number of players allowed.
   * @returns {Object} Object containing the generated pin and the room object.
   */
  createRoom(socketId, maxPlayers, meta = {}) {
    const pin = this.generatePin();
    const adminToken = uuidv4();
    const room = {
      pin: pin,
      adminToken: adminToken,
      adminSocketId: socketId,
      status: 'lobby', // 'lobby' | 'playing' | 'paused' | 'ended'
      players: new Map(),
      questions: [],
      boxes: [],
      maxPlayers: maxPlayers || this.defaultMaxPlayers,
      guruId: meta.guruId || null,
      guruName: meta.guruName || 'Guru Anonim',
      isAnonymous: meta.isAnonymous !== undefined ? Boolean(meta.isAnonymous) : (!meta.guruId),
      title: meta.title || 'Kuis Clash of Champion',
      config: {
        timePerQuestion: 30, // seconds
        globalTimeLimit: 0, // seconds (0 = unlimited)
        enablePenalty: false,
        penaltyPoints: 0,
        speedBonusMultiplier: 0.5,
        streakThresholds: [
          { count: 3, multiplier: 1.5 },
          { count: 5, multiplier: 2.0 }
        ]
      },
      createdAt: new Date()
    };

    this.rooms.set(pin, room);
    this.socketToRoom.set(socketId, pin);

    return { pin, room, adminToken };
  }

  /**
   * Adds a player to a specific room.
   * @param {string} pin - The room PIN.
   * @param {string} socketId - The player's socket ID.
   * @param {string} nickname - The player's chosen nickname.
   * @param {number} avatar - The player's chosen avatar ID.
   * @returns {Object} Object containing the player and room.
   * @throws Will throw an error if room doesn't exist or game already started.
   */
  joinRoom(pin, socketId, nickname, avatar, extra = {}) {
    const cleanPin = pin ? String(pin).trim() : '';
    const room = this.rooms.get(cleanPin);
    
    if (!room) {
      throw new Error(`Room dengan PIN ${cleanPin || pin} tidak ditemukan. Periksa kembali PIN Anda.`);
    }

    if (room.status === 'ended') {
      throw new Error('Kuis di room ini sudah berakhir.');
    }

    if (room.players.size >= room.maxPlayers) {
      throw new Error('Room sudah penuh (maksimal ' + room.maxPlayers + ' siswa).');
    }

    // Check if player with same studentId is already in room and reconnect them!
    if (extra.studentId) {
      for (const p of room.players.values()) {
        if (p.studentId === extra.studentId) {
          p.socketId = socketId;
          p.connected = true;
          this.socketToPlayer.set(socketId, { pin: cleanPin, playerId: p.id });
          return { player: p, room, reconnected: true };
        }
      }
    }

    // If nickname already taken: auto-disambiguate so no student is blocked!
    let finalNickname = (nickname || 'Siswa').trim();
    let counter = 2;
    let nameTaken = true;
    while (nameTaken) {
      nameTaken = false;
      for (const p of room.players.values()) {
        if (p.nickname.toLowerCase() === finalNickname.toLowerCase()) {
          finalNickname = `${(nickname || 'Siswa').trim()} (${counter++})`;
          nameTaken = true;
          break;
        }
      }
    }

    const playerId = uuidv4();
    const player = {
      id: playerId,
      socketId: socketId,
      nickname: finalNickname,
      avatar: avatar,
      studentId: extra.studentId || null,
      studentIdentifier: extra.studentIdentifier || finalNickname,
      isAnonymous: extra.isAnonymous !== undefined ? Boolean(extra.isAnonymous) : (!extra.studentId),
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      totalAnswered: 0,
      boxesClaimed: 0,
      fastestAnswer: null, // ms
      connected: true
    };

    room.players.set(playerId, player);
    this.socketToPlayer.set(socketId, { pin: cleanPin, playerId });

    return { player, room };
  }

  /**
   * Kicks a player from a room.
   * @param {string} pin - The room PIN.
   * @param {string} playerId - The player ID.
   * @returns {Object|null} Information about kicked player and socket ID.
   */
  kickPlayer(pin, playerId) {
    const room = this.rooms.get(pin);
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player) return null;

    room.players.delete(playerId);
    this.socketToPlayer.delete(player.socketId);
    return { player, socketId: player.socketId, room };
  }

  /**
   * Retrieves a room by its PIN.
   * @param {string} pin - The room PIN.
   * @returns {Object|null} The room object or null if not found.
   */
  /**
   * Retrieves a room by its PIN.
   * @param {string} pin - The room PIN.
   * @returns {Object|null} The room object or null if not found.
   */
  getRoom(pin) {
    const cleanPin = (pin || '').toString().trim();
    return this.rooms.get(cleanPin) || null;
  }

  /**
   * Retrieves a player by their socket ID in O(1) time.
   * @param {string} socketId - The socket ID.
   * @returns {Object|null} Object containing { pin, playerId, player } or null.
   */
  getPlayerBySocket(socketId) {
    const info = this.socketToPlayer.get(socketId);
    if (!info) return null;
    const room = this.rooms.get(info.pin);
    if (!room) return null;
    const player = room.players.get(info.playerId);
    if (!player) return null;
    return { pin: info.pin, playerId: info.playerId, player };
  }

  /**
   * Retrieves an array of all players who joined a room.
   * @param {string} pin - The room PIN.
   * @returns {Array} Array of player objects.
   */
  getPlayerList(pin) {
    const cleanPin = (pin || '').toString().trim();
    const room = this.rooms.get(cleanPin);
    if (!room) return [];
    return Array.from(room.players.values()).map(p => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      studentIdentifier: p.studentIdentifier,
      connected: p.connected !== false
    }));
  }

  /**
   * Handles player disconnection by marking them as disconnected.
   * @param {string} socketId - The disconnecting socket ID.
   * @returns {Object|null} Object containing pin, player, isAdmin flags, or null if not found.
   */
  removePlayer(socketId) {
    // Check if it's an admin first
    const adminPin = this.socketToRoom.get(socketId);
    if (adminPin) {
      const room = this.rooms.get(adminPin);
      if (room && room.adminSocketId === socketId) {
        this.socketToRoom.delete(socketId);
        return { pin: adminPin, player: null, isAdmin: true };
      }
    }

    // Check if it's a player
    const info = this.socketToPlayer.get(socketId);
    if (!info) return null;

    const { pin, playerId } = info;
    const room = this.rooms.get(pin);
    this.socketToPlayer.delete(socketId);

    if (!room) return null;

    const player = room.players.get(playerId);
    if (player) {
      player.connected = false;
      return { pin, player, isAdmin: false };
    }

    return null;
  }

  /**
   * Reconnects a previously disconnected player.
   * @param {string} pin - The room PIN.
   * @param {string} playerId - The player's unique ID.
   * @param {string} newSocketId - The player's new socket ID.
   * @returns {Object} The reconnected player object.
   * @throws Error if room or player not found.
   */
  reconnectPlayer(pin, playerId, newSocketId) {
    const cleanPin = (pin || '').toString().trim();
    const room = this.rooms.get(cleanPin);
    if (!room) throw new Error('Room not found');

    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');

    player.socketId = newSocketId;
    player.connected = true;
    
    this.socketToPlayer.set(newSocketId, { pin: cleanPin, playerId });
    
    return { player, room };
  }

  /**
   * Reconnects an admin using their secure lease token.
   * @param {string} pin - The room PIN.
   * @param {string} adminToken - The unique admin lease token.
   * @param {string} newSocketId - The admin's new socket ID.
   * @returns {Object} The room object.
   */
  reconnectAdmin(pin, adminToken, newSocketId) {
    const cleanPin = (pin || '').toString().trim();
    const room = this.rooms.get(cleanPin);
    if (!room) throw new Error('Room tidak ditemukan atau telah berakhir');
    if (!adminToken || !room.adminToken || adminToken !== room.adminToken) {
      throw new Error('Token otorisasi admin tidak valid atau tidak disertakan');
    }

    room.adminSocketId = newSocketId;
    this.socketToRoom.set(newSocketId, cleanPin);
    return { room };
  }
}

module.exports = RoomManager;
