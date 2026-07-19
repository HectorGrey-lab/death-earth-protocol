/**
 * ui-chat.js — Chat panel UI
 * Displays a collapsible chat panel that floats over the game.
 */

window.UIChat = (function () {
  'use strict';

  var chatVisible = false;
  var messages = [];
  var MAX_MESSAGES = 100;
  var unreadCount = 0;

  function render() {
    var html = '';
    html += '<div id="chatPanel" class="chat-panel" style="display:' + (chatVisible ? 'flex' : 'none') + '">';
    html += '  <div class="chat-header">';
    html += '    <span>💬 Global Chat</span>';
    html += '    <div class="chat-header-actions">';
    html += '      <span id="chatOnlineCount" class="chat-online-count">0 online</span>';
    html += '      <button id="chatMinimizeBtn" class="chat-btn">_</button>';
    html += '    </div>';
    html += '  </div>';
    html += '  <div class="chat-messages" id="chatMessages">';
    for (var i = 0; i < messages.length; i++) {
      html += renderMessage(messages[i]);
    }
    html += '  </div>';
    html += '  <div class="chat-input-row">';
    html += '    <input type="text" id="chatInput" class="chat-input" placeholder="Type a message..." maxlength="200" />';
    html += '    <button id="chatSendBtn" class="chat-btn chat-send-btn">Send</button>';
    html += '  </div>';
    html += '</div>';

    var toggleBtn = '';
    toggleBtn += '<button id="chatToggleBtn" class="chat-toggle-btn" title="Toggle Chat">';
    toggleBtn += '  💬 <span id="chatBadge" class="chat-badge" style="display:' + (unreadCount > 0 ? 'inline' : 'none') + '">' + unreadCount + '</span>';
    toggleBtn += '</button>';

    return toggleBtn + html;
  }

  function renderMessage(msg) {
    var time = '';
    if (msg.timestamp) {
      var d = new Date(msg.timestamp);
      time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    }
    var isOwn = msg.username === (window.Network ? window.Network.username : '');
    var cls = isOwn ? 'chat-msg-own' : '';

    if (msg.type === 'system') {
      return '<div class="chat-msg chat-msg-system"><span class="chat-system-text">' + escapeHtml(msg.message) + '</span></div>';
    }
    return '<div class="chat-msg ' + cls + '"><span class="chat-time">' + time + '</span><strong class="chat-user">' + escapeHtml(msg.username) + '</strong>: <span class="chat-text">' + escapeHtml(msg.message) + '</span></div>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function addMessage(msg) {
    messages.push(msg);
    if (messages.length > MAX_MESSAGES) messages.shift();
    var container = document.getElementById('chatMessages');
    if (container) {
      container.insertAdjacentHTML('beforeend', renderMessage(msg));
      container.scrollTop = container.scrollHeight;
    }
    if (!chatVisible && msg.type !== 'system') {
      unreadCount++;
      var badge = document.getElementById('chatBadge');
      if (badge) {
        badge.textContent = unreadCount;
        badge.style.display = 'inline';
      }
    }
  }

  function bind(state) {
    var toggleBtn = document.getElementById('chatToggleBtn');
    if (toggleBtn) {
      toggleBtn.onclick = function () {
        chatVisible = !chatVisible;
        unreadCount = 0;
        var badge = document.getElementById('chatBadge');
        if (badge) { badge.style.display = 'none'; }
        var panel = document.getElementById('chatPanel');
        if (panel) { panel.style.display = chatVisible ? 'flex' : 'none'; }
        if (chatVisible) {
          var container = document.getElementById('chatMessages');
          if (container) container.scrollTop = container.scrollHeight;
          var input = document.getElementById('chatInput');
          if (input) input.focus();
        }
      };
    }

    var minimizeBtn = document.getElementById('chatMinimizeBtn');
    if (minimizeBtn) {
      minimizeBtn.onclick = function () {
        chatVisible = false;
        var panel = document.getElementById('chatPanel');
        if (panel) panel.style.display = 'none';
      };
    }

    var sendBtn = document.getElementById('chatSendBtn');
    var chatInput = document.getElementById('chatInput');
    if (sendBtn && chatInput) {
      function doSend() {
        var text = chatInput.value.trim();
        if (text && window.Network && Network.isConnected) {
          Network.sendChat(text);
          chatInput.value = '';
        }
        chatInput.focus();
      }
      sendBtn.onclick = doSend;
      chatInput.onkeydown = function (e) {
        if (e.key === 'Enter') doSend();
      };
    }
  }

  function setOnlineCount(count) {
    var el = document.getElementById('chatOnlineCount');
    if (el) el.textContent = count + ' online';
  }

  return {
    render: render,
    bind: bind,
    addMessage: addMessage,
    setOnlineCount: setOnlineCount,
  };
})();
