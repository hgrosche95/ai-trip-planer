from fastapi.testclient import TestClient

from rag_service.main import app


def test_embed_returns_one_vector_per_text_with_384_dimensions() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/embed",
            json={"texts": ["Lissabon ist die Hauptstadt Portugals.", "Rom liegt in Italien."]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["dimensions"] == 384
    assert len(body["embeddings"]) == 2
    assert all(len(vector) == 384 for vector in body["embeddings"])


def test_embed_rejects_empty_text_list() -> None:
    with TestClient(app) as client:
        response = client.post("/embed", json={"texts": []})

    assert response.status_code == 422


def test_embed_defaults_to_passage_input_type() -> None:
    with TestClient(app) as client:
        response = client.post("/embed", json={"texts": ["ein Testsatz"]})

    assert response.status_code == 200
