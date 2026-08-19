// js/ui/messageLog.js
// Package D (UI). Attaches only to Game.UI.MessageLog.
//
// Public API:
//   MessageLog.init(containerId)   -- build the log container once. Call at startup.
//   MessageLog.add(text)           -- append a line, auto-scroll, cap retained lines.
//   MessageLog.clear()             -- remove all lines (call on new run start).
//
// DOM convention: the container passed to init() gets a single child
// `#message-log-list` (a <ul>); each entry is an `<li class="log-entry">`.
// Caps retained lines at MAX_LINES (100), pruning oldest from the DOM.

(function () {
  const MessageLog = window.Game.UI.MessageLog;

  const MAX_LINES = 100;

  let listEl = null;

  MessageLog.init = function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    const list = document.createElement('ul');
    list.id = 'message-log-list';
    list.className = 'message-log-list';
    container.appendChild(list);

    listEl = list;
  };

  MessageLog.add = function (text) {
    if (!listEl) return;

    const entry = document.createElement('li');
    entry.className = 'log-entry';
    entry.textContent = String(text);
    listEl.appendChild(entry);

    while (listEl.children.length > MAX_LINES) {
      listEl.removeChild(listEl.firstChild);
    }

    listEl.scrollTop = listEl.scrollHeight;
  };

  MessageLog.clear = function () {
    if (!listEl) return;
    listEl.innerHTML = '';
  };
})();
