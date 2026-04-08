import logging
import os
import sys

from src.consts.logger import LOGGING_NAME

_APP_DATA = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'HeroSiegeCompanion')
os.makedirs(_APP_DATA, exist_ok=True)
_LOG_FILE = os.path.join(_APP_DATA, 'companion.log')
_RAW_LOG_FILE = os.path.join(_APP_DATA, 'raw_events.log')


def _init_logger():
    logger = logging.getLogger(LOGGING_NAME)
    logger.setLevel(logging.INFO)

    dt_fmt = '%Y-%m-%d %H:%M:%S'
    formatter = logging.Formatter('[{asctime}] [{levelname}] [{module}] {message}', dt_fmt, style='{')

    # Console handler
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    logger.addHandler(console)

    # File handler (main log)
    try:
        file_handler = logging.FileHandler(_LOG_FILE, encoding='utf-8')
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception:
        pass

    # Raw events logger — separate file, captures all packet data for analysis
    raw_logger = logging.getLogger('raw_events')
    raw_logger.setLevel(logging.DEBUG)
    raw_fmt = logging.Formatter('[{asctime}] {message}', dt_fmt, style='{')
    try:
        raw_handler = logging.FileHandler(_RAW_LOG_FILE, encoding='utf-8')
        raw_handler.setFormatter(raw_fmt)
        raw_logger.addHandler(raw_handler)
    except Exception:
        pass
