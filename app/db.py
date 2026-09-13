import datetime
import os
import sqlite3

DB_DIR = os.path.expanduser("~/.local/share/schedule-assist")
DB_PATH = os.path.join(DB_DIR, "schedule_assist.db")

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position REAL NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position REAL NOT NULL,
    wip_limit INTEGER
);

CREATE TABLE IF NOT EXISTS swimlanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    swimlane_id INTEGER REFERENCES swimlanes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position REAL NOT NULL,
    due_date TEXT,
    color TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_labels (
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
);

CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER,
    kind TEXT NOT NULL DEFAULT 'pomodoro'
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_conn = None


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


def get_conn():
    global _conn
    if _conn is None:
        os.makedirs(DB_DIR, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        _conn.executescript(SCHEMA)
        _conn.commit()
        _seed_if_empty(_conn)
    return _conn


def _seed_if_empty(conn):
    row = conn.execute("SELECT COUNT(*) c FROM boards").fetchone()
    if row["c"] > 0:
        return
    cur = conn.execute(
        "INSERT INTO boards (name, position, created_at) VALUES (?, 1, ?)",
        ("My Board", now_iso()),
    )
    board_id = cur.lastrowid
    for i, name in enumerate(["To Do", "In Progress", "Done"]):
        conn.execute(
            "INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)",
            (board_id, name, i),
        )
    conn.execute(
        "INSERT INTO swimlanes (board_id, name, position) VALUES (?, 'Default', 0)",
        (board_id,),
    )
    for name, color in [("Urgent", "#e5484d"), ("Bug", "#e58a2a"), ("Idea", "#3b82f6")]:
        conn.execute(
            "INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)",
            (board_id, name, color),
        )
    conn.commit()
