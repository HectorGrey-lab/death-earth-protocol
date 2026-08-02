/**
 * network.js — Multiplayer WebSocket client
 * Connects to the Dead Earth Protocol server for real-time multiplayer.
 *
 * v2 — Added heartbeat, exponential backoff reconnect, request IDs, callbacks.
 *
 * Exposes:
 *   Network.connect(url)       — Connect to server
 *   Network.register(u, p, cb) — Register new account
 *   Network.login(u, p, cb)    — Login to existing account
 *   Network.send(data, cb)     — Send any message with optional callback
 *   Network.sendChat(msg)      — Send chat message
 *   Network.on(event, cb)      — Listen for events
 *   Network.off(handle)        — Remove listener
 *   Network.disconnect()       — Disconnect and clean up
 *   Network.init()             — Auto-connect if credentials exist
 *   Network.isConnected        — Boolean
 *   Network.reconnectAttempt   — Current reconnect attempt number (0 = connected/first)
 *   Network.username           — Current player's username
 */

window.Network = (function () {
  'use strict';

  let socket = null;
  let token = null;
  let username = null;
  let connected = false;
  let serverUrl = null;

  // ── Reconnect State ──
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  const MAX_RECONNECT_INTERVAL = 30; // seconds
  const BASE_RECONNECT_INTERVAL = 1; // seconds

  // ── Heartbeat ──
  let heartbeatTimer = null;
  let lastPongTime = 0;
  const HEARTBEAT_INTERVAL = 15; // seconds — send ping every 15s
  const HEARTBEAT_TIMEOUT = 10;  // seconds — consider dead if no pong in 10s

  // ── Request IDs ──
  let requestSeq = 0;
  let pendingCallbacks = {}; // requestId -> { resolve, reject, timer }

  // ── Event listeners ──
  const listeners = {};

  // ── Internal Helpers ──

  function trigger(event, data) {
    (listeners[event] || []).forEach(function (cb) { cb(data); });
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function getReconnectDelay() {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    var delay = BASE_RECONNECT_INTERVAL * Math.pow(2, reconnectAttempt - 1);
    return Math.min(delay, MAX_RECONNECT_INTERVAL) * 1000;
  }

  function cleanupCallbacks(errMsg) {
    var now = Date.now();
    Object.keys(pendingCallbacks).forEach(function (id) {
      var pc = pendingCallbacks[id];
      if (pc.timer) clearTimeout(pc.timer);
      if (pc.reject) pc.reject(new Error(errMsg || 'Connection lost'));
      delete pendingCallbacks[id];
    });
  }

  // ── Heartbeat ──

  function startHeartbeat() {
    stopHeartbeat();
    lastPongTime = Date.now();
    heartbeatTimer = setInterval(function () {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        // Socket already gone — heartbeat will be restarted on reconnect
        return;
      }
      // Check if pong was missed
      if (Date.now() - lastPongTime > HEARTBEAT_TIMEOUT * 1000) {
        console.warn('[NET] Heartbeat timeout — closing socket');
        cleanupCallbacks('Server unreachable (heartbeat timeout)');
        trigger('system', { message: 'Connection lost (heartbeat timeout)' });
        try { socket.close(); } catch (e) {}
        return;
      }
      // Send ping (JSON) — browser WebSocket API can't emit raw control
      // frames, so the server replies with { type:'pong' } text message.
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch (e) {
        // Socket may have died between check and send
      }
    }, HEARTBEAT_INTERVAL * 1000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function handlePong() {
    lastPongTime = Date.now();
  }

  // ── Reconnect ──

  function scheduleReconnect() {
    var delay = getReconnectDelay();
    console.log('[NET] Reconnect attempt ' + reconnectAttempt + ' in ' + Math.round(delay/1000) + 's');
    trigger('reconnecting', { attempt: reconnectAttempt, delay: delay });

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
      doConnect();
    }, delay);
  }

  function resetReconnect() {
    reconnectAttempt = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  // ── Connection ──

  function doConnect() {
    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
    }

    if (!serverUrl) {
      var loc = window.location;
      var protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      serverUrl = protocol + '//' + loc.host;
    }

    reconnectAttempt++;
    console.log('[NET] Connecting to ' + serverUrl + ' (attempt ' + reconnectAttempt + ')');
    trigger('connecting', { attempt: reconnectAttempt, url: serverUrl });

    socket = new WebSocket(serverUrl);

    socket.onopen = function () {
      connected = true;
      // If we have credentials, re-authenticate
      if (token && username) {
        doAuth();
      }
    };

    socket.onmessage = function (e) {
      // Handle binary pong frames (opcode 0x0A = pong)
      if (e.data instanceof ArrayBuffer || e.data instanceof Blob) {
        // Browser WebSocket automatically responds to pings with pongs
        // We don't receive them here — they're handled by the browser.
        // If we received a text pong (server sends it as a string), handle it:
        return;
      }

      try {
        var msg = JSON.parse(e.data);

        // ── Request callback routing ──
        if (msg._reqId && pendingCallbacks[msg._reqId]) {
          var pc = pendingCallbacks[msg._reqId];
          delete pendingCallbacks[msg._reqId];
          if (pc.timer) clearTimeout(pc.timer);
          if (pc.resolve) pc.resolve(msg);
          return; // Don't also trigger event — callback wins
        }

        // ── Pong (heartbeat reply) ──
        if (msg.type === 'pong') {
          handlePong();
          return;
        }

        // ── Auth responses ──
        switch (msg.type) {
          case 'auth_ok':
            connected = true;
            resetReconnect();
            startHeartbeat();
            trigger('auth_ok', msg);
            break;
          case 'auth_error':
            token = null;
            connected = false;
            stopHeartbeat();
            trigger('auth_error', msg);
            break;
          default:
            // Forward all other types to listeners
            trigger(msg.type, msg);
            break;
        }
      } catch (e) {
        console.warn('[NET] Failed to parse message:', e);
      }
    };

    socket.onclose = function () {
      connected = false;
      stopHeartbeat();
      trigger('disconnect', { attempt: reconnectAttempt });

      // Schedule reconnect if we have credentials
      if (token && username) {
        scheduleReconnect();
      }
    };

    socket.onerror = function () {
      // onclose fires after this
    };
  }

  function connect(url) {
    serverUrl = url || serverUrl || 'auto';
    if (serverUrl === 'auto') serverUrl = null;
    resetReconnect();
    doConnect();
  }

  function doAuth() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'auth',
        username: username,
        token: token
      }));
    }
  }

  // ── Public send with optional callback ──

  function send(data, callback) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('[NET] send FAILED — socket not open');
      if (callback) callback(new Error('Socket not open'), null);
      return false;
    }

    // Attach request ID for callback routing
    if (callback) {
      requestSeq++;
      var reqId = 'req_' + requestSeq + '_' + Date.now();
      data._reqId = reqId;

      pendingCallbacks[reqId] = {
        resolve: function (response) {
          if (callback) callback(null, response);
        },
        reject: function (err) {
          if (callback) callback(err, null);
        },
        timer: setTimeout(function () {
          delete pendingCallbacks[reqId];
          if (callback) callback(new Error('Request timed out'), null);
        }, 30000) // 30s timeout
      };
    }

    console.log('[NET] send:', JSON.stringify(data).substring(0, 200));
    try {
      socket.send(JSON.stringify(data));
      return true;
    } catch (e) {
      if (callback) {
        var reqId = data._reqId;
        if (pendingCallbacks[reqId]) {
          clearTimeout(pendingCallbacks[reqId].timer);
          delete pendingCallbacks[reqId];
        }
        callback(e, null);
      }
      return false;
    }
  }

  // ── Auth (HTTP) ──

  function register(username_, password_, callback) {
    var xhr = new XMLHttpRequest();
    var protocol = window.location.protocol;
    var host = window.location.host;
    xhr.open('POST', protocol + '//' + host + '/api/register', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      try {
        var res = JSON.parse(xhr.responseText);
        if (res.ok) {
          token = res.token;
          username = res.username;
          try { localStorage.setItem('de_username', username); localStorage.setItem('de_token', token); } catch(e) {}
          if (callback) callback(null, res);
          doAuth();
        } else {
          if (callback) callback(res.error, null);
        }
      } catch (e) {
        if (callback) callback('Server error', null);
      }
    };
    xhr.onerror = function () {
      if (callback) callback('Cannot reach server', null);
    };
    xhr.send(JSON.stringify({ username: username_, password: password_ }));
  }

  function login(username_, password_, callback) {
    var xhr = new XMLHttpRequest();
    var protocol = window.location.protocol;
    var host = window.location.host;
    xhr.open('POST', protocol + '//' + host + '/api/login', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      try {
        var res = JSON.parse(xhr.responseText);
        if (res.ok) {
          token = res.token;
          username = res.username;
          try { localStorage.setItem('de_username', username); localStorage.setItem('de_token', token); } catch(e) {}
          if (callback) callback(null, res);
          doAuth();
        } else {
          if (callback) callback(res.error, null);
        }
      } catch (e) {
        if (callback) callback('Server error', null);
      }
    };
    xhr.onerror = function () {
      if (callback) callback('Cannot reach server', null);
    };
    xhr.send(JSON.stringify({ username: username_, password: password_ }));
  }

  // ── Event system ──

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    // Return unsubscribe handle
    return function () {
      var idx = listeners[event].indexOf(callback);
      if (idx >= 0) listeners[event].splice(idx, 1);
    };
  }

  // ── Convenience sends ──

  function sendChat(text) {
    return send({ type: 'chat', text: text });
  }

  function updatePosition(galaxy, sector, planet) {
    return send({
      type: 'position',
      galaxy: galaxy,
      sector: sector,
      planet: planet
    });
  }

  function getColony() {
    return send({ type: 'get_colony' });
  }

  function build(buildingId, callback) {
    return send({ type: 'build', buildingId: buildingId }, callback);
  }

  function train(troopId, qty, callback) {
    return send({ type: 'train', troopId: troopId, qty: qty || 1 }, callback);
  }

  // ── Disconnect ──

  function disconnect() {
    resetReconnect();
    clearTimers();
    cleanupCallbacks('Disconnected by user');
    if (socket) {
      try { socket.close(); } catch (e) {}
    }
    socket = null;
    connected = false;
    reconnectAttempt = 0;
  }

  // ── Auto-init ──

  function init() {
    var savedToken = null;
    var savedUser = null;
    try {
      savedToken = localStorage.getItem('de_token');
      savedUser = localStorage.getItem('de_username');
    } catch(e) {}
    if (savedToken && savedUser) {
      token = savedToken;
      username = savedUser;
      connect('auto');
    }
  }

  return {
    connect: connect,
    register: register,
    login: login,
    sendChat: sendChat,
    updatePosition: updatePosition,
    on: on,
    disconnect: disconnect,
    init: init,
    getColony: getColony,
    build: build,
    train: train,
    send: send,
    get isConnected() { return connected; },
    get username() { return username; },
    get reconnectAttempt() { return reconnectAttempt; }
  };
})();
