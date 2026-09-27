"""SWE-Kit by Composio Integration for Arix AI."""

from __future__ import annotations

import os

# Enforce Arix local-first privacy standard: disable telemetry for Composio and SWE-Kit
os.environ["COMPOSIO_DISABLE_TELEMETRY"] = "true"
