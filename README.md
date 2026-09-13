# Schedule Assist

A local, offline kanban board modeled on [KanbanFlow](https://kanbanflow.com/) —
boards, swimlanes, columns, drag-and-drop cards, labels, checklists, due
dates, and a per-card Pomodoro timer with time tracking.

Built for people who want KanbanFlow's workflow without sending their
schedule to a cloud service: there are no network calls, no account, no
telemetry. Everything is stored in a single SQLite file in your home
directory, and the app runs as a native desktop window via
[pywebview](https://pywebview.flowrl.com/).

## Features

- Multiple boards, each with its own columns and swimlanes
- Drag-and-drop cards between columns/swimlanes, reorder within a cell
- Per-column WIP limits (header turns red when exceeded)
- Labels/tags, due dates (color-coded when due soon / overdue)
- Checklists (subtasks) with progress counts
- Duplicate a card (with a fresh due date) instead of retyping a recurring task
- Per-card Pomodoro timer — work/short-break/long-break cycle, configurable
  in Settings (⚙), logged to a time-tracking history per card
- "Today" time-tracked total in the top bar
- Archive/restore/delete for cards
- Light/dark theme, following your system preference

## Requirements

- Ubuntu (or another Linux distro with WebKitGTK) with Python 3
- One additional system package:

```bash
sudo apt install -y python3-webview
```

(This pulls in `gir1.2-webkit2-4.1` and `python3-gi` if you don't already
have them.)

## Run

```bash
git clone https://github.com/kd5yig-sketch/schedule-assist.git
cd schedule-assist
./run.sh
```

or directly:

```bash
python3 main.py
```

## Install as an app-menu entry (optional)

```bash
mkdir -p ~/.local/share/applications
cp schedule-assist.desktop ~/.local/share/applications/
```

Edit the `Exec=`/`Path=` lines in `schedule-assist.desktop` first if you
cloned it somewhere other than `~/Schedule-Assist`. It'll then show up in
your regular application launcher as "Schedule Assist".

## Data

Stored at `~/.local/share/schedule-assist/schedule_assist.db` — a plain
SQLite file. Back it up by copying it; nothing about your boards or cards
ever leaves the machine.

## Project layout

```
main.py          entry point (pywebview window)
app/db.py        SQLite schema + connection
app/api.py       JS-exposed API (all board/card/timer operations)
app/static/      HTML/CSS/JS frontend (vanilla, no build step)
```

## Architecture notes

The frontend is plain HTML/CSS/JS with no build step or framework —
`app/static/js/app.js` calls backend methods directly via
`window.pywebview.api.*`, which pywebview bridges to the `Api` class in
`app/api.py`. That class is the entire server-side surface: every board,
card, label, checklist, and timer operation is one method on it, backed by
straightforward SQLite queries in `app/db.py`. There's no HTTP layer, no
ORM, and no JS bundler to install.
