import asyncio
import pytest

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session", autouse=True)
def _test_env(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")