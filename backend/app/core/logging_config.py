from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(log_dir: Path) -> Path:
    """Configures application-wide logging to both console and a rotating log file."""
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "arix.log"

    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Add rotating file handler if not already present
    has_file = any(
        isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", "") == str(log_file)
        for h in root_logger.handlers
    )
    if not has_file:
        file_handler = RotatingFileHandler(
            str(log_file), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.INFO)
        root_logger.addHandler(file_handler)

    # Add console stream handler if not already present
    has_stream = any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in root_logger.handlers
    )
    if not has_stream:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        stream_handler.setLevel(logging.INFO)
        root_logger.addHandler(stream_handler)

    logging.getLogger("backend").setLevel(logging.INFO)
    return log_file
