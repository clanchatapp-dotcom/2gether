import pytest

# Configure pytest-asyncio to use module scope by default so fixtures work
def pytest_collection_modifyitems(config, items):
    for item in items:
        if "asyncio" in item.keywords:
            item.add_marker(pytest.mark.asyncio)
