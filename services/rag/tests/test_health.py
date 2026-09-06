from fastapi.testclient import TestClient

from rag_service.main import app


def test_health_returns_ok_and_model_name() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"]
