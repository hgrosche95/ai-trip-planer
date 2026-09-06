from rag_service.embeddings import _apply_prefix
from rag_service.schemas import InputType


def test_e5_model_gets_query_prefix() -> None:
    result = _apply_prefix("intfloat/multilingual-e5-large", ["Wien"], InputType.QUERY)
    assert result == ["query: Wien"]


def test_e5_model_gets_passage_prefix() -> None:
    result = _apply_prefix("intfloat/multilingual-e5-large", ["Wien ist die Hauptstadt Österreichs."], InputType.PASSAGE)
    assert result == ["passage: Wien ist die Hauptstadt Österreichs."]


def test_non_e5_model_leaves_text_unchanged() -> None:
    text = "Wien ist die Hauptstadt Österreichs."
    result = _apply_prefix(
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        [text],
        InputType.QUERY,
    )
    assert result == [text]
