import logging
import threading

from src.engine.backend import Backend
from src.consts.logger import LOGGING_NAME
from src.engine import sniffer_filter_thread

from scapy.sendrecv import AsyncSniffer
from src.consts.enums import ConnectionError


class SnifferManager:
    def __init__(self, packet_callback):
        self.logger = logging.getLogger(LOGGING_NAME)
        self.callback = packet_callback
        self.sniffer = None
        self.iface = None
        self.filter = None
        self._running = False

    def start(self):
        if self._running:
            return
        self.logger.info("Starting sniffer...")
        try:
            self.iface = Backend.get_connection_interface()
            self.filter = Backend.get_packet_filter()
            if self.iface == ConnectionError.InterfaceNotFound:
                self.logger.warning("No interface found, sniffer not started")
                return
            self.sniffer = AsyncSniffer(
                iface=self.iface,
                filter=self.filter,
                prn=self.callback,
                store=False,
            )
            self.sniffer.start()
            self._running = True
            self.logger.info(f"Sniffer started on interface: {self.iface}")
            self._start_filter_thread()
        except Exception as e:
            self.logger.error(f"Failed to start sniffer: {e}")
            self.sniffer = None

    def stop(self):
        if not self._running:
            return
        self.logger.info("Stopping sniffer...")
        try:
            if self.sniffer and hasattr(self.sniffer, 'stop_cb'):
                self.sniffer.stop()
        except Exception as e:
            self.logger.error(f"Error stopping sniffer: {e}")
        self.sniffer = None
        self._running = False

    @property
    def is_running(self):
        return self._running

    def change_sniffer_filter(self, new_filter):
        if self.sniffer and hasattr(self.sniffer, 'stop_cb'):
            self.sniffer.stop()
            self.filter = new_filter

            from src.engine.message_parser import MessageParser
            MessageParser.reset_packet_buffers()

            self.sniffer = AsyncSniffer(
                iface=self.iface,
                filter=self.filter,
                prn=self.callback,
                store=False,
            )
            self.sniffer.start()
            self.logger.info(f"Sniffer filter changed to: {new_filter}")

    def _start_filter_thread(self):
        t = threading.Thread(target=sniffer_filter_thread.observe_changing_ips, args=(self,))
        t.daemon = True
        t.start()
