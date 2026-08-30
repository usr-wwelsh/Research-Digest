import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import db as db_module


@pytest.fixture
def conn(tmp_path):
    c = db_module.connect(str(tmp_path / "test.db"))
    yield c
    c.close()
