import logging
from src.consts.logger import LOGGING_NAME
from src.models.stats.session import Session
from src.models.stats.gold import GoldStats
from src.models.stats.xp import XPStats
from src.models.stats.added_items import AddedItemsStats
from src.models.stats.satanic_zone import SatanicZoneStats

from src.models.events.base import BaseEvent
from src.models.events.gold import GoldEvent
from src.models.events.xp import XPEvent
from src.models.events.account import AccountEvent
from src.models.events.mail import MailEvent
from src.models.events.added_item import AddedItemEvent
from src.models.events.satanic_zone import SatanicZoneEvent
from src.consts.sets import ItemsRarity


class GameStats:
    session = Session()
    gold = GoldStats()
    xp = XPStats()
    added_items = AddedItemsStats()
    satanic_zone = SatanicZoneStats()
    season_mode = None
    _last_account = None
    _last_account_raw = {}
    _current_act = 0
    _current_zone = 0
    logger = logging.getLogger(LOGGING_NAME)


    CLASS_NAMES = {
        1: 'Viking', 2: 'Pyromancer', 3: 'Demonspawn', 4: 'Marauder',
        5: 'Rogue', 6: 'Amazon', 7: 'Paladin', 8: 'Necromancer',
        9: 'Samurai', 10: 'Nomad', 11: 'Shaman',
    }

    def process_event(self, event: BaseEvent):
        self.logger.log(logging.INFO, f"GameStats.process_event: {event}")
        if isinstance(event, GoldEvent):
            self.gold.update(currencyData=event.value, season_mode=self.season_mode)
        if isinstance(event, XPEvent):
            self.xp.add(event.value)
        if isinstance(event, AccountEvent):
            self.xp.update(total_xp=event.value.experience)
            self.season_mode = event.value.get_current_season_mode()
            self._last_account = event.value
            # Store raw dict for extra stats not parsed by AccountMessage
            if hasattr(event.value, '_raw_dict'):
                self._last_account_raw = event.value._raw_dict
            # Zone tracking is handled by update_room() via game_state packets
            # (act_previous is unreliable — encodes progression, not current zone)
        if isinstance(event, MailEvent):
            self.session.update(has_mail=bool(event.value))
        if isinstance(event, AddedItemEvent):
            self.added_items.update(added_item_object=event.value)
        if isinstance(event, SatanicZoneEvent):
            self.satanic_zone.update(event.value)

    def update_room(self, room_str: str):
        """Update current zone from game_state room field (e.g. 'Act_06_01')."""
        import re
        m = re.match(r'Act_(\d+)_(\d+)', room_str)
        if m:
            act = int(m.group(1))
            zone = int(m.group(2))
            if act != self._current_act or zone != self._current_zone:
                self.logger.info(f"Room update: {room_str} → Act {act}, Zone {zone}")
                self._current_act = act
                self._current_zone = zone

    def reset(self):
        self.logger.info("Resetting all game stats...")
        self.session = Session()
        self.gold = GoldStats()
        self.xp = XPStats()
        self.added_items = AddedItemsStats()
        self.satanic_zone = SatanicZoneStats()
        self.season_mode = None

    def update_hourly_stats(self):
        self.gold.update(
            gold_per_hour=self.session.calculate_value_per_hour(
                self.gold.total_gold_earned
            )
        )
        self.xp.update(
            xp_per_hour=self.session.calculate_value_per_hour(
                self.xp.total_xp_earned
            )
        )
        _items_per_hour = {}
        for rarity_id in ItemsRarity:
            _items_per_hour[ItemsRarity[rarity_id]] = self.session.calculate_value_per_hour(
                self.added_items.added_items[ItemsRarity[rarity_id]]['total']
            )
        self.added_items.update(items_per_hour=_items_per_hour)

    def to_dict(self):
        """Return all stats as a JSON-serializable dict for the frontend."""
        self.update_hourly_stats()
        sz = self.satanic_zone.satanic_zone_info
        sz_data = None
        if sz:
            sz_data = {
                'zone': sz.satanic_zone,
                'buffs': [{'name': b.buff_name, 'desc': b.buff_description} for b in sz.buffs],
            }

        items = {}
        for rarity, data in self.added_items.added_items.items():
            items[rarity] = {'total': data['total'], 'mf': data['mf']}

        items_per_hour = {}
        for rarity, val in (self.added_items.items_per_hour or {}).items():
            items_per_hour[rarity] = val

        # Character data from last account event
        char_data = None
        if self._last_account:
            a = self._last_account
            raw = self._last_account_raw or {}
            char_data = {
                'name': getattr(a, 'name', ''),
                'class': self.CLASS_NAMES.get(getattr(a, 'class_id', 0), 'Unknown'),
                'level': getattr(a, 'level', 0),
                'difficulty': getattr(a, 'difficulty', 0),
                'hardcore': bool(getattr(a, 'hardcore', 0)),
                'season': getattr(a, 'season', 0),
                'playtime': raw.get('playtime', 0),
                'total_kills': raw.get('statisticTotalMonsterKills', 0),
                'champion_kills': raw.get('statisticChampionKills', 0),
                'ancient_kills': raw.get('statisticAncientKills', 0),
                'deaths': raw.get('statisticDeaths', 0),
            }

        return {
            'character': char_data,
            'session': {
                'duration': self.session.get_duration_str(),
                'has_mail': self.session.has_mail,
            },
            'gold': {
                'total': self.gold.total_gold,
                'earned': self.gold.total_gold_earned,
                'per_hour': self.gold.gold_per_hour,
            },
            'xp': {
                'total': self.xp.total_xp,
                'earned': self.xp.total_xp_earned,
                'per_hour': self.xp.xp_per_hour,
            },
            'items': items,
            'items_per_hour': items_per_hour,
            'satanic_zone': sz_data,
            'current_zone': {
                'act': self._current_act,
                'zone': self._current_zone,
                'code': f"{self._current_act}-{self._current_zone}" if self._current_act else "",
            } if self._current_act else None,
            'has_mail': self.session.has_mail,
        }
