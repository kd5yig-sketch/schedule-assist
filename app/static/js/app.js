(function () {
  "use strict";

  const state = {
    api: null,
    boards: [],
    boardId: null,
    board: null,      // { board, columns, swimlanes, labels, cards }
    settings: null,
    openCardId: null,
    dragCardId: null,
    timer: {
      logId: null,
      cardId: null,
      cardTitle: "",
      phase: "work",   // work | short_break | long_break
      round: 1,
      remaining: 0,    // seconds left in current phase
      running: false,
      intervalHandle: null,
    },
  };

  const el = (id) => document.getElementById(id);
  const fmtTime = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const fmtHM = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function daysBetween(dateStr) {
    const due = new Date(dateStr + "T00:00:00");
    const today = new Date(todayStr() + "T00:00:00");
    return Math.round((due - today) / 86400000);
  }

  // ---------------- Boot ----------------
  function boot() {
    state.api = window.pywebview.api;
    Promise.all([state.api.get_boards(), state.api.get_settings()]).then(
      ([boards, settings]) => {
        state.boards = boards;
        state.settings = settings;
        renderBoardSelect();
        if (boards.length) {
          loadBoard(boards[0].id);
        }
      }
    );
    wireStaticHandlers();
  }

  if (window.pywebview) {
    boot();
  } else {
    window.addEventListener("pywebviewready", boot);
  }

  // ---------------- Board loading ----------------
  function loadBoard(boardId) {
    state.boardId = boardId;
    state.api.get_board(boardId).then((data) => {
      state.board = data;
      el("board-select").value = String(boardId);
      renderGrid();
      refreshTodaySummary();
    });
  }

  function refreshBoard() {
    state.api.get_board(state.boardId).then((data) => {
      state.board = data;
      renderGrid();
      refreshTodaySummary();
    });
  }

  function refreshTodaySummary() {
    state.api.get_today_summary(state.boardId).then((rows) => {
      const total = rows.reduce((a, r) => a + r.seconds, 0);
      el("today-summary").textContent = total > 0 ? `Today: ${fmtHM(total)}` : "";
    });
  }

  function renderBoardSelect() {
    const sel = el("board-select");
    sel.innerHTML = "";
    state.boards.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
  }

  // ---------------- Grid rendering ----------------
  function renderGrid() {
    const { columns, swimlanes, labels, cards } = state.board;
    const grid = el("board-grid");
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `100px repeat(${columns.length}, 300px)`;

    // header row
    const cornerCell = document.createElement("div");
    cornerCell.className = "lane-label-empty";
    grid.appendChild(cornerCell);

    columns.forEach((col) => {
      const count = cards.filter((c) => c.column_id === col.id).length;
      const header = document.createElement("div");
      header.className = "col-header" + (col.wip_limit && count > col.wip_limit ? " over-limit" : "");
      header.innerHTML = `
        <span class="col-name" contenteditable="true" spellcheck="false">${escapeHtml(col.name)}</span>
        <span class="col-header-actions">
          <span class="col-count">${count}${col.wip_limit ? "/" + col.wip_limit : ""}</span>
          <button data-action="wip" title="Set WIP limit">⚑</button>
          <button data-action="delete" title="Delete column">✕</button>
        </span>`;
      header.querySelector(".col-name").addEventListener("blur", (e) => {
        const name = e.target.textContent.trim();
        if (name && name !== col.name) state.api.rename_column(col.id, name).then(refreshBoard);
      });
      header.querySelector('[data-action="wip"]').addEventListener("click", () => {
        const v = prompt("WIP limit (blank to clear):", col.wip_limit || "");
        if (v !== null) state.api.set_wip_limit(col.id, v === "" ? null : v).then(refreshBoard);
      });
      header.querySelector('[data-action="delete"]').addEventListener("click", () => {
        if (confirm(`Delete column "${col.name}" and all its cards?`)) {
          state.api.delete_column(col.id).then(refreshBoard);
        }
      });
      grid.appendChild(header);
    });

    // swimlane rows
    const lanes = swimlanes.length ? swimlanes : [{ id: null, name: "" }];
    lanes.forEach((lane) => {
      const laneLabel = document.createElement("div");
      laneLabel.className = "lane-label";
      if (lane.id !== null) {
        laneLabel.innerHTML = `<input value="${escapeAttr(lane.name)}" />`;
        const input = laneLabel.querySelector("input");
        input.addEventListener("blur", () => {
          if (input.value.trim() && input.value !== lane.name) {
            state.api.rename_swimlane(lane.id, input.value.trim()).then(refreshBoard);
          }
        });
      }
      grid.appendChild(laneLabel);

      columns.forEach((col) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.columnId = col.id;
        cell.dataset.swimlaneId = lane.id === null ? "" : lane.id;

        const cellCards = cards
          .filter((c) => c.column_id === col.id && (c.swimlane_id === lane.id))
          .sort((a, b) => a.position - b.position);

        cellCards.forEach((card) => cell.appendChild(renderCard(card, labels)));

        cell.appendChild(renderAddCardForm(col.id, lane.id));

        wireDropZone(cell);
        grid.appendChild(cell);
      });
    });
  }

  function renderCard(card, labels) {
    const div = document.createElement("div");
    div.className = "card";
    div.draggable = true;
    div.dataset.cardId = card.id;

    const cardLabels = labels.filter((l) => card.labels.includes(l.id));
    const labelsHtml = cardLabels
      .map((l) => `<span class="label-chip" style="background:${l.color}">${escapeHtml(l.name)}</span>`)
      .join("");

    let dueHtml = "";
    if (card.due_date) {
      const diff = daysBetween(card.due_date);
      const cls = diff < 0 ? "overdue" : diff <= 1 ? "due-soon" : "";
      dueHtml = `<span class="due ${cls}">📅 ${card.due_date}</span>`;
    }
    let checklistHtml = "";
    if (card.checklist_total > 0) {
      checklistHtml = `<span>☑ ${card.checklist_done}/${card.checklist_total}</span>`;
    }
    let timeHtml = "";
    if (card.time_spent_seconds > 0) {
      timeHtml = `<span>⏱ ${fmtHM(card.time_spent_seconds)}</span>`;
    }
    const activeHtml =
      state.timer.cardId === card.id ? `<span class="timer-active">● tracking</span>` : "";

    div.innerHTML = `
      ${labelsHtml ? `<div class="card-labels-row">${labelsHtml}</div>` : ""}
      <div class="card-title">${escapeHtml(card.title)}</div>
      <div class="card-meta-row">${dueHtml}${checklistHtml}${timeHtml}${activeHtml}</div>
    `;

    div.addEventListener("click", () => openCard(card.id));
    div.addEventListener("dragstart", (e) => {
      state.dragCardId = card.id;
      div.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      state.dragCardId = null;
    });
    return div;
  }

  function renderAddCardForm(columnId, swimlaneId) {
    const wrap = document.createElement("div");
    const link = document.createElement("button");
    link.className = "add-card-link";
    link.textContent = "+ Add card";
    wrap.appendChild(link);

    link.addEventListener("click", () => {
      wrap.innerHTML = "";
      const form = document.createElement("form");
      form.className = "add-card-form";
      form.innerHTML = `<input placeholder="Card title" autocomplete="off" />`;
      wrap.appendChild(form);
      const input = form.querySelector("input");
      input.focus();
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (title) {
          state.api
            .create_card(state.boardId, columnId, swimlaneId, title)
            .then(refreshBoard);
        }
      });
      input.addEventListener("blur", () => {
        if (!input.value.trim()) renderGridSoon();
      });
    });
    return wrap;
  }

  function renderGridSoon() {
    setTimeout(renderGrid, 120);
  }

  function wireDropZone(cell) {
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const cardId = state.dragCardId;
      if (cardId === null || cardId === undefined) return;
      const columnId = Number(cell.dataset.columnId);
      const swimlaneId = cell.dataset.swimlaneId === "" ? null : Number(cell.dataset.swimlaneId);

      const afterEl = [...cell.querySelectorAll(".card")].find((c) => {
        const r = c.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      const cardEl = document.querySelector(`.card[data-card-id="${cardId}"]`);
      if (afterEl) cell.insertBefore(cardEl, afterEl);
      else cell.insertBefore(cardEl, cell.querySelector(".add-card-link")?.parentElement || null);

      const orderedIds = [...cell.querySelectorAll(".card")].map((c) => Number(c.dataset.cardId));
      state.api.move_card(cardId, columnId, swimlaneId, orderedIds).then(refreshBoard);
    });
  }

  // ---------------- Card modal ----------------
  function openCard(cardId) {
    state.openCardId = cardId;
    state.api.get_card(cardId).then((card) => {
      el("card-title-input").value = card.title;
      el("card-due-input").value = card.due_date || "";
      el("card-desc-input").value = card.description || "";
      renderCardLabels(card);
      renderChecklist(card);
      renderTimeLogs(card);
      el("card-modal").classList.remove("hidden");
      syncTimerButtons();
    });
  }

  function closeCard() {
    el("card-modal").classList.add("hidden");
    state.openCardId = null;
    refreshBoard();
  }

  function renderCardLabels(card) {
    const wrap = el("card-labels");
    wrap.innerHTML = "";
    state.board.labels.forEach((l) => {
      const btn = document.createElement("button");
      btn.className = "label-toggle" + (card.labels.includes(l.id) ? " active" : "");
      btn.style.background = l.color;
      btn.textContent = l.name;
      btn.addEventListener("click", () => {
        state.api.toggle_card_label(card.id, l.id).then(() => openCard(card.id));
      });
      wrap.appendChild(btn);
    });
  }

  function renderChecklist(card) {
    const wrap = el("checklist-items");
    wrap.innerHTML = "";
    card.checklist.forEach((item) => {
      const row = document.createElement("div");
      row.className = "checklist-item" + (item.done ? " done" : "");
      row.innerHTML = `
        <input type="checkbox" ${item.done ? "checked" : ""} />
        <span class="checklist-text">${escapeHtml(item.text)}</span>
        <button title="Delete">✕</button>`;
      row.querySelector('input[type="checkbox"]').addEventListener("change", () => {
        state.api.toggle_checklist_item(item.id).then(() => openCard(card.id));
      });
      row.querySelector("button").addEventListener("click", () => {
        state.api.delete_checklist_item(item.id).then(() => openCard(card.id));
      });
      wrap.appendChild(row);
    });
    const total = card.checklist.length;
    const done = card.checklist.filter((i) => i.done).length;
    el("checklist-progress").textContent = total ? `(${done}/${total})` : "";
  }

  function renderTimeLogs(card) {
    el("card-time-total").textContent = card.time_spent_seconds
      ? `(total ${fmtHM(card.time_spent_seconds)})`
      : "";
    const list = el("time-log-list");
    list.innerHTML = "";
    card.time_logs
      .filter((l) => l.duration_seconds !== null)
      .slice(0, 10)
      .forEach((l) => {
        const d = document.createElement("div");
        d.textContent = `${l.started_at.replace("T", " ")} — ${fmtHM(l.duration_seconds)}`;
        list.appendChild(d);
      });
  }

  // ---------------- Pomodoro timer ----------------
  function syncTimerButtons() {
    const isThisCard = state.timer.cardId === state.openCardId && state.timer.running;
    el("timer-start-btn").classList.toggle("hidden", isThisCard);
    el("timer-stop-btn").classList.toggle("hidden", !isThisCard);
    el("timer-display").textContent = isThisCard ? fmtTime(state.timer.remaining) : "";
  }

  function startPomodoro(cardId, cardTitle) {
    if (state.timer.running) return;
    state.api.start_timer(cardId, "pomodoro").then((res) => {
      state.timer.logId = res.id;
      state.timer.cardId = cardId;
      state.timer.cardTitle = cardTitle;
      state.timer.phase = "work";
      state.timer.remaining = Number(state.settings.pomodoro_work_minutes) * 60;
      state.timer.running = true;
      el("pomodoro-widget").classList.remove("hidden");
      updatePomodoroWidget();
      syncTimerButtons();
      clearInterval(state.timer.intervalHandle);
      state.timer.intervalHandle = setInterval(tickPomodoro, 1000);
      renderGridSoon();
    });
  }

  function tickPomodoro() {
    state.timer.remaining -= 1;
    if (state.timer.remaining <= 0) {
      completePhase();
    }
    updatePomodoroWidget();
    if (state.openCardId === state.timer.cardId) syncTimerButtons();
  }

  function completePhase() {
    beep();
    if (state.timer.phase === "work") {
      state.api.stop_timer(state.timer.logId).then(() => {
        if (state.openCardId === state.timer.cardId) refreshBoard();
      });
      const rounds = Number(state.settings.pomodoro_rounds);
      const isLong = state.timer.round >= rounds;
      state.timer.phase = isLong ? "long_break" : "short_break";
      state.timer.remaining =
        Number(isLong ? state.settings.pomodoro_long_break_minutes : state.settings.pomodoro_short_break_minutes) * 60;
      if (isLong) state.timer.round = 1;
      else state.timer.round += 1;
      state.timer.logId = null; // breaks aren't logged as work time
    } else {
      // break finished -> start next work phase automatically, new log
      state.api.start_timer(state.timer.cardId, "pomodoro").then((res) => {
        state.timer.logId = res.id;
      });
      state.timer.phase = "work";
      state.timer.remaining = Number(state.settings.pomodoro_work_minutes) * 60;
    }
    updatePomodoroWidget();
  }

  function updatePomodoroWidget() {
    el("pomodoro-card-title").textContent =
      (state.timer.phase === "work" ? "Working: " : "Break: ") + state.timer.cardTitle;
    el("pomodoro-time").textContent = fmtTime(state.timer.remaining);
  }

  function stopPomodoro() {
    clearInterval(state.timer.intervalHandle);
    const finishLog = () => {
      if (state.timer.logId && state.timer.phase === "work") {
        return state.api.stop_timer(state.timer.logId);
      }
      return Promise.resolve();
    };
    finishLog().then(() => {
      const cardId = state.timer.cardId;
      state.timer = {
        logId: null, cardId: null, cardTitle: "", phase: "work", round: 1,
        remaining: 0, running: false, intervalHandle: null,
      };
      el("pomodoro-widget").classList.add("hidden");
      if (state.openCardId === cardId) syncTimerButtons();
      refreshBoard();
    });
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* audio unavailable */ }
  }

  // ---------------- Archive ----------------
  function openArchive() {
    state.api.get_archived_cards(state.boardId).then((cards) => {
      const list = el("archived-list");
      list.innerHTML = "";
      if (!cards.length) list.innerHTML = `<p style="color:var(--text-muted)">No archived cards.</p>`;
      cards.forEach((c) => {
        const row = document.createElement("div");
        row.className = "archived-card";
        row.innerHTML = `
          <span>${escapeHtml(c.title)}</span>
          <span class="archived-card-actions">
            <button data-action="restore" class="secondary-btn">Restore</button>
            <button data-action="delete" class="danger-btn">Delete</button>
          </span>`;
        row.querySelector('[data-action="restore"]').addEventListener("click", () => {
          const firstCol = state.board.columns[0];
          state.api.restore_card(c.id, firstCol.id).then(() => {
            refreshBoard();
            openArchive();
          });
        });
        row.querySelector('[data-action="delete"]').addEventListener("click", () => {
          if (confirm("Permanently delete this card?")) {
            state.api.delete_card(c.id).then(openArchive);
          }
        });
        list.appendChild(row);
      });
      el("archive-modal").classList.remove("hidden");
    });
  }

  // ---------------- Static wiring ----------------
  function wireStaticHandlers() {
    el("board-select").addEventListener("change", (e) => loadBoard(Number(e.target.value)));

    el("new-board-btn").addEventListener("click", () => {
      const name = prompt("New board name:");
      if (name && name.trim()) {
        state.api.create_board(name.trim()).then((res) => {
          state.api.get_boards().then((boards) => {
            state.boards = boards;
            renderBoardSelect();
            loadBoard(res.id);
          });
        });
      }
    });

    el("add-column-btn").addEventListener("click", () => {
      const name = prompt("Column name:");
      if (name && name.trim()) state.api.create_column(state.boardId, name.trim()).then(refreshBoard);
    });

    el("add-swimlane-btn").addEventListener("click", () => {
      const name = prompt("Swimlane name:", "New swimlane");
      if (name && name.trim()) state.api.create_swimlane(state.boardId, name.trim()).then(refreshBoard);
    });

    el("archive-btn").addEventListener("click", openArchive);
    el("archive-close-btn").addEventListener("click", () => el("archive-modal").classList.add("hidden"));

    // Card modal
    el("card-close-btn").addEventListener("click", closeCard);
    el("card-modal").addEventListener("click", (e) => {
      if (e.target.id === "card-modal") closeCard();
    });
    el("card-title-input").addEventListener("blur", (e) => {
      const title = e.target.value.trim();
      if (title) state.api.update_card(state.openCardId, { title });
    });
    el("card-due-input").addEventListener("change", (e) => {
      state.api.update_card(state.openCardId, { due_date: e.target.value || null });
    });
    let descTimeout;
    el("card-desc-input").addEventListener("input", (e) => {
      clearTimeout(descTimeout);
      const value = e.target.value;
      descTimeout = setTimeout(() => {
        state.api.update_card(state.openCardId, { description: value });
      }, 500);
    });
    el("checklist-add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = el("checklist-add-input");
      const text = input.value.trim();
      if (text) {
        state.api.add_checklist_item(state.openCardId, text).then(() => {
          input.value = "";
          openCard(state.openCardId);
        });
      }
    });
    el("card-duplicate-btn").addEventListener("click", () => {
      const currentDue = el("card-due-input").value;
      const newDate = prompt("Due date for the duplicate (YYYY-MM-DD, blank for none):", currentDue || "");
      if (newDate === null) return;
      state.api.duplicate_card(state.openCardId, newDate || null).then((res) => {
        refreshBoard();
        openCard(res.id);
      });
    });
    el("card-archive-btn").addEventListener("click", () => {
      if (state.timer.cardId === state.openCardId) stopPomodoro();
      state.api.archive_card(state.openCardId).then(closeCard);
    });
    el("card-delete-btn").addEventListener("click", () => {
      if (confirm("Delete this card permanently?")) {
        if (state.timer.cardId === state.openCardId) stopPomodoro();
        state.api.delete_card(state.openCardId).then(closeCard);
      }
    });

    el("timer-start-btn").addEventListener("click", () => {
      if (state.timer.running && state.timer.cardId !== state.openCardId) {
        if (!confirm("Stop the current pomodoro and start one for this card?")) return;
        stopPomodoro();
      }
      const title = el("card-title-input").value || "Untitled";
      startPomodoro(state.openCardId, title);
    });
    el("timer-stop-btn").addEventListener("click", stopPomodoro);

    // Floating widget
    el("pomodoro-stop-btn").addEventListener("click", stopPomodoro);
    el("pomodoro-pause-btn").addEventListener("click", () => {
      if (state.timer.intervalHandle) {
        clearInterval(state.timer.intervalHandle);
        state.timer.intervalHandle = null;
        el("pomodoro-pause-btn").textContent = "Resume";
      } else {
        state.timer.intervalHandle = setInterval(tickPomodoro, 1000);
        el("pomodoro-pause-btn").textContent = "Pause";
      }
    });

    // Settings modal
    el("settings-btn").addEventListener("click", () => {
      el("setting-work").value = state.settings.pomodoro_work_minutes;
      el("setting-short-break").value = state.settings.pomodoro_short_break_minutes;
      el("setting-long-break").value = state.settings.pomodoro_long_break_minutes;
      el("setting-rounds").value = state.settings.pomodoro_rounds;
      el("settings-modal").classList.remove("hidden");
    });
    el("settings-close-btn").addEventListener("click", () => el("settings-modal").classList.add("hidden"));
    el("settings-save-btn").addEventListener("click", () => {
      const updates = {
        pomodoro_work_minutes: el("setting-work").value,
        pomodoro_short_break_minutes: el("setting-short-break").value,
        pomodoro_long_break_minutes: el("setting-long-break").value,
        pomodoro_rounds: el("setting-rounds").value,
      };
      Promise.all(Object.entries(updates).map(([k, v]) => state.api.set_setting(k, v))).then(() => {
        state.settings = { ...state.settings, ...updates };
        el("settings-modal").classList.add("hidden");
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
