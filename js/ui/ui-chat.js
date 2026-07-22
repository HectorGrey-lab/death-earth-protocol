window.UIChat = (function () {
  var messages = [];
  var onlineCount = 0;

  function render() {
    var html = messages.map(function (m) {
      var isOwn = m.username === (window.Network ? Network.username : '');
      var cls = isOwn ? 'chat-own' : '';
      var time = m.time ? new Date(m.time).toLocaleTimeString() : '';
      return '<div class="chat-msg ' + cls + '">' +
        '<span class="chat-user">' + esc(m.username) + '</span>' +
        '<span class="chat-time">' + time + '</span>' +
        '<div class="chat-text">' + esc(m.text) + '</div></div>';
    }).join('') || '<div class="small" style="padding:12px;text-align:center;">No messages yet.</div>';
    return '<div class="chat-widget"><div class="chat-widget-header"><strong>Global Chat</strong><span class="small" id="chatOnlineCount">' + onlineCount + ' online</span></div><div class="chat-widget-msgs" id="chatWidgetMsgs">' + html + '</div><div class="chat-widget-input"><input type="text" id="chatWidgetInput" placeholder="Type..." maxlength="500" /><button class="btn small" id="chatWidgetSend">Send</button></div></div>';
  }

  function bind() {
    var input = document.getElementById('chatWidgetInput');
    var sendBtn = document.getElementById('chatWidgetSend');
    if (!input || !sendBtn) return;
    function send() { var t = input.value.trim(); if (t) { if (window.Network) Network.sendChat(t); input.value = ''; } }
    sendBtn.onclick = send;
    input.onkeydown = function (e) { if (e.key === 'Enter') send(); };
    var m = document.getElementById('chatWidgetMsgs');
    if (m) m.scrollTop = m.scrollHeight;
  }

  function renderPage(state) {
    var msgs = state.chat.messages || [];
    var html = msgs.map(function (m) {
      var isOwn = m.username === (window.Network ? Network.username : '');
      var cls = isOwn ? 'chat-own' : '';
      var time = m.time ? new Date(m.time).toLocaleTimeString() : '';
      return '<div class="chat-msg ' + cls + '"><span class="chat-user">' + esc(m.username) + '</span><span class="chat-time">' + time + '</span><div class="chat-text">' + esc(m.text) + '</div></div>';
    }).join('') || '<div class="small" style="padding:20px;text-align:center;">No messages yet. Be the first to say something!</div>';
    return '<div class="chat-container"><div class="chat-messages" id="chatPageMsgs">' + html + '</div><div class="chat-input-row"><input type="text" id="chatPageInput" class="chat-input" placeholder="Type a message..." maxlength="500" /><button class="btn chat-send" id="chatPageSend">Send</button></div></div>';
  }

  function bindPage(state) {
    var input = document.getElementById('chatPageInput');
    var sendBtn = document.getElementById('chatPageSend');
    if (!input || !sendBtn) return;
    function send() { var t = input.value.trim(); if (t) { if (window.Network) Network.sendChat(t); input.value = ''; input.focus(); } }
    sendBtn.onclick = send;
    input.onkeydown = function (e) { if (e.key === 'Enter') send(); };
    input.focus();
    var m = document.getElementById('chatPageMsgs');
    if (m) m.scrollTop = m.scrollHeight;
  }

  function addMessage(msg) {
    var entry = { username: msg.username || 'System', text: msg.text || msg.message || '', time: msg.time || Date.now() };
    messages.push(entry);
    if (messages.length > 20) messages = messages.slice(-20);
    if (window.gameState) {
      if (!window.gameState.chat) window.gameState.chat = { messages: [] };
      window.gameState.chat.messages.push(entry);
      if (window.gameState.chat.messages.length > 20) window.gameState.chat.messages = window.gameState.chat.messages.slice(-20);
      if (window.gameState.ui.currentPage === 'chat' && window.App) window.App.render();
    }
    var wm = document.getElementById('chatWidgetMsgs');
    if (wm) {
      var p = wm.closest('.chat-widget');
      if (p && p.parentElement) { p.parentElement.innerHTML = render(); bind(); }
    }
  }

  function setOnlineCount(n) {
    onlineCount = n;
    var el = document.getElementById('chatOnlineCount');
    if (el) el.textContent = n + ' online';
  }

  function loadHistory(msgs) {
    messages = msgs.slice();
    if (window.gameState) {
      if (!window.gameState.chat) window.gameState.chat = { messages: [] };
      window.gameState.chat.messages = messages.slice();
    }
    var wm = document.getElementById('chatWidgetMsgs');
    if (wm) {
      var p = wm.closest('.chat-widget');
      if (p && p.parentElement) { p.parentElement.innerHTML = render(); bind(); }
    }
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { render: render, bind: bind, renderPage: renderPage, bindPage: bindPage, addMessage: addMessage, setOnlineCount: setOnlineCount, loadHistory: loadHistory };
})();
