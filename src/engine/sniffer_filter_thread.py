import time

from typing import TYPE_CHECKING

from src.engine.backend import Backend

if TYPE_CHECKING:
    from src.engine.sniffer_manager import SnifferManager


def observe_changing_ips(sniffer_manager: "SnifferManager"):
    """Monitor for game server IP changes and update sniffer filter.

    Uses a 2-cycle stabilization window to avoid restarting the sniffer
    for transient connections (matchmaking, API calls, etc.).
    """
    pending_filter: str | None = None
    pending_cycles: int = 0

    while True:
        new_filter: str = Backend.get_packet_filter()
        if new_filter and new_filter != sniffer_manager.filter:
            if new_filter == pending_filter:
                pending_cycles += 1
            else:
                pending_filter = new_filter
                pending_cycles = 1

            if pending_cycles >= 2:
                sniffer_manager.change_sniffer_filter(new_filter)
                pending_filter = None
                pending_cycles = 0
        else:
            pending_filter = None
            pending_cycles = 0
        time.sleep(1)
