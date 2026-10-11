"""Warnings that must fail the suite, wherever it is run from.

`pytest.ini` in this folder only applies when pytest's rootdir is this folder; the README tells people
to run the suite from the repo root, where that file is ignored. A conftest is loaded for the tests under
it either way, so the filters live here too.

The one that matters: a leaked file handle. The shared dry-run helper leaked one in every test that used
it - 26 unraisable exceptions, invisible in a normal run.
"""
import pytest


def pytest_configure(config):
    config.addinivalue_line("filterwarnings", "error::ResourceWarning")
    config.addinivalue_line("filterwarnings", "error::pytest.PytestUnraisableExceptionWarning")
