/**
 * network.js — Multiplayer WebSocket client
 * Connects to the Dead Earth Protocol server for real-time multiplayer.
 * 
 * Exposes:
 *   Network.connect(url)       — Connect to server
 *   Network.register(u, p, cb) — Register new account
 *   Network.login(u, p, cb)    — Login to existing account
 *   Network.sendChat(msg)      — Send chat message
 *   Network.updatePosition(g,s,p) — Update universe position
 *   Network.onPresence(cb)     — Listen for player presence updates
 *   Network.onChat(cb)         — Listen for chat messages
 *   Network.onSystem(cb)       — Listen for system messages
 *   Network.isConnected        — Boolean
 *   Network.username           — Current player's username
 */

window.Network = (function () {
  'use strict';

  let socket = null;
  let token = null;
  let username = null;
  let connected = false;
  let reconnectTimer = null;

  // Callbacks
  const listeners = {
    presence: [],
    chat: [],
    system: [],
    auth_ok: [],
    auth_error: [],
    disconnect: [],
  };

  function trigger(event, data) {
    (listeners[event] || []).forEach(function (cb) { cb(data); });
  }

  function connect(serverUrl) {
    if (socket) {
      try { socket.close(); } catch (e) {}
    }

    // If serverUrl is relative, assume same host
    if (!serverUrl || serverUrl === 'auto') {
      var loc = window.location;
      var protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      serverUrl = protocol + '//' + loc.host;
    }

    socket = new WebSocket(serverUrl);

    socket.onopen = function () {
      connected = true;
      // If we have stored credentials, auto-authenticate
      if (token && username) {
        doAuth();
      }
    };

    socket.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'auth_ok':
            connected = true;
            trigger('auth_ok', msg);
            break;
          case 'auth_error':
            token = null;
            connected = false;
            trigger('auth_error', msg);
            break;
          case 'presence':
            trigger('presence', msg.players || []);
            break;
          case 'chat':
            trigger('chat', msg);
            break;
          case 'system':
            trigger('system', msg);
            break;
          case 'pong':
            break;
        }
      } catch (e) {}
    };

    socket.onclose = function () {
      connected = false;
      trigger('disconnect', {});
      // Auto-reconnect after 5s
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(function () {
        if (token && username) connect(serverUrl);
      }, 5000);
    };

    socket.onerror = function () {
      // onclose will fire after this
    };
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

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

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
          // Store token for reconnects
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

  function sendChat(message) {
    return send({ type: 'chat', message: message });
  }

  function updatePosition(galaxyId, sectorId, planetId) {
    return send({
      type: 'position',
      galaxyId: galaxyId,
      sectorId: sectorId,
      planetId: planetId
    });
  }

  function on(event, callback) {
    if (listeners[event]) {
      listeners[event].push(callback);
    }
    return function () {
      var idx = listeners[event].indexOf(callback);
      if (idx >= 0) listeners[event].splice(idx, 1);
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket) {
      try { socket.close(); } catch (e) {}
    }
    socket = null;
    connected = false;
  }

  // Auto-connect on load if credentials exist
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
    get isConnected() { return connected; },
    get username() { return username; },
  };
})();
