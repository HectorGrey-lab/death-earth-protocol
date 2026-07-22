# Fix ui-core.js - add chat switch case
with open('js/ui/ui-core.js', 'r') as f:
    core = f.read()

if "case 'chat':" not in core:
    core = core.replace(
        "case 'mailbox':",
        "case 'chat':\n        target.innerHTML = UIChat.renderPage(state);\n        setTimeout(function() { UIChat.bind(state); }, 0);\n        break;\n      case 'mailbox':"
    )
    with open('js/ui/ui-core.js', 'w') as f:
        f.write(core)
    print('1. Added chat switch case to ui-core.js')
else:
    print('1. Chat switch case already present')

# 2. Add CSS if missing
with open('css/styles.css', 'r') as f:
    css = f.read()
if 'chat-container' not in css:
    chat_css = """
/* ─── Global Chat ─── */
.chat-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 320px);
  min-height: 300px;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-msg {
  background: rgba(20, 30, 50, 0.6);
  border: 1px solid rgba(88, 214, 255, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
  max-width: 85%;
}
.chat-msg.chat-own {
  align-self: flex-end;
  background: rgba(88, 214, 255, 0.08);
  border-color: rgba(88, 214, 255, 0.2);
}
.chat-user {
  color: #58d6ff;
  font-weight: 600;
  font-size: 12px;
}
.chat-time {
  color: #556677;
  font-size: 10px;
  margin-left: 8px;
}
.chat-text {
  color: #ccddee;
  margin-top: 2px;
  word-wrap: break-word;
}
.chat-input-row {
  display: flex;
  gap: 8px;
  padding: 8px 0;
}
.chat-input {
  flex: 1;
  padding: 10px 14px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(88,214,255,0.15);
  border-radius: 8px;
  color: #ddeeff;
  font-size: 14px;
  outline: none;
}
.chat-input:focus {
  border-color: #58d6ff;
}
.chat-send {
  padding: 10px 20px;
  flex-shrink: 0;
}
@media (max-width: 768px) {
  .chat-container { height: calc(100vh - 280px); min-height: 200px; }
  .chat-msg { max-width: 95%; }
}
"""
    css = css.rstrip() + '\n' + chat_css
    with open('css/styles.css', 'w') as f:
        f.write(css)
    print('2. Added chat CSS')
else:
    print('2. Chat CSS already present')

print('Done')
