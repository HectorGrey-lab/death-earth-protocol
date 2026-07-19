window.MailboxSystem = (function () {
  function addMessage(state, tab, subject, body) {
    const msg = {
      id: Utils.uid("mail"),
      tab,
      subject,
      body,
      time: Date.now()
    };

    state.mailbox.messages.unshift(msg);
    state.mailbox.messages = state.mailbox.messages.slice(0, 120);

    if (!state.mailbox.selectedMessageId) {
      state.mailbox.selectedMessageId = msg.id;
    }

    addLog(state, `[${tab}] ${subject}`, "system");
    return msg;
  }

  function inferLogType(text, explicitType) {
    if (explicitType) return explicitType;

    const t = text.toLowerCase();

    if (
      t.includes("depleted") ||
      t.includes("breached") ||
      t.includes("incoming attack") ||
      t.includes("hostile") ||
      t.includes("retaliation") ||
      t.includes("damage")
    ) return "danger";

    if (
      t.includes("warning") ||
      t.includes("low") ||
      t.includes("strain") ||
      t.includes("elevated")
    ) return "warning";

    if (
      t.includes("restored") ||
      t.includes("completed") ||
      t.includes("repelled") ||
      t.includes("reward") ||
      t.includes("upgraded") ||
      t.includes("joined") ||
      t.includes("purchased")
    ) return "success";

    if (
      t.includes("scout") ||
      t.includes("recon") ||
      t.includes("contact revealed") ||
      t.includes("artifact") ||
      t.includes("expedition")
    ) return "intel";

    return "system";
  }

  function addLog(state, text, type) {
    const now = Date.now();
    const logType = inferLogType(text, type);
    const latest = state.log[0];

    if (latest && latest.text === text && latest.type === logType && (now - latest.time) < 15000) {
      latest.count = (latest.count || 1) + 1;
      latest.time = now;
    } else {
      state.log.unshift({
        id: Utils.uid("log"),
        text,
        type: logType,
        count: 1,
        time: now
      });
    }

    state.log = state.log.slice(0, 60);
  }

  function addSystemMail(state, body) {
    return addMessage(state, "System", "Command System Notice", body);
  }

  return {
    addMessage,
    addSystemMail,
    addLog
  };
})();