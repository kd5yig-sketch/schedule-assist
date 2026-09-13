import datetime

from . import db as dbm


class Api:
    def __init__(self):
        self.conn = dbm.get_conn()

    # ---------- Boards ----------
    def get_boards(self):
        rows = self.conn.execute(
            "SELECT id, name, position FROM boards WHERE archived = 0 ORDER BY position"
        ).fetchall()
        return [dict(r) for r in rows]

    def create_board(self, name):
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 p FROM boards"
        ).fetchone()
        cur = self.conn.execute(
            "INSERT INTO boards (name, position, created_at) VALUES (?, ?, ?)",
            (name, row["p"], dbm.now_iso()),
        )
        board_id = cur.lastrowid
        for i, cname in enumerate(["To Do", "In Progress", "Done"]):
            self.conn.execute(
                "INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)",
                (board_id, cname, i),
            )
        self.conn.execute(
            "INSERT INTO swimlanes (board_id, name, position) VALUES (?, 'Default', 0)",
            (board_id,),
        )
        self.conn.commit()
        return {"id": board_id}

    def rename_board(self, board_id, name):
        self.conn.execute("UPDATE boards SET name = ? WHERE id = ?", (name, board_id))
        self.conn.commit()

    def archive_board(self, board_id):
        self.conn.execute("UPDATE boards SET archived = 1 WHERE id = ?", (board_id,))
        self.conn.commit()

    def delete_board(self, board_id):
        self.conn.execute("DELETE FROM boards WHERE id = ?", (board_id,))
        self.conn.commit()

    def get_board(self, board_id):
        board = self.conn.execute(
            "SELECT * FROM boards WHERE id = ?", (board_id,)
        ).fetchone()
        if not board:
            return None
        columns = [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM columns WHERE board_id = ? ORDER BY position", (board_id,)
            ).fetchall()
        ]
        swimlanes = [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM swimlanes WHERE board_id = ? ORDER BY position",
                (board_id,),
            ).fetchall()
        ]
        labels = [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM labels WHERE board_id = ?", (board_id,)
            ).fetchall()
        ]
        cards = self.conn.execute(
            "SELECT * FROM cards WHERE board_id = ? AND archived = 0 ORDER BY position",
            (board_id,),
        ).fetchall()
        card_list = []
        for c in cards:
            cd = dict(c)
            cd["labels"] = [
                r["label_id"]
                for r in self.conn.execute(
                    "SELECT label_id FROM card_labels WHERE card_id = ?", (c["id"],)
                ).fetchall()
            ]
            checklist = self.conn.execute(
                "SELECT done FROM checklist_items WHERE card_id = ?", (c["id"],)
            ).fetchall()
            cd["checklist_total"] = len(checklist)
            cd["checklist_done"] = sum(1 for it in checklist if it["done"])
            total_seconds = self.conn.execute(
                "SELECT COALESCE(SUM(duration_seconds), 0) s FROM time_logs "
                "WHERE card_id = ? AND duration_seconds IS NOT NULL",
                (c["id"],),
            ).fetchone()["s"]
            cd["time_spent_seconds"] = total_seconds
            card_list.append(cd)
        return {
            "board": dict(board),
            "columns": columns,
            "swimlanes": swimlanes,
            "labels": labels,
            "cards": card_list,
        }

    # ---------- Columns ----------
    def create_column(self, board_id, name):
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 p FROM columns WHERE board_id = ?",
            (board_id,),
        ).fetchone()
        cur = self.conn.execute(
            "INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)",
            (board_id, name, row["p"]),
        )
        self.conn.commit()
        return {"id": cur.lastrowid}

    def rename_column(self, column_id, name):
        self.conn.execute("UPDATE columns SET name = ? WHERE id = ?", (name, column_id))
        self.conn.commit()

    def set_wip_limit(self, column_id, limit):
        limit = int(limit) if limit not in (None, "") else None
        self.conn.execute(
            "UPDATE columns SET wip_limit = ? WHERE id = ?", (limit, column_id)
        )
        self.conn.commit()

    def delete_column(self, column_id):
        self.conn.execute("DELETE FROM columns WHERE id = ?", (column_id,))
        self.conn.commit()

    def reorder_columns(self, ordered_ids):
        for i, cid in enumerate(ordered_ids):
            self.conn.execute("UPDATE columns SET position = ? WHERE id = ?", (i, cid))
        self.conn.commit()

    # ---------- Swimlanes ----------
    def create_swimlane(self, board_id, name):
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 p FROM swimlanes WHERE board_id = ?",
            (board_id,),
        ).fetchone()
        cur = self.conn.execute(
            "INSERT INTO swimlanes (board_id, name, position) VALUES (?, ?, ?)",
            (board_id, name, row["p"]),
        )
        self.conn.commit()
        return {"id": cur.lastrowid}

    def rename_swimlane(self, swimlane_id, name):
        self.conn.execute(
            "UPDATE swimlanes SET name = ? WHERE id = ?", (name, swimlane_id)
        )
        self.conn.commit()

    def delete_swimlane(self, swimlane_id):
        self.conn.execute("DELETE FROM swimlanes WHERE id = ?", (swimlane_id,))
        self.conn.commit()

    def reorder_swimlanes(self, ordered_ids):
        for i, sid in enumerate(ordered_ids):
            self.conn.execute("UPDATE swimlanes SET position = ? WHERE id = ?", (i, sid))
        self.conn.commit()

    # ---------- Cards ----------
    def create_card(self, board_id, column_id, swimlane_id, title):
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 p FROM cards "
            "WHERE column_id = ? AND swimlane_id IS ?",
            (column_id, swimlane_id),
        ).fetchone()
        cur = self.conn.execute(
            "INSERT INTO cards (board_id, column_id, swimlane_id, title, position, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (board_id, column_id, swimlane_id, title, row["p"], dbm.now_iso()),
        )
        self.conn.commit()
        return {"id": cur.lastrowid}

    def update_card(self, card_id, fields):
        allowed = {"title", "description", "due_date", "color"}
        sets, params = [], []
        for k, v in fields.items():
            if k in allowed:
                sets.append(f"{k} = ?")
                params.append(v)
        if not sets:
            return
        params.append(card_id)
        self.conn.execute(f"UPDATE cards SET {', '.join(sets)} WHERE id = ?", params)
        self.conn.commit()

    def duplicate_card(self, card_id, due_date=None):
        card = self.conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if not card:
            return None
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 p FROM cards "
            "WHERE column_id = ? AND swimlane_id IS ?",
            (card["column_id"], card["swimlane_id"]),
        ).fetchone()
        new_due = due_date if due_date is not None else card["due_date"]
        cur = self.conn.execute(
            "INSERT INTO cards (board_id, column_id, swimlane_id, title, description, "
            "position, due_date, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                card["board_id"], card["column_id"], card["swimlane_id"], card["title"],
                card["description"], row["p"], new_due, card["color"], dbm.now_iso(),
            ),
        )
        new_id = cur.lastrowid
        for lbl in self.conn.execute(
            "SELECT label_id FROM card_labels WHERE card_id = ?", (card_id,)
        ).fetchall():
            self.conn.execute(
                "INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)",
                (new_id, lbl["label_id"]),
            )
        for item in self.conn.execute(
            "SELECT text, position FROM checklist_items WHERE card_id = ? ORDER BY position",
            (card_id,),
        ).fetchall():
            self.conn.execute(
                "INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)",
                (new_id, item["text"], item["position"]),
            )
        self.conn.commit()
        return {"id": new_id}

    def move_card(self, card_id, column_id, swimlane_id, ordered_ids_in_target):
        self.conn.execute(
            "UPDATE cards SET column_id = ?, swimlane_id = ? WHERE id = ?",
            (column_id, swimlane_id, card_id),
        )
        for i, cid in enumerate(ordered_ids_in_target):
            self.conn.execute("UPDATE cards SET position = ? WHERE id = ?", (i, cid))
        self.conn.commit()

    def archive_card(self, card_id):
        self.conn.execute("UPDATE cards SET archived = 1 WHERE id = ?", (card_id,))
        self.conn.commit()

    def restore_card(self, card_id, column_id):
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 p FROM cards WHERE column_id = ?",
            (column_id,),
        ).fetchone()
        self.conn.execute(
            "UPDATE cards SET archived = 0, column_id = ?, position = ? WHERE id = ?",
            (column_id, row["p"], card_id),
        )
        self.conn.commit()

    def delete_card(self, card_id):
        self.conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        self.conn.commit()

    def get_archived_cards(self, board_id):
        rows = self.conn.execute(
            "SELECT * FROM cards WHERE board_id = ? AND archived = 1 ORDER BY created_at DESC",
            (board_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_card(self, card_id):
        card = self.conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if not card:
            return None
        cd = dict(card)
        cd["labels"] = [
            r["label_id"]
            for r in self.conn.execute(
                "SELECT label_id FROM card_labels WHERE card_id = ?", (card_id,)
            ).fetchall()
        ]
        cd["checklist"] = [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position",
                (card_id,),
            ).fetchall()
        ]
        cd["time_logs"] = [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM time_logs WHERE card_id = ? ORDER BY started_at DESC",
                (card_id,),
            ).fetchall()
        ]
        total = self.conn.execute(
            "SELECT COALESCE(SUM(duration_seconds), 0) s FROM time_logs "
            "WHERE card_id = ? AND duration_seconds IS NOT NULL",
            (card_id,),
        ).fetchone()["s"]
        cd["time_spent_seconds"] = total
        return cd

    # ---------- Checklist ----------
    def add_checklist_item(self, card_id, text):
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 p FROM checklist_items WHERE card_id = ?",
            (card_id,),
        ).fetchone()
        cur = self.conn.execute(
            "INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)",
            (card_id, text, row["p"]),
        )
        self.conn.commit()
        return {"id": cur.lastrowid}

    def toggle_checklist_item(self, item_id):
        self.conn.execute(
            "UPDATE checklist_items SET done = 1 - done WHERE id = ?", (item_id,)
        )
        self.conn.commit()

    def delete_checklist_item(self, item_id):
        self.conn.execute("DELETE FROM checklist_items WHERE id = ?", (item_id,))
        self.conn.commit()

    def rename_checklist_item(self, item_id, text):
        self.conn.execute(
            "UPDATE checklist_items SET text = ? WHERE id = ?", (text, item_id)
        )
        self.conn.commit()

    # ---------- Labels ----------
    def create_label(self, board_id, name, color):
        cur = self.conn.execute(
            "INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)",
            (board_id, name, color),
        )
        self.conn.commit()
        return {"id": cur.lastrowid}

    def delete_label(self, label_id):
        self.conn.execute("DELETE FROM labels WHERE id = ?", (label_id,))
        self.conn.commit()

    def toggle_card_label(self, card_id, label_id):
        existing = self.conn.execute(
            "SELECT 1 FROM card_labels WHERE card_id = ? AND label_id = ?",
            (card_id, label_id),
        ).fetchone()
        if existing:
            self.conn.execute(
                "DELETE FROM card_labels WHERE card_id = ? AND label_id = ?",
                (card_id, label_id),
            )
        else:
            self.conn.execute(
                "INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)",
                (card_id, label_id),
            )
        self.conn.commit()

    # ---------- Time tracking ----------
    def start_timer(self, card_id, kind="pomodoro"):
        started = dbm.now_iso()
        cur = self.conn.execute(
            "INSERT INTO time_logs (card_id, started_at, kind) VALUES (?, ?, ?)",
            (card_id, started, kind),
        )
        self.conn.commit()
        return {"id": cur.lastrowid, "started_at": started}

    def stop_timer(self, log_id):
        row = self.conn.execute(
            "SELECT started_at FROM time_logs WHERE id = ?", (log_id,)
        ).fetchone()
        if not row:
            return None
        started = datetime.datetime.fromisoformat(row["started_at"])
        ended = datetime.datetime.now()
        duration = max(0, int((ended - started).total_seconds()))
        self.conn.execute(
            "UPDATE time_logs SET ended_at = ?, duration_seconds = ? WHERE id = ?",
            (ended.isoformat(timespec="seconds"), duration, log_id),
        )
        self.conn.commit()
        return {"duration_seconds": duration}

    def discard_timer(self, log_id):
        self.conn.execute("DELETE FROM time_logs WHERE id = ?", (log_id,))
        self.conn.commit()

    def get_today_summary(self, board_id):
        today = datetime.date.today().isoformat()
        rows = self.conn.execute(
            """
            SELECT c.id as card_id, c.title, COALESCE(SUM(t.duration_seconds), 0) as seconds
            FROM cards c
            JOIN time_logs t ON t.card_id = c.id
            WHERE c.board_id = ? AND t.duration_seconds IS NOT NULL AND date(t.started_at) = ?
            GROUP BY c.id
            HAVING seconds > 0
            ORDER BY seconds DESC
            """,
            (board_id, today),
        ).fetchall()
        return [dict(r) for r in rows]

    # ---------- Settings ----------
    def get_settings(self):
        rows = self.conn.execute("SELECT key, value FROM settings").fetchall()
        s = {r["key"]: r["value"] for r in rows}
        defaults = {
            "pomodoro_work_minutes": "25",
            "pomodoro_short_break_minutes": "5",
            "pomodoro_long_break_minutes": "15",
            "pomodoro_rounds": "4",
        }
        for k, v in defaults.items():
            s.setdefault(k, v)
        return s

    def set_setting(self, key, value):
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
        self.conn.commit()
