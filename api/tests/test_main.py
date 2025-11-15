from fastapi.testclient import TestClient
from api.app.main import app

client = TestClient(app, raise_server_exceptions=False)

def test_health():
    r = client.get('/health')
    assert r.status_code == 200
    assert r.json().get('status') == 'ok'

def test_root():
    r = client.get('/')
    assert r.status_code == 200
    j = r.json()
    assert j.get('status') == 'ok'
    assert j.get('service') == 'athena-api'

def test_error_handler():
    r = client.get('/error')
    assert r.status_code == 500
    body = r.json()
    assert body.get('error', {}).get('code') == 'internal_error'