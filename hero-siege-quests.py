import os
import sys
import json
import logging
import threading

import webview

from src.engine.logger import _init_logger
from src.consts.logger import LOGGING_NAME
from src.engine.cache import load_cache, save_cache
from src.engine.web_fetcher import fetch_quests as fetch_web_quests, fetch_runewords, fetch_runes, fetch_items

# User data in %APPDATA%/HeroSiegeCompanion (clean, hidden from user)
_APP_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'HeroSiegeCompanion')
os.makedirs(_APP_DIR, exist_ok=True)
CONFIG_PATH = os.path.join(_APP_DIR, "config.json")
PRESETS_PATH = os.path.join(_APP_DIR, "presets.json")


def _load_config():
    try:
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"pill_mode": False, "pill_origin": "top-right"}


def _save_config(config):
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2)


def _load_presets():
    try:
        with open(PRESETS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"active_preset_id": None, "presets": []}


def _save_presets(data):
    with open(PRESETS_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class QuestAPI:
    """API exposed to the frontend via pywebview."""

    def __init__(self):
        self._config = _load_config()
        self._presets = _load_presets()
        self._web_status = "loading"  # "loading" | "ready" | "cached" | "offline"
        self._web_quests = load_cache("quests") or []
        self._runewords = load_cache("runewords") or []
        self._runes = load_cache("runes") or []
        items_cache = load_cache("items")
        self._items = items_cache.get("items", []) if items_cache else []
        self._stat_defs = items_cache.get("stat_defs", []) if items_cache else []

        if self._web_quests:
            self._web_status = "cached"

        # Sniffer — always start immediately like the original tool
        self._sniffer = None
        self._sniffer_status = "off"  # "off" | "searching" | "connected" | "error"
        threading.Thread(target=self._start_sniffer_safe, daemon=True).start()

        # Fetch fresh data in background
        threading.Thread(target=self._fetch_web_data, daemon=True).start()

    def _fetch_web_data(self):
        logger = logging.getLogger(LOGGING_NAME)
        any_success = False
        try:
            # Quests
            data = fetch_web_quests()
            if data:
                save_cache("quests", data)
                self._web_quests = data
                any_success = True
                total = sum(len(ql["quests"]) for ql in data)
                logger.info(f"Web quests: {len(data)} questlines, {total} quests")

            # Runewords
            rw = fetch_runewords()
            if rw:
                save_cache("runewords", rw)
                self._runewords = rw
                any_success = True
                logger.info(f"Web runewords: {len(rw)}")

            # Runes
            rn = fetch_runes()
            if rn:
                save_cache("runes", rn)
                self._runes = rn
                any_success = True
                total_runes = sum(len(t["runes"]) for t in rn)
                logger.info(f"Web runes: {total_runes} in {len(rn)} tiers")

            # Items
            items_data = fetch_items()
            if items_data:
                save_cache("items", items_data)
                self._items = items_data.get("items", [])
                self._stat_defs = items_data.get("stat_defs", [])
                any_success = True
                logger.info(f"Web items: {len(self._items)}, stats: {len(self._stat_defs)}")

            self._web_status = "ready" if any_success else ("cached" if self._web_status == "cached" else "offline")
        except Exception as e:
            if self._web_status != "cached":
                self._web_status = "offline"
            logger.error(f"Web fetch failed: {e}")

    # ─── Quests ───

    def get_all_web_quests(self):
        """Return ALL quests from web data (flat list, for browsing)."""
        if not self._web_quests:
            return {"quests": []}
        quests = []
        for ql in self._web_quests:
            ql_quests = []
            for q in ql.get("quests", []):
                name = q.get("name", "")
                if not name:
                    continue
                ql_quests.append({
                    "name": name,
                    "description": q.get("description", ""),
                    "objectives": [{"label": o} for o in q.get("objectives", [])],
                    "locations": q.get("locations", []),
                })
            if ql_quests:
                quests.append({
                    "questline": ql["questline"],
                    "quests": ql_quests,
                })
        return {"questlines": quests}

    # ─── Presets ───

    def get_presets_data(self):
        """Return full presets data."""
        return self._presets

    def save_presets_data(self, data):
        """Save full presets data (frontend handles CRUD logic)."""
        self._presets = data
        _save_presets(data)
        return True

    def export_preset(self, preset_id):
        """Export a single preset to a file via save dialog."""
        preset = None
        for p in self._presets.get("presets", []):
            if p["id"] == preset_id:
                preset = p
                break
        if not preset:
            return False

        # Build export format (no internal IDs)
        export_data = {
            "version": 1,
            "name": preset["name"],
            "categories": []
        }
        for cat in preset.get("categories", []):
            export_cat = {"name": cat["name"], "items": []}
            for item in cat.get("items", []):
                export_item = {"type": item["type"], "done": item.get("done", False)}
                if item["type"] == "quest":
                    export_item["questline"] = item.get("questline", "")
                    export_item["quest_name"] = item.get("quest_name", "")
                    export_item["note"] = item.get("note", "")
                else:
                    export_item["text"] = item.get("text", "")
                export_cat["items"].append(export_item)
            export_data["categories"].append(export_cat)

        safe_name = "".join(c for c in preset["name"] if c.isalnum() or c in " -_").strip()
        for w in webview.windows:
            result = w.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=f"{safe_name}.json",
                file_types=('JSON files (*.json)',)
            )
            if result:
                path = result if isinstance(result, str) else result[0]
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(export_data, f, indent=2, ensure_ascii=False)
                return True
        return False

    def import_preset(self):
        """Import a preset from a JSON file via open dialog. Returns the preset data or None."""
        for w in webview.windows:
            result = w.create_file_dialog(
                webview.OPEN_DIALOG,
                file_types=('JSON files (*.json)',)
            )
            if result:
                path = result[0] if isinstance(result, (list, tuple)) else result
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if "name" in data and "categories" in data:
                        return data
                except (json.JSONDecodeError, OSError, KeyError):
                    pass
        return None

    # ─── Live Stats (Sniffer) ───

    def _start_sniffer_safe(self):
        """Start sniffer in background, catching errors."""
        try:
            self._sniffer_status = "searching"
            from src.engine import Engine
            from src.engine.sniffer_manager import SnifferManager
            if not self._sniffer:
                self._sniffer = SnifferManager(Engine.queue_an_event)
            self._sniffer.start()
            if self._sniffer.is_running:
                self._sniffer_status = "connected"
            else:
                self._sniffer_status = "error"
        except Exception as e:
            logger = logging.getLogger(LOGGING_NAME)
            logger.error(f"Sniffer start failed: {e}")
            self._sniffer_status = "error"

    def start_sniffer(self):
        """Start the packet sniffer (called from frontend)."""
        if self._sniffer_status in ("connected", "searching"):
            return self._sniffer_status
        threading.Thread(target=self._start_sniffer_safe, daemon=True).start()
        return "searching"

    def stop_sniffer(self):
        """Stop the packet sniffer."""
        if self._sniffer:
            self._sniffer.stop()
        self._sniffer_status = "off"
        return "off"

    def get_sniffer_status(self):
        return self._sniffer_status

    def get_live_stats(self):
        """Return current game stats as dict."""
        if self._sniffer_status != "connected":
            return None
        try:
            from src.engine import Engine
            return Engine.game_stats.to_dict()
        except Exception:
            return None

    def reset_stats(self):
        """Reset session stats."""
        try:
            from src.engine import Engine
            Engine.reset_stats()
        except Exception:
            pass
        return True

    def get_pinned_stats(self):
        return self._config.get("pinned_stats", [])

    def set_pinned_stats(self, ids):
        self._config["pinned_stats"] = ids
        _save_config(self._config)
        # Auto-start sniffer if stats are pinned
        if ids and self._sniffer_status == "off":
            threading.Thread(target=self._start_sniffer_safe, daemon=True).start()
        return True

    def get_pill_stats(self):
        """Return compact stats for pill mode display."""
        pinned = self._config.get("pinned_stats", [])
        if not pinned:
            return None
        stats = self.get_live_stats()
        if not stats:
            return None
        result = {}
        for key in pinned:
            if key in stats:
                result[key] = stats[key]
        return result

    # ─── Items ───

    _ELEMENT_STAT_KEYWORDS = {
        "fire": ["fire", "burning"],
        "cold": ["cold", "freeze", "frozen"],
        "lightning": ["lightning"],
        "arcane": ["arcane"],
        "physical": ["physical", "bleed", "attack_rating", "weapon_damage", "defense", "armor"],
        "poison": ["poison", "toxic"],
        "magic": ["magic_skill", "spell", "cast"],
        "elemental": ["elemental"],
    }

    def get_items(self, search="", types=None, rarities=None, max_level=0,
                  elements=None, stats=None, sort_by="level", sort_dir="desc"):
        """Return filtered/sorted items."""
        items = self._items or []
        if search:
            s = search.lower()
            items = [i for i in items if s in i["name"].lower()]
        if types:
            items = [i for i in items if i["type"] in types]
        if rarities:
            items = [i for i in items if i.get("rarity", "") in rarities]
        if max_level and max_level > 0:
            items = [i for i in items if (i.get("level") or 0) <= max_level]
        if elements:
            kw_sets = []
            for el in elements:
                kw_sets.extend(self._ELEMENT_STAT_KEYWORDS.get(el, [el]))
            items = [i for i in items if any(
                any(kw in s.get("id", "") for kw in kw_sets)
                for s in i.get("stats", [])
            )]
        if stats:
            items = [i for i in items if all(
                any(s.get("id") == stat_id for s in i.get("stats", []))
                for stat_id in stats
            )]
        if sort_by == "name":
            items = sorted(items, key=lambda i: i["name"].lower(), reverse=(sort_dir == "desc"))
        else:
            items = sorted(items, key=lambda i: i.get("level") or 0, reverse=(sort_dir == "desc"))
        return {"items": items, "total": len(self._items or [])}

    def get_item_filters(self):
        """Return available filter options."""
        if not self._items:
            return {"types": [], "rarities": [], "stat_defs": []}
        types = sorted(set(i["type"] for i in self._items if i.get("type")))
        rarities = sorted(set(i.get("rarity", "") for i in self._items if i.get("rarity")))
        return {"types": types, "rarities": rarities, "stat_defs": self._stat_defs or []}

    # ─── Runewords & Runes ───

    def get_runewords(self):
        """Return all runewords from web data."""
        return {"runewords": self._runewords or []}

    def get_runes(self):
        """Return all runes from web data, grouped by tier."""
        return {"tiers": self._runes or []}

    # ─── Web Status ───

    def get_web_status(self):
        """Return web fetch status: loading, ready, cached, offline."""
        return self._web_status

    # ─── Debug ───

    def get_debug_state(self):
        """Return full state for debugging."""
        return {
            "web_status": self._web_status,
            "web_quests_count": sum(len(ql["quests"]) for ql in self._web_quests) if self._web_quests else 0,
            "items_count": len(self._items),
            "runewords_count": len(self._runewords),
            "runes_count": sum(len(t["runes"]) for t in self._runes) if self._runes else 0,
            "presets_count": len(self._presets.get("presets", [])),
            "active_preset_id": self._presets.get("active_preset_id"),
        }

    # ─── Window Controls ───

    def minimize_window(self):
        for w in webview.windows:
            w.minimize()

    def close_window(self):
        for w in webview.windows:
            w.destroy()

    def open_url(self, url):
        import webbrowser
        webbrowser.open(url)

    def get_pill_size(self, visible_keys=None):
        """Calculate pill size based on actually visible stats."""
        pinned = self._config.get("pinned_stats", [])
        if not pinned:
            return [64, 64]

        # Use visible_keys from frontend if provided, otherwise use pinned
        keys = visible_keys if visible_keys else pinned

        if not keys:
            return [64, 64]

        has_sz = 'satanic_zone' in keys
        other_count = len([p for p in keys if p != 'satanic_zone'])

        if has_sz:
            w = 270
        elif other_count <= 2:
            w = 160
        else:
            w = 190

        h = 12  # padding (6 top + 6 bottom)
        h += other_count * 18  # tight: icon + label + value
        if has_sz:
            h += 72  # zone title (16) + 3 buff lines (3*16) + gaps (8)
        h = max(h, 30)
        return [w, h]

    def collapse_to_pill(self, visible_keys=None):
        from webview.window import FixPoint
        fp = self._get_fix_point()
        w, h = self.get_pill_size(visible_keys)
        for win in webview.windows:
            win.resize(w, h, fix_point=fp)

    def expand_from_pill(self):
        from webview.window import FixPoint
        fp = self._get_fix_point()
        for w in webview.windows:
            w.resize(420, 650, fix_point=fp)

    def _get_fix_point(self):
        from webview.window import FixPoint
        origin = self._config.get("pill_origin", "top-right")
        mapping = {
            "top-left": FixPoint.NORTH | FixPoint.WEST,
            "top-right": FixPoint.NORTH | FixPoint.EAST,
            "bottom-left": FixPoint.SOUTH | FixPoint.WEST,
            "bottom-right": FixPoint.SOUTH | FixPoint.EAST,
        }
        return mapping.get(origin, FixPoint.NORTH | FixPoint.EAST)

    def get_settings(self):
        return self._config

    def set_setting(self, key, value):
        self._config[key] = value
        _save_config(self._config)
        return True

    def move_window(self, dx, dy):
        for w in webview.windows:
            x, y = w.x + dx, w.y + dy
            w.move(x, y)


def main():
    _init_logger()
    logger = logging.getLogger(LOGGING_NAME)
    logger.info("Hero Siege Companion - Starting...")

    api = QuestAPI()

    # Support PyInstaller --onefile (files extracted to sys._MEIPASS)
    if getattr(sys, 'frozen', False):
        base_dir = sys._MEIPASS
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(base_dir, "frontend")

    window = webview.create_window(
        title="Hero Siege Companion",
        url=os.path.join(frontend_dir, "index.html"),
        js_api=api,
        width=420,
        height=650,
        resizable=True,
        min_size=(64, 64),
        on_top=True,
        frameless=True,
        easy_drag=False,
        background_color="#0a0a0c",
    )

    webview.start(debug=False)


if __name__ == "__main__":
    main()
