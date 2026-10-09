const { v4: uuidv4 } = require('uuid');

/**
 * Core engine managing game mechanics, scoring, and box lifecycle.
 */
class GameEngine {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
    this.leaderboardCache = new Map(); // pin -> { data: [], dirty: true, lastCalc: timestamp }
  }

  /**
   * Starts the game, locks the lobby, and prepares questions into boxes.
   * @param {string} pin - Room PIN.
   * @param {string} adminSocketId - Socket ID requesting the start.
   * @returns {Array} Array of prepared boxes.
   */
  startGame(pin, adminSocketId, customConfig = null) {
    const room = this.roomManager.getRoom(pin);
    if (!room) throw new Error('Room not found');
    if (room.adminSocketId !== adminSocketId) throw new Error('Unauthorized');
    if (room.questions.length === 0) throw new Error('Not enough questions to start');

    if (customConfig && typeof customConfig === 'object') {
      room.config = { ...room.config, ...customConfig };
    }

    room.status = 'playing';

    // Clear any existing global timer
    if (room.globalTimer) {
      clearTimeout(room.globalTimer);
      room.globalTimer = null;
    }

    // Set authoritative global match timer if configured (> 0)
    if (room.config.globalTimeLimit && Number(room.config.globalTimeLimit) > 0) {
      const globalSec = Number(room.config.globalTimeLimit);
      room.globalEndTime = Date.now() + (globalSec * 1000);
      room.globalTimer = setTimeout(() => {
        this.endGame(pin);
      }, globalSec * 1000);
    } else {
      room.globalEndTime = null;
    }

    // Build O(1) question lookup map
    room.questionMap = new Map();
    for (const q of room.questions) {
      if (!q.id) q.id = uuidv4();
      room.questionMap.set(q.id, q);
    }

    // Shuffle questions to randomize box contents
    const shuffledQuestions = [...room.questions].sort(() => Math.random() - 0.5);

    // Check mystery points mode
    const isMystery = Boolean(room.config.mysteryPoints || room.config.hidePoints);
    const mysteryValues = [50, 75, 100, 150, 200, 250, 300];

    room.boxes = shuffledQuestions.map((q, index) => {
      let finalPoints = q.points || 100;
      if (isMystery && (room.config.randomizeMystery !== false || room.config.randomizePoints || !q.points)) {
        finalPoints = mysteryValues[Math.floor(Math.random() * mysteryValues.length)];
      }
      return {
        index,
        questionId: q.id,
        points: finalPoints,
        isMystery: isMystery,
        status: 'available', // 'available' | 'locked' | 'completed'
        lockedBy: null,
        lockedByName: null,
        lockedAt: null,
        completedBy: null,
        answeredCorrectly: null,
        timeoutTimer: null
      };
    });

    return this._sanitizeBoxesForClient(room.boxes);
  }

  /**
   * Atomically claims a box for a player.
   * @param {string} pin - Room PIN.
   * @param {string} playerId - ID of player claiming.
   * @param {number} boxIndex - Index of the box to claim.
   * @returns {Object} Result object.
   */
  claimBox(pin, playerId, boxIndex) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'playing') {
      return { success: false, reason: 'Game not active' };
    }

    const player = room.players.get(playerId);
    if (!player || !player.connected) {
      return { success: false, reason: 'Player not found or disconnected' };
    }

    // Rate limit: 500ms
    const now = Date.now();
    if (player.lastClaimTime && now - player.lastClaimTime < 500) {
      return { success: false, reason: 'Tunggu sebentar sebelum memilih soal lagi' };
    }
    player.lastClaimTime = now;

    // Check if holding a box already
    const heldBox = room.boxes.find(b => b.status === 'locked' && b.lockedBy === playerId);
    if (heldBox) {
      return { success: false, reason: 'Selesaikan soal sebelumnya' };
    }

    const box = room.boxes[boxIndex];
    if (!box) {
      return { success: false, reason: 'Box not found' };
    }

    // ATOMIC CHECK AND LOCK
    if (box.status !== 'available') {
      return { success: false, reason: 'Box already taken' };
    }

    box.status = 'locked';
    box.lockedBy = playerId;
    box.lockedByName = player.nickname;
    box.lockedAt = Date.now();

    const timeLimitMs = room.config.timePerQuestion * 1000;
    box.timeoutTimer = setTimeout(() => {
      this.releaseBox(pin, boxIndex, 'timeout');
    }, timeLimitMs);

    player.boxesClaimed += 1;

    return { 
      success: true, 
      box: this._sanitizeBoxForClient(box),
      originalPoints: box.points,
      isMystery: Boolean(box.isMystery)
    };
  }

  /**
   * Releases a previously locked box back to the available pool.
   * @param {string} pin - Room PIN.
   * @param {number} boxIndex - Index of the box.
   * @param {string} reason - Reason for release (e.g., 'timeout', 'disconnect').
   */
  releaseBox(pin, boxIndex, reason) {
    const room = this.roomManager.getRoom(pin);
    if (!room) return;

    const box = room.boxes[boxIndex];
    if (!box || box.status !== 'locked') return;

    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
      box.timeoutTimer = null;
    }

    if (box.lockedBy) {
      const player = room.players.get(box.lockedBy);
      if (player && player.boxesClaimed > 0) {
        player.boxesClaimed -= 1;
      }
    }

    box.status = 'available';
    box.lockedBy = null;
    box.lockedByName = null;
    box.lockedAt = null;

    this.io.to(pin).emit('box-released', {
      timestamp: Date.now(),
      boxIndex,
      reason
    });
  }

  /**
   * Teacher / Admin claims a box directly to operate in class or solo mode.
   * @param {string} pin - Room PIN.
   * @param {number} boxIndex - Index of the box.
   * @returns {Object} Result object including the full question data with answers.
   */
  adminClaimBox(pin, boxIndex) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'playing') {
      return { success: false, reason: 'Game belum aktif' };
    }

    const box = room.boxes[boxIndex];
    if (!box) {
      return { success: false, reason: 'Kotak tidak ditemukan' };
    }

    const question = room.questionMap.get(box.questionId);

    if (box.status === 'completed') {
      return {
        success: true,
        alreadyCompleted: true,
        box: this._sanitizeBoxForClient(box),
        question: question ? { ...question } : null
      };
    }

    // Clear timeout if held by anyone
    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
      box.timeoutTimer = null;
    }

    box.status = 'locked';
    box.lockedBy = 'admin';
    box.lockedByName = 'Guru (Layar Kelas)';
    box.lockedAt = Date.now();

    return {
      success: true,
      alreadyCompleted: false,
      box: this._sanitizeBoxForClient(box),
      question: question ? { ...question } : null
    };
  }

  /**
   * Teacher / Admin completes a box (marking correct/wrong).
   * @param {string} pin - Room PIN.
   * @param {number} boxIndex - Index of the box.
   * @param {boolean} isCorrect - Whether answered correctly.
   * @param {number} customPoints - Optional points.
   * @returns {Object} Result object.
   */
  adminCompleteBox(pin, boxIndex, isCorrect, customPoints) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'playing') {
      return { success: false, reason: 'Game belum aktif' };
    }

    const box = room.boxes[boxIndex];
    if (!box) {
      return { success: false, reason: 'Kotak tidak ditemukan' };
    }

    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
      box.timeoutTimer = null;
    }

    let pointsAwarded = 0;
    if (isCorrect) {
      if (customPoints !== undefined && customPoints !== null && !isNaN(Number(customPoints)) && Number(customPoints) > 0) {
        pointsAwarded = Number(customPoints);
      } else {
        pointsAwarded = Number(box.points) || 100;
      }
    }
    
    box.status = 'completed';
    box.completedBy = 'admin';
    box.answeredCorrectly = Boolean(isCorrect);

    room.soloScore = (room.soloScore || 0) + pointsAwarded;
    if (isCorrect) {
      room.soloCorrectCount = (room.soloCorrectCount || 0) + 1;
    }
    room.soloTotalAnswered = (room.soloTotalAnswered || 0) + 1;

    const isGameOver = room.boxes.every(b => b.status === 'completed');
    if (isGameOver) {
      setTimeout(() => this.endGame(pin), 1000);
    }

    return {
      success: true,
      box: this._sanitizeBoxForClient(box),
      correct: Boolean(isCorrect),
      points: pointsAwarded,
      soloScore: room.soloScore,
      isGameOver
    };
  }

  /**
   * Teacher / Admin releases a locked box back to available pool.
   * @param {string} pin - Room PIN.
   * @param {number} boxIndex - Index of the box.
   * @returns {Object} Result object.
   */
  adminReleaseBox(pin, boxIndex) {
    const room = this.roomManager.getRoom(pin);
    if (!room) return { success: false, reason: 'Room tidak ditemukan' };

    const box = room.boxes[boxIndex];
    if (!box || box.status !== 'locked') return { success: false, reason: 'Kotak tidak terkunci' };

    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
      box.timeoutTimer = null;
    }

    box.status = 'available';
    box.lockedBy = null;
    box.lockedByName = null;
    box.lockedAt = null;

    return { success: true };
  }

  /**
   * Processes a submitted answer, updates scores and streaks, and resolves the box.
   * @param {string} pin - Room PIN.
   * @param {string} playerId - Player ID submitting.
   * @param {number} boxIndex - Box being answered.
   * @param {any} answer - The submitted answer.
   * @returns {Object} Result of the submission.
   */
  submitAnswer(pin, playerId, boxIndex, answer) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'playing') throw new Error('Invalid game state');

    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');

    const box = room.boxes[boxIndex];
    if (!box || box.status !== 'locked' || box.lockedBy !== playerId) {
      throw new Error('You do not own this box');
    }

    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
      box.timeoutTimer = null;
    }

    const question = room.questionMap.get(box.questionId);
    if (!question) throw new Error('Question not found');

    const timeTakenMs = Date.now() - box.lockedAt;
    const timeLimitMs = room.config.timePerQuestion * 1000;
    const timeRemainingMs = Math.max(0, timeLimitMs - timeTakenMs);

    player.totalAnswered += 1;
    const isCorrect = this.checkAnswer(question, answer);
    
    let basePoints = 0;
    let speedBonus = 0;
    let streakMultiplier = 1;
    let totalPoints = 0;

    if (isCorrect) {
      player.correctCount += 1;
      player.streak += 1;
      if (player.streak > player.maxStreak) player.maxStreak = player.streak;

      if (player.fastestAnswer === null || timeTakenMs < player.fastestAnswer) {
        player.fastestAnswer = timeTakenMs;
      }

      basePoints = box.points;
      
      const scoreCalc = this.calculateScore(
        basePoints, 
        timeRemainingMs, 
        timeLimitMs, 
        player.streak, 
        room.config
      );

      speedBonus = scoreCalc.speedBonus;
      streakMultiplier = scoreCalc.streakMultiplier;
      totalPoints = scoreCalc.total;

      player.score += totalPoints;
    } else {
      player.streak = 0;
      if (room.config.enablePenalty) {
        totalPoints = -room.config.penaltyPoints;
        player.score = Math.max(0, player.score + totalPoints);
      }
    }

    box.status = 'completed';
    box.completedBy = playerId;
    box.answeredCorrectly = isCorrect;

    // Mark leaderboard dirty
    const cache = this.leaderboardCache.get(pin);
    if (cache) cache.dirty = true;
    else this.leaderboardCache.set(pin, { data: [], dirty: true, lastCalc: 0 });

    const isGameOver = room.boxes.every(b => b.status === 'completed');
    if (isGameOver) {
      setTimeout(() => this.endGame(pin), 1000);
    }

    return {
      correct: isCorrect,
      basePoints,
      speedBonus,
      streakMultiplier,
      totalPoints,
      streak: player.streak
    };
  }

  /**
   * Validates an answer against a question's correct answer logic.
   * @param {Object} question - The question object.
   * @param {any} answer - The submitted answer.
   * @returns {boolean} True if correct.
   */
  checkAnswer(question, answer) {
    if (answer === null || answer === undefined) return false;

    const type = (question.type || '').toLowerCase();
    const isMc = type === 'multiple_choice' || type === 'mc' || type === 'pg';
    const isTf = type === 'true_false' || type === 'tf';
    const isShort = type === 'short_answer' || type === 'short' || type === 'isian';
    const isMatch = type === 'matching' || type === 'match';

    if (isMc) {
      // Determine correct answer string and index
      const correctAnsStr = question.correctAnswer !== undefined ? String(question.correctAnswer).trim().toLowerCase() : null;
      const correctIdx = question.correctIndex !== undefined ? Number(question.correctIndex) : -1;
      const options = Array.isArray(question.options) ? question.options : [];

      // If submitted answer is a number or numeric string (index)
      if (typeof answer === 'number' || (/^\d+$/.test(String(answer).trim()))) {
        const numAns = Number(answer);
        if (correctIdx !== -1 && numAns === correctIdx) return true;
        if (options[numAns] && correctAnsStr && options[numAns].trim().toLowerCase() === correctAnsStr) return true;
      }

      // If submitted answer is option letter like 'A', 'B', 'C', 'D'
      const trimmedUpper = String(answer).trim().toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(trimmedUpper)) {
        const letterIdx = trimmedUpper.charCodeAt(0) - 65;
        if (correctIdx !== -1 && letterIdx === correctIdx) return true;
        if (options[letterIdx] && correctAnsStr && options[letterIdx].trim().toLowerCase() === correctAnsStr) return true;
      }

      // If submitted answer is exact text string
      const trimmedAns = String(answer).trim().toLowerCase();
      if (correctAnsStr && trimmedAns === correctAnsStr) return true;
      if (correctIdx !== -1 && options[correctIdx] && trimmedAns === options[correctIdx].trim().toLowerCase()) return true;

      return false;
    }

    if (isTf) {
      let expectedBool = null;
      if (typeof question.correctAnswer === 'boolean') expectedBool = question.correctAnswer;
      else if (typeof question.correct === 'boolean') expectedBool = question.correct;
      else if (question.correctAnswer !== undefined) {
        const s = String(question.correctAnswer).toLowerCase();
        expectedBool = (s === 'true' || s === 'benar' || s === 'b' || s === '1');
      }

      let submittedBool = null;
      if (typeof answer === 'boolean') submittedBool = answer;
      else {
        const s = String(answer).toLowerCase().trim();
        submittedBool = (s === 'true' || s === 'benar' || s === 'b' || s === '1');
      }

      return expectedBool !== null && expectedBool === submittedBool;
    }

    if (isShort) {
      const correctText = question.correctAnswer !== undefined ? question.correctAnswer : question.correctText;
      if (correctText === undefined || correctText === null) return false;
      return String(answer).trim().toLowerCase() === String(correctText).trim().toLowerCase();
    }

    if (isMatch) {
      const pairs = question.matchingPairs || question.pairs;
      if (!Array.isArray(answer) || !Array.isArray(pairs)) return false;
      if (answer.length !== pairs.length) return false;

      // Handle both formats: [{left, right}] and index-based [{leftIdx, rightIdx}]
      const isIndexBased = answer.every(a => a && typeof a.leftIdx === 'number' && typeof a.rightIdx === 'number');
      if (isIndexBased) {
        // In index-based matching, each left index must correctly map to the corresponding right index
        return answer.every(submitted => submitted.leftIdx === submitted.rightIdx);
      }

      const usedIndices = new Set();
      return answer.every(submittedPair => {
        const matchIdx = pairs.findIndex((correctPair, idx) => 
          !usedIndices.has(idx) &&
          correctPair.left === submittedPair.left && 
          correctPair.right === submittedPair.right
        );
        if (matchIdx === -1) return false;
        usedIndices.add(matchIdx);
        return true;
      });
    }

    return false;
  }

  /**
   * Calculates total points considering speed and streaks.
   * @param {number} basePoints - Base question points.
   * @param {number} timeRemainingMs - Milliseconds left on the clock.
   * @param {number} totalTimeMs - Total milliseconds allowed.
   * @param {number} streak - Current correct streak.
   * @param {Object} config - Room configuration.
   * @returns {Object} Score breakdown.
   */
  calculateScore(basePoints, timeRemainingMs, totalTimeMs, streak, config) {
    const timeRatio = timeRemainingMs / totalTimeMs;
    const speedBonus = Math.round(timeRatio * basePoints * config.speedBonusMultiplier);
    
    let streakMultiplier = 1.0;
    const sortedThresholds = [...config.streakThresholds].sort((a, b) => b.count - a.count);
    
    for (const threshold of sortedThresholds) {
      if (streak >= threshold.count) {
        streakMultiplier = threshold.multiplier;
        break;
      }
    }

    const total = Math.round((basePoints + speedBonus) * streakMultiplier);

    return { speedBonus, streakMultiplier, total };
  }

  /**
   * Generates the current leaderboard utilizing a cache.
   * @param {string} pin - Room PIN.
   * @returns {Array} Sorted array of player stats.
   */
  getLeaderboard(pin) {
    const cache = this.leaderboardCache.get(pin);
    if (cache && !cache.dirty) {
      return cache.data;
    }

    const room = this.roomManager.getRoom(pin);
    if (!room) return [];

    const playersArray = Array.from(room.players.values());
    
    playersArray.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.fastestAnswer !== null && b.fastestAnswer !== null) {
        return a.fastestAnswer - b.fastestAnswer;
      }
      return 0;
    });

    const data = playersArray.map((p, index) => ({
      playerId: p.id,
      studentId: p.studentId || null,
      studentIdentifier: p.studentIdentifier || p.nickname,
      isAnonymous: p.isAnonymous,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
      rank: index + 1,
      boxesClaimed: p.boxesClaimed || 0,
      boxesTaken: p.boxesClaimed || 0,
      accuracy: p.totalAnswered > 0 ? Math.round((p.correctCount / p.totalAnswered) * 100) : 0,
      maxStreak: p.maxStreak || p.streak || 0,
      correctCount: p.correctCount || 0,
      totalAnswered: p.totalAnswered || 0
    }));

    this.leaderboardCache.set(pin, {
      data,
      dirty: false,
      lastCalc: Date.now()
    });

    return data;
  }

  /**
   * Generates end-of-game results, podium, and special titles.
   * @param {string} pin - Room PIN.
   * @returns {Object} Structured game results.
   */
  getGameResults(pin) {
    const room = this.roomManager.getRoom(pin);
    if (!room) return null;

    const fullRanking = this.getLeaderboard(pin);
    const podium = fullRanking.slice(0, 3);
    const playersArray = Array.from(room.players.values());

    let fastest = null;
    let mostBoxes = null;
    let bestAccuracy = null;

    for (const p of playersArray) {
      if (p.fastestAnswer !== null) {
        if (!fastest || p.fastestAnswer < fastest.fastestAnswer) fastest = p;
      }
      if (!mostBoxes || p.boxesClaimed > mostBoxes.boxesClaimed) mostBoxes = p;
      if (p.totalAnswered >= 3) {
        const accuracy = p.correctCount / p.totalAnswered;
        if (!bestAccuracy || accuracy > bestAccuracy.accuracy) {
          bestAccuracy = { ...p, accuracy };
        }
      }
    }

    const highest = fullRanking.length > 0 ? fullRanking[0] : null;

    return {
      podium,
      fullRanking,
      isSolo: playersArray.length === 0,
      soloScore: room.soloScore || 0,
      soloCorrectCount: room.soloCorrectCount || 0,
      soloTotalAnswered: room.soloTotalAnswered || 0,
      totalBoxes: room.boxes ? room.boxes.length : 0,
      titles: {
        fastest: fastest ? { nickname: fastest.nickname, ms: fastest.fastestAnswer } : null,
        highest: highest ? { nickname: highest.nickname, score: highest.score } : null,
        mostBoxes: mostBoxes ? { nickname: mostBoxes.nickname, count: mostBoxes.boxesClaimed } : null,
        bestAccuracy: bestAccuracy ? { nickname: bestAccuracy.nickname, accuracy: bestAccuracy.accuracy } : null,
        explorer: mostBoxes ? { nickname: mostBoxes.nickname, count: mostBoxes.boxesClaimed } : null,
        accurate: bestAccuracy ? { nickname: bestAccuracy.nickname, accuracy: bestAccuracy.accuracy } : null
      }
    };
  }

  /**
   * Ends the game and calculates final results.
   * @param {string} pin - Room PIN.
   */
  endGame(pin) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status === 'ended') return;

    room.status = 'ended';

    if (room.globalTimer) {
      clearTimeout(room.globalTimer);
      room.globalTimer = null;
    }

    room.boxes.forEach(box => {
      if (box.timeoutTimer) {
        clearTimeout(box.timeoutTimer);
        box.timeoutTimer = null;
      }
    });

    const results = this.getGameResults(pin);
    let savedSessionId = null;

    // Automatically persist to DB if teacher is logged in (NOT anonymous)
    if (!room.isAnonymous && room.guruId) {
      try {
        const AppDatabase = require('./Database');
        const sessionId = uuidv4();
        savedSessionId = sessionId;
        AppDatabase.saveGameSession({
          id: sessionId,
          pin: pin,
          guruId: room.guruId,
          guruName: room.guruName,
          title: room.title || 'Kuis Clash of Champion',
          totalQuestions: room.questions ? room.questions.length : (room.boxes ? room.boxes.length : 0),
          totalPlayers: room.players.size,
          results
        }).then(() => {
          console.log(`[GameEngine] Sesi game berhasil disimpan ke DB. ID: ${sessionId}, Guru: ${room.guruName}`);
        }).catch(err => {
          console.error('[GameEngine] Gagal menyimpan sesi game ke DB:', err.message);
        });
      } catch (err) {
        console.error('[GameEngine] Gagal menyimpan sesi game ke DB:', err.message);
      }
    }

    this.io.to(pin).emit('game-ended', { 
      timestamp: Date.now(), 
      results,
      saved: Boolean(savedSessionId),
      sessionId: savedSessionId
    });
  }

  /**
   * Pauses the game, freezing all active timeouts.
   * @param {string} pin - Room PIN.
   */
  pauseGame(pin) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'playing') return;

    room.status = 'paused';

    // Freeze global countdown timer if running
    if (room.globalTimer && room.globalEndTime) {
      clearTimeout(room.globalTimer);
      room.globalTimer = null;
      room.globalRemainingMs = Math.max(0, room.globalEndTime - Date.now());
    }

    const now = Date.now();
    const timeLimitMs = room.config.timePerQuestion * 1000;

    room.boxes.forEach(box => {
      if (box.status === 'locked' && box.timeoutTimer) {
        clearTimeout(box.timeoutTimer);
        box.timeoutTimer = null;
        const timePassed = now - box.lockedAt;
        box.pausedRemainingMs = Math.max(0, timeLimitMs - timePassed);
      }
    });
  }

  /**
   * Resumes a paused game, restarting timeouts.
   * @param {string} pin - Room PIN.
   */
  resumeGame(pin) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'paused') return;

    room.status = 'playing';

    // Resume global countdown timer
    if (room.globalRemainingMs !== undefined) {
      room.globalEndTime = Date.now() + room.globalRemainingMs;
      room.globalTimer = setTimeout(() => {
        this.endGame(pin);
      }, room.globalRemainingMs);
      delete room.globalRemainingMs;
    }

    room.boxes.forEach((box, index) => {
      if (box.status === 'locked' && box.pausedRemainingMs !== undefined) {
        const timeLimitMs = room.config.timePerQuestion * 1000;
        box.lockedAt = Date.now() - (timeLimitMs - box.pausedRemainingMs);

        box.timeoutTimer = setTimeout(() => {
          this.releaseBox(pin, index, 'timeout');
        }, box.pausedRemainingMs);

        delete box.pausedRemainingMs;
      }
    });
  }

  /**
   * Prepares a question for the client by stripping correct answers.
   * @param {Object} question - The raw question object.
   * @returns {Object} Safe question object.
   */
  getQuestionForPlayer(question) {
    const isMc = question.type === 'multiple_choice' || question.type === 'mc' || question.type === 'pg';
    const isMatch = question.type === 'matching' || question.type === 'match';

    const safeQ = {
      id: question.id,
      type: question.type,
      text: question.text || question.question || '',
      question: question.question || question.text || '',
      points: question.points || 100
    };

    if (isMc) {
      safeQ.options = Array.isArray(question.options) ? [...question.options] : [];
    } else if (isMatch) {
      const pairs = question.matchingPairs || question.pairs || [];
      const shuffledLeft = pairs.map(p => p.left).sort(() => Math.random() - 0.5);
      const shuffledRight = pairs.map(p => p.right).sort(() => Math.random() - 0.5);
      safeQ.leftItems = shuffledLeft;
      safeQ.rightItems = shuffledRight;
      safeQ.lefts = shuffledLeft;
      safeQ.rights = shuffledRight;
    }

    // Explicitly ensure zero answer leaks
    delete safeQ.correctAnswer;
    delete safeQ.correctIndex;
    delete safeQ.correct;
    delete safeQ.correctText;
    delete safeQ.matchingPairs;
    delete safeQ.pairs;

    return safeQ;
  }

  /**
   * Handles player disconnect by checking if they hold a locked box.
   * Gives a 60-second grace period before releasing their box.
   * @param {string} pin - Room PIN.
   * @param {string} playerId - Disconnected player ID.
   */
  handlePlayerDisconnect(pin, playerId) {
    const room = this.roomManager.getRoom(pin);
    if (!room || room.status !== 'playing') return;

    const heldBoxIndex = room.boxes.findIndex(b => b.status === 'locked' && b.lockedBy === playerId);
    if (heldBoxIndex === -1) return;

    const box = room.boxes[heldBoxIndex];
    
    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
    }

    box.timeoutTimer = setTimeout(() => {
      this.releaseBox(pin, heldBoxIndex, 'disconnect_timeout');
    }, 60000);
  }

  /**
   * Returns a compact array of box statuses for efficient broadcast.
   * @param {string} pin - Room PIN.
   * @returns {Array} Compact summary of boxes.
   */
  getBoxStatusSummary(pin) {
    const room = this.roomManager.getRoom(pin);
    if (!room) return [];
    
    return room.boxes.map(box => ({
      index: box.index,
      status: box.status,
      lockedByName: box.lockedByName,
      points: box.points
    }));
  }

  /**
   * Extends the time remaining on all currently locked boxes.
   * @param {string} pin - Room PIN.
   * @param {number} extraSeconds - Extra seconds to add.
   */
  extendTime(pin, extraSeconds = 30) {
    const room = this.roomManager.getRoom(pin);
    if (!room || (room.status !== 'playing' && room.status !== 'paused')) return;

    const extraMs = extraSeconds * 1000;
    room.boxes.forEach((box, index) => {
      if (box.status === 'locked') {
        if (box.timeoutTimer) {
          clearTimeout(box.timeoutTimer);
          const elapsed = Date.now() - box.lockedAt;
          const currentLimitMs = room.config.timePerQuestion * 1000;
          const newRemaining = Math.max(0, currentLimitMs - elapsed) + extraMs;
          box.timeoutTimer = setTimeout(() => {
            this.releaseBox(pin, index, 'timeout');
          }, newRemaining);
        } else if (box.pausedRemainingMs !== undefined) {
          box.pausedRemainingMs += extraMs;
        }
      }
    });

    // Also extend global countdown match timer if active
    if (room.config.globalTimeLimit && Number(room.config.globalTimeLimit) > 0) {
      if (room.globalTimer) clearTimeout(room.globalTimer);
      const remainingMs = Math.max(0, (room.globalEndTime || Date.now()) - Date.now()) + extraMs;
      room.globalEndTime = Date.now() + remainingMs;
      room.globalTimer = setTimeout(() => {
        this.endGame(pin);
      }, remainingMs);
    }

    this.io.to(pin).emit('time-extended', {
      timestamp: Date.now(),
      extraSeconds,
      globalEndTime: room.globalEndTime || null
    });
  }

  /**
   * Voids a box in case of emergency or faulty question.
   * @param {string} pin - Room PIN.
   * @param {number} boxIndex - Index of the box to void.
   */
  voidBox(pin, boxIndex) {
    const room = this.roomManager.getRoom(pin);
    if (!room) return;
    const box = room.boxes[boxIndex];
    if (!box) return;

    if (box.timeoutTimer) {
      clearTimeout(box.timeoutTimer);
      box.timeoutTimer = null;
    }

    const wasLockedBy = box.lockedBy;
    box.status = 'completed';
    box.completedBy = wasLockedBy || 'voided';
    box.answeredCorrectly = true;

    if (wasLockedBy) {
      const player = room.players.get(wasLockedBy);
      if (player) {
        player.score += box.points;
        player.correctCount += 1;
        player.totalAnswered += 1;
      }
    }

    this.io.to(pin).emit('box-completed', {
      timestamp: Date.now(),
      boxIndex,
      completedBy: wasLockedBy || 'voided',
      correct: true,
      voided: true
    });

    this.leaderboardCache.set(pin, { dirty: true });
    this.io.to(pin).emit('leaderboard-updated', {
      timestamp: Date.now(),
      leaderboard: this.getLeaderboard(pin)
    });
  }

  getAdminBoxesInspection(pin) {
    const room = this.roomManager.getRoom(pin);
    if (!room || !room.boxes) return [];
    return room.boxes.map((b) => {
      const q = room.questionMap ? room.questionMap.get(b.questionId) : null;
      return {
        index: b.index,
        questionId: b.questionId,
        points: b.points,
        isMystery: Boolean(b.isMystery),
        status: b.status,
        lockedBy: b.lockedBy,
        lockedByName: b.lockedByName,
        completedBy: b.completedBy,
        answeredCorrectly: b.answeredCorrectly,
        questionText: q ? (q.text || q.question || '') : '',
        questionSnippet: q ? ((q.text || q.question || '').length > 60 ? (q.text || q.question || '').substring(0, 60) + '...' : (q.text || q.question || '')) : '',
        questionType: q ? (q.type || 'mc') : 'mc',
        correctAnswer: q ? (q.correctAnswer ?? q.answer ?? '') : '',
        explanation: q ? (q.explanation || '') : ''
      };
    });
  }

  _sanitizeBoxForClient(box) {
    const safeBox = { ...box };
    delete safeBox.timeoutTimer;
    if (safeBox.isMystery && safeBox.status !== 'completed') {
      safeBox.points = '?';
      safeBox.mystery = true;
    }
    return safeBox;
  }

  _sanitizeBoxesForClient(boxes) {
    return boxes.map(b => this._sanitizeBoxForClient(b));
  }
}

module.exports = GameEngine;
