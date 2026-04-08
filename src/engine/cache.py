"""
Local JSON cache for web-fetched data.
Files are stored next to the executable (or project root in dev).
"""
import json
import os
import logging

from src.consts.logger import LOGGING_NAME

_APP_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'HeroSiegeCompanion')
os.makedirs(_APP_DIR, exist_ok=True)


def _cache_path(key: str) -> str:
    return os.path.join(_APP_DIR, f"cache_{key}.json")


def load_cache(key: str):
    """Load cached JSON data. Returns None if missing or corrupt."""
    logger = logging.getLogger(LOGGING_NAME)
    path = _cache_path(key)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        logger.info(f"Cache loaded: {key} ({os.path.getsize(path)} bytes)")
        return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def save_cache(key: str, data):
    """Save data to JSON cache."""
    logger = logging.getLogger(LOGGING_NAME)
    path = _cache_path(key)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        logger.info(f"Cache saved: {key} ({os.path.getsize(path)} bytes)")
    except OSError as e:
        logger.error(f"Cache save failed for {key}: {e}")
