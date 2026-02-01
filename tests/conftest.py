"""Pytest configuration for TUI tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest


python_root = Path(__file__).resolve().parent.parent / "python"
if python_root.exists():
    sys.path.insert(0, str(python_root))


def pytest_configure(config):
    """Configure custom markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )


def pytest_collection_modifyitems(config, items):
    """Auto-mark integration tests as slow."""
    for item in items:
        # Mark tests that start servers as slow
        if "server" in item.name.lower() or "integration" in item.name.lower():
            item.add_marker(pytest.mark.slow)
