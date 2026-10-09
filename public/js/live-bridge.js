/**
 * Clash of Champion - Live Socket & REST Polling Bridge
 * 
 * Transparently bridges Socket.IO to Serverless REST Polling on Vercel.
 * If WebSockets fail or are unavailable in the hosting environment,
 * all game actions seamlessly fall back to HTTP REST + Turso SQLite polling.
 */
(function() {
  const originalIo = window.io;

  class LiveSocketBridge {
    constructor(nativeSocket) {
      this.nativeSocket = nativeSocket;
      this.listeners = new Map();
      this.pin = '';
      this.playerId = sessionStorage.getItem('coc_playerId') || 'rest_admin_' + Math.random().toString(36).substring(2, 8);
      this.adminToken = sessionStorage.getItem('coc_admin_token') || '';
      this.isPollingActive = false;
      this.pollingTimer = null;
      this.lastPollTimestamp = 0;
      this.lastKnownStatus = 'lobby';
      this.id = 'bridge_' + Math.random().toString(36).substring(2, 9);
      this.connected = false;

      // Listen to native socket events if available
      if (this.nativeSocket) {
        this.nativeSocket.on('connect', () => {
          this.connected = true;
          this.id = this.nativeSocket.id;
          this.trigger('connect');
        });

        this.nativeSocket.on('connect_error', (err) => {
          console.warn('[LiveBridge] Native WebSocket failed. Switching to Serverless HTTP Polling mode...');
          this.activatePollingMode();
        });

        // Forward all native events to our listeners
        const eventNames = [
          'room-created', 'join-success', 'room-state', 'reconnect-success',
          'game-started', 'game-paused', 'game-resumed', 'game-ended',
          'box-locked', 'box-unlocked', 'box-claimed', 'answer-result',
          'leaderboard-updated', 'player-joined', 'player-left', 'player-reconnected',
          'emote-received', 'admin-box-claimed', 'admin-box-completed', 'admin-box-released',
          'error'
        ];

        eventNames.forEach(evt => {
          this.nativeSocket.on(evt, (data) => {
            this.trigger(evt, data);
          });
        });

        // Instant activation on Vercel deployment
        const isVercelHost = window.location.hostname.endsWith('vercel.app') || window.location.search.includes('mode=rest');
        if (isVercelHost) {
          console.info('[LiveBridge] Vercel environment detected. Activating instant HTTP Polling mode...');
          setTimeout(() => this.activatePollingMode(), 10);
        } else {
          // Safety fallback: if after 800ms native socket has not connected, activate polling
          setTimeout(() => {
            if (!this.connected) {
              console.info('[LiveBridge] Socket connection timeout. Activating HTTP Polling fallback...');
              this.activatePollingMode();
            }
          }, 800);
        }
      } else {
        this.activatePollingMode();
      }
    }

    activatePollingMode() {
      if (this.isPollingActive) return;
      this.isPollingActive = true;
      this.connected = true;
      this.trigger('connect');
      this.startPollingLoop();
    }

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
      return this;
    }

    off(event, callback) {
      if (!this.listeners.has(event)) return this;
      if (!callback) {
        this.listeners.delete(event);
      } else {
        const arr = this.listeners.get(event).filter(cb => cb !== callback);
        this.listeners.set(event, arr);
      }
      return this;
    }

    trigger(event, data) {
      const cbs = this.listeners.get(event);
      if (cbs && cbs.length > 0) {
        cbs.forEach(cb => {
          try { cb(data); } catch (e) { console.error(`[LiveBridge Event Error (${event})]:`, e); }
        });
      }
    }

    emit(event, data = {}) {
      // If native socket is connected, forward through it
      if (this.nativeSocket && this.nativeSocket.connected) {
        this.nativeSocket.emit(event, data);
        return;
      }

      // Handle via REST Polling layer
      this.handleRestEmit(event, data);
    }

    async handleRestEmit(event, data = {}) {
      try {
        if (event === 'create-room') {
          const res = await fetch('/api/live/create-room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const json = await res.json();
          if (json.success) {
            this.pin = json.pin;
            this.adminToken = json.adminToken;
            sessionStorage.setItem('coc_admin_pin', json.pin);
            sessionStorage.setItem('coc_admin_token', json.adminToken);
            this.trigger('room-created', {
              pin: json.pin,
              adminToken: json.adminToken,
              isAnonymous: json.isAnonymous,
              guruName: json.guruName
            });
            this.startPollingLoop();
          } else {
            this.trigger('error', { message: json.message || 'Gagal membuat room' });
          }
          return;
        }

        if (event === 'join-room') {
          const res = await fetch('/api/live/join-room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const json = await res.json();
          if (json.success) {
            this.pin = json.pin;
            this.playerId = json.playerId;
            sessionStorage.setItem('coc_pin', json.pin);
            sessionStorage.setItem('coc_playerId', json.playerId);
            this.trigger('join-success', {
              pin: json.pin,
              playerId: json.playerId,
              player: json.player
            });
            this.startPollingLoop();
          } else {
            this.trigger('error', { message: json.message || 'Gagal masuk ke room' });
          }
          return;
        }

        const pin = data.pin || this.pin || sessionStorage.getItem('coc_pin') || sessionStorage.getItem('coc_admin_pin');
        if (!pin) {
          console.warn('[LiveBridge] Cannot emit without PIN:', event);
          return;
        }
        this.pin = pin;

        // General Game Action
        const payload = { action: event, pin, playerId: this.playerId, ...data };
        const res = await fetch('/api/live/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();

        if (event === 'reconnect-attempt') {
          if (json.success) {
            this.trigger('reconnect-success', {
              pin: json.pin,
              adminToken: json.adminToken,
              roomState: json.roomState
            });
            this.startPollingLoop();
          } else {
            this.trigger('error', { message: json.message || 'Room tidak ditemukan' });
          }
          return;
        }

        if (event === 'claim-box') {
          if (json.success) {
            this.trigger('box-claimed', {
              boxIndex: json.boxIndex,
              question: json.question,
              points: json.points,
              timeLimit: json.timeLimit
            });
          } else {
            this.trigger('claim-rejected', {
              boxIndex: data.boxIndex,
              reason: json.reason || 'Kotak tidak tersedia'
            });
          }
        }

        if (event === 'submit-answer') {
          this.trigger('answer-result', json);
        }

        if (event === 'admin-claim-box' && json.success) {
          this.trigger('admin-box-claimed', json);
        }

        if (event === 'admin-complete-box' && json.success) {
          this.trigger('admin-box-completed', json);
        }

        // Trigger an immediate poll after an action to refresh state quickly
        this.pollOnce();

      } catch (err) {
        console.error(`[LiveBridge REST Error (${event})]:`, err);
      }
    }

    startPollingLoop() {
      if (this.pollingTimer) return;
      this.pollOnce();
      this.pollingTimer = setInterval(() => {
        this.pollOnce();
      }, 900); // Poll every 900ms for fast reactivity
    }

    async pollOnce() {
      const pin = this.pin || sessionStorage.getItem('coc_pin') || sessionStorage.getItem('coc_admin_pin');
      if (!pin) return;

      try {
        const url = `/api/live/poll?pin=${encodeURIComponent(pin)}&since=${this.lastPollTimestamp}&playerId=${encodeURIComponent(this.playerId || '')}`;
        const res = await fetch(url);
        if (!res.ok) return;

        const data = await res.json();
        if (!data || !data.success) return;

        this.lastPollTimestamp = data.timestamp || Date.now();

        // 1. Process recent events
        if (data.events && Array.isArray(data.events)) {
          data.events.forEach(e => {
            this.trigger(e.type, e.data);
          });
        }

        // 2. Status change transitions
        if (data.status && data.status !== this.lastKnownStatus) {
          if (data.status === 'playing' && this.lastKnownStatus === 'lobby') {
            this.trigger('game-started', {
              boxes: data.roomState?.boxes || [],
              globalEndTime: data.roomState?.globalEndTime || null
            });
          } else if (data.status === 'paused') {
            this.trigger('game-paused', {});
          } else if (data.status === 'playing' && this.lastKnownStatus === 'paused') {
            this.trigger('game-resumed', {});
          } else if (data.status === 'ended') {
            this.trigger('game-ended', data.roomState?.results || {});
          }
          this.lastKnownStatus = data.status;
        }

        // 3. Sync full room state
        if (data.roomState) {
          this.trigger('room-state', {
            status: data.status,
            roomState: data.roomState,
            pin: data.pin
          });

          if (data.roomState.leaderboard) {
            this.trigger('leaderboard-updated', {
              leaderboard: data.roomState.leaderboard
            });
          }
        }

      } catch (err) {
        // Silently tolerate intermittent network hiccups
      }
    }
  }

  // Wrap window.io
  window.io = function(opts) {
    let native = null;
    try {
      if (typeof originalIo === 'function') {
        native = originalIo(opts);
      }
    } catch (e) {
      console.warn('[LiveBridge] Error creating native socket:', e);
    }
    return new LiveSocketBridge(native);
  };
})();
