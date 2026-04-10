import os
import sys
import json
import logging
import threading

import webview

from src.engine.logger import _init_logger
from src.consts.logger import LOGGING_NAME
from src.engine.cache import load_cache, save_cache
from src.engine.web_fetcher import fetch_quests as fetch_web_quests, fetch_runewords, fetch_runes, fetch_items, fetch_farm

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
        return {"pill_mode": True, "pill_origin": "top-right", "pinned_stats": ["satanic_zone", "farm_zone_items"]}


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
        # Ensure default pins for new or existing users
        if "pinned_stats" not in self._config:
            self._config["pinned_stats"] = ["satanic_zone", "farm_zone_items"]
            _save_config(self._config)
        self._presets = _load_presets()
        self._companion_window = None
        self._editor_window = None
        self._tooltip_window = None
        self._frontend_dir = None
        self._web_status = "loading"  # "loading" | "ready" | "cached" | "offline"
        self._web_quests = load_cache("quests") or []
        self._runewords = load_cache("runewords") or []
        self._runes = load_cache("runes") or []
        items_cache = load_cache("items")
        self._items = items_cache.get("items", []) if items_cache else []
        self._stat_defs = items_cache.get("stat_defs", []) if items_cache else []
        farm_cache = load_cache("farm")
        self._farm = farm_cache if farm_cache else {"zone_names": {}, "items": []}

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

            # Farm (zone drop locations)
            farm_data = fetch_farm()
            if farm_data:
                save_cache("farm", farm_data)
                self._farm = farm_data
                any_success = True
                logger.info(f"Web farm: {len(farm_data['items'])} items, {len(farm_data['zone_names'])} zones")

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
        self._notify_companion()
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
                elif item["type"] == "farm":
                    export_item["item_name"] = item.get("item_name", "")
                    export_item["zones"] = item.get("zones", [])
                    export_item["source_type"] = item.get("source_type", "")
                    export_item["source_name"] = item.get("source_name", "")
                    export_item["note"] = item.get("note", "")
                else:
                    export_item["text"] = item.get("text", "")
                export_cat["items"].append(export_item)
            export_data["categories"].append(export_cat)

        safe_name = "".join(c for c in preset["name"] if c.isalnum() or c in " -_").strip()
        dialog_win = self._get_dialog_window()
        if not dialog_win:
            return False
        result = dialog_win.create_file_dialog(
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
        dialog_win = self._get_dialog_window()
        if not dialog_win:
            return None
        result = dialog_win.create_file_dialog(
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
            # Still allow farm_zone_items without live stats
            if 'farm_zone_items' not in pinned:
                return None
            stats = {}
        result = {}
        for key in pinned:
            if key == 'farm_zone_items':
                # Get farm items for the player's current zone (not satanic zone)
                cz = stats.get("current_zone")
                if cz and cz.get("code"):
                    result['farm_zone_items'] = self.get_farm_items_for_zone(cz["code"])
                else:
                    # Fallback to satanic zone if current zone not available
                    sz = stats.get("satanic_zone", {})
                    zone_str = sz.get("zone", "") if isinstance(sz, dict) else ""
                    if zone_str:
                        result['farm_zone_items'] = self.get_farm_items_for_zone(zone_str)
                    else:
                        result['farm_zone_items'] = {"zone_code": "", "zone_name": "", "items": []}
            elif key in stats:
                result[key] = stats[key]
        # Always include mail flag (shown as badge, not a pinned stat)
        result['has_mail'] = stats.get('has_mail', False)
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

    # ─── Farm (zone drop locations) ───

    def _normalize_name(self, name):
        """Normalize item name for matching (lowercase, strip special chars)."""
        return name.lower().replace("\u00b4", "'").replace("\u2019", "'").replace("`", "'").strip()

    def _enrich_farm_item(self, farm_item):
        """Add rarity/level/type from items cache by matching name."""
        norm = self._normalize_name(farm_item["name"])
        for item in self._items:
            if self._normalize_name(item["name"]) == norm:
                return {
                    **farm_item,
                    "rarity": item.get("rarity", ""),
                    "level": item.get("level", 0),
                    "type": item.get("type", ""),
                    "tier": item.get("tier", ""),
                }
        return farm_item

    def get_farm_data(self, search="", source_types=None, zone_code=""):
        """Return filtered farm items with zone drop locations."""
        items = self._farm.get("items", [])
        if search:
            s = search.lower()
            items = [i for i in items if s in i["name"].lower()]
        if zone_code:
            items = [i for i in items if zone_code in i.get("zones", [])]
        if source_types:
            def has_source(item):
                for src in item.get("sources", []):
                    if src["type"] in source_types:
                        return True
                return False
            items = [i for i in items if i.get("zones") or has_source(i)]
            if "zone" not in source_types:
                items = [i for i in items if not i.get("zones") or any(
                    s["type"] in source_types for s in i.get("sources", [])
                )]

        enriched = [self._enrich_farm_item(i) for i in items]
        return {
            "items": enriched,
            "zone_names": self._farm.get("zone_names", {}),
            "total": len(self._farm.get("items", [])),
        }

    def get_farm_filters(self):
        """Return available filter options for the farm tab."""
        items = self._farm.get("items", [])
        source_types = set()
        for item in items:
            if item.get("zones"):
                source_types.add("zone")
            for src in item.get("sources", []):
                source_types.add(src["type"])
        zones = sorted(self._farm.get("zone_names", {}).keys())
        return {"source_types": sorted(source_types), "zones": zones}

    def get_farm_items_for_zone(self, zone_str=""):
        """Return farm items for a detected zone (from sniffer).

        Args:
            zone_str: Zone string from sniffer, e.g. "Act 2 : Crystal Village"
                      or a zone code like "2-1"
        """
        if not zone_str:
            return {"zone_code": "", "zone_name": "", "items": []}

        # If it's already a zone code
        zone_code = zone_str
        zone_name = self._farm.get("zone_names", {}).get(zone_str, "")

        # If it's a sniffer zone string "Act N : ZoneName"
        import re
        match = re.match(r'Act\s+(\d+)\s*:\s*(.+)', zone_str)
        if match:
            from src.consts.satanic_zone_names import satanic_zone_names
            act = int(match.group(1))
            name = match.group(2).strip()
            act_zones = satanic_zone_names.get(act, [])
            zone_code = None
            for idx, zn in enumerate(act_zones):
                if zn == name:
                    zone_code = f"{act}-{idx + 1}"
                    zone_name = name
                    break

        if not zone_code:
            return {"zone_code": "", "zone_name": zone_str, "items": []}

        # Find items for this zone
        items = [i for i in self._farm.get("items", []) if zone_code in i.get("zones", [])]
        enriched = [self._enrich_farm_item(i) for i in items]

        return {
            "zone_code": zone_code,
            "zone_name": zone_name or zone_code,
            "items": enriched,
        }

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
            "farm_items_count": len(self._farm.get("items", [])),
            "farm_zones_count": len(self._farm.get("zone_names", {})),
            "presets_count": len(self._presets.get("presets", [])),
            "active_preset_id": self._presets.get("active_preset_id"),
        }

    # ─── Window Controls ───

    def _get_dialog_window(self):
        """Return best window to use for file dialogs (prefer editor)."""
        if self._editor_window and self._editor_window in webview.windows:
            return self._editor_window
        if self._companion_window and self._companion_window in webview.windows:
            return self._companion_window
        return None

    def _notify_companion(self):
        """Tell the companion window to reload presets."""
        try:
            if self._companion_window and self._companion_window in webview.windows:
                self._companion_window.evaluate_js('if(window.reloadPresets)reloadPresets()')
        except Exception:
            pass

    def minimize_window(self):
        if self._companion_window and self._companion_window in webview.windows:
            self._companion_window.minimize()

    def close_window(self):
        if self._tooltip_window and self._tooltip_window in webview.windows:
            try: self._tooltip_window.destroy()
            except Exception: pass
            self._tooltip_window = None
        if self._editor_window and self._editor_window in webview.windows:
            self._editor_window.destroy()
        if self._companion_window and self._companion_window in webview.windows:
            self._companion_window.destroy()

    def open_url(self, url):
        import webbrowser
        webbrowser.open(url)

    # ─── Editor Window ───

    def open_editor(self):
        """Open the preset editor window (or focus it if already open)."""
        if self._editor_window and self._editor_window in webview.windows:
            self._editor_window.restore()
            return True
        if not self._frontend_dir:
            return False

        # Restore saved position, or center on screen
        saved = self._config.get("editor_pos")
        if saved:
            x, y = saved.get("x", 100), saved.get("y", 100)
        else:
            # Center on screen (approximate — pywebview doesn't expose screen size easily)
            x, y = None, None  # let pywebview center it

        kwargs = dict(
            title="Preset Editor",
            url=os.path.join(self._frontend_dir, "editor.html"),
            js_api=self,
            width=900,
            height=650,
            resizable=True,
            min_size=(700, 500),
            on_top=False,
            frameless=True,
            easy_drag=False,
            background_color="#0a0a0c",
        )
        if x is not None and y is not None:
            kwargs["x"] = x
            kwargs["y"] = y

        self._editor_window = webview.create_window(**kwargs)
        self._editor_window.events.closed += self._on_editor_closed
        return True

    def _on_editor_closed(self):
        self._editor_window = None
        self._notify_companion()

    def _save_editor_pos(self):
        """Save editor window position to config."""
        try:
            if self._editor_window and self._editor_window in webview.windows:
                self._config["editor_pos"] = {"x": self._editor_window.x, "y": self._editor_window.y}
                _save_config(self._config)
        except Exception:
            pass

    def close_editor(self):
        self._save_editor_pos()
        if self._editor_window and self._editor_window in webview.windows:
            self._editor_window.destroy()

    def minimize_editor(self):
        if self._editor_window and self._editor_window in webview.windows:
            self._editor_window.minimize()

    def move_editor(self, dx, dy):
        if self._editor_window and self._editor_window in webview.windows:
            w = self._editor_window
            w.move(w.x + dx, w.y + dy)

    def save_editor_pos(self):
        """Called from JS on drag end to persist editor position."""
        self._save_editor_pos()

    def is_editor_open(self):
        """Return True if editor window is currently open."""
        return self._editor_window is not None and self._editor_window in webview.windows

    # ─── Pill Tooltip Window ───

    def show_pill_tooltip(self, item_html):
        """Show item tooltip in a separate window next to the pill."""
        if not self._frontend_dir or not self._companion_window:
            return False

        # Get pill position to place tooltip next to it
        try:
            px = self._companion_window.x
            py = self._companion_window.y
            pw = self._companion_window.width
        except Exception:
            return False

        gap = 6
        tx = px + pw + gap
        ty = py
        tw = 360
        th = 500

        if self._tooltip_window and self._tooltip_window in webview.windows:
            # Reuse — move, update content, show
            try:
                self._tooltip_window.move(tx, ty)
                self._tooltip_window.show()
                escaped = json.dumps(item_html)
                self._tooltip_window.evaluate_js(f'updateContent({escaped})')
                return True
            except Exception:
                # Window might be in bad state — destroy and recreate
                try:
                    self._tooltip_window.destroy()
                except Exception:
                    pass
                self._tooltip_window = None

        # Create new tooltip window
        escaped = json.dumps(item_html)
        self._tooltip_window = webview.create_window(
            title="",
            url=os.path.join(self._frontend_dir, "tooltip.html"),
            js_api=self,
            width=tw,
            height=th,
            resizable=False,
            on_top=True,
            frameless=True,
            easy_drag=False,
            background_color="#0a0a0c",
            x=tx,
            y=ty,
        )

        def _on_tooltip_loaded():
            try:
                self._tooltip_window.evaluate_js(f'updateContent({escaped})')
            except Exception:
                pass
        self._tooltip_window.events.loaded += _on_tooltip_loaded
        return True

    def hide_pill_tooltip(self):
        """Hide the tooltip window."""
        if self._tooltip_window and self._tooltip_window in webview.windows:
            try:
                self._tooltip_window.hide()
            except Exception:
                pass
        return True

    def resize_pill_tooltip(self, w, h):
        """Resize tooltip to fit content (called from tooltip.html)."""
        if self._tooltip_window and self._tooltip_window in webview.windows:
            try:
                self._tooltip_window.resize(int(w), int(h))
            except Exception:
                pass
        return True

    # ─── Pill Mode ───

    def get_pill_size(self, visible_keys=None):
        """Calculate pill size based on actually visible stats."""
        pinned = self._config.get("pinned_stats", [])
        if not pinned:
            return [64, 64]

        keys = visible_keys if visible_keys else pinned

        if not keys:
            return [64, 64]

        has_sz = 'satanic_zone' in keys
        has_farm = 'farm_zone_items' in keys
        other_count = len([p for p in keys if p not in ('satanic_zone', 'farm_zone_items')])

        if has_sz or has_farm:
            w = 270
        elif other_count <= 2:
            w = 160
        else:
            w = 190

        h = 12
        h += other_count * 18
        if has_sz:
            h += 120  # zone title + 3 buffs with name+desc stacked
        if has_farm:
            h += 140  # zone title + ~6 items
        h = max(h, 30)
        return [w, h]

    def resize_pill(self, w, h):
        """Resize pill to exact dimensions (called from JS after measuring content)."""
        from webview.window import FixPoint
        fp = self._get_fix_point()
        if self._companion_window and self._companion_window in webview.windows:
            self._companion_window.resize(int(w), int(h), fix_point=fp)

    def collapse_to_pill(self, visible_keys=None):
        from webview.window import FixPoint
        fp = self._get_fix_point()
        w, h = self.get_pill_size(visible_keys)
        if self._companion_window and self._companion_window in webview.windows:
            self._companion_window.resize(w, h, fix_point=fp)

    def expand_from_pill(self):
        from webview.window import FixPoint
        fp = self._get_fix_point()
        if self._companion_window and self._companion_window in webview.windows:
            self._companion_window.resize(420, 650, fix_point=fp)

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
        if self._companion_window and self._companion_window in webview.windows:
            w = self._companion_window
            w.move(w.x + dx, w.y + dy)


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

    api._frontend_dir = frontend_dir

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
    api._companion_window = window

    webview.start(debug=False)


if __name__ == "__main__":
    main()
