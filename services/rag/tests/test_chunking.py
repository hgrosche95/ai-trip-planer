from dataclasses import dataclass

from rag_service.chunking import chunk_text


@dataclass
class _Encoding:
    ids: list[int]
    offsets: list[tuple[int, int]]


class WordTokenizer:
    """Fake-Tokenizer für Tests: ein Token pro Leerzeichen-getrenntem Wort.
    Deutlich schneller als der echte Modell-Tokenizer und unabhängig vom
    Modell-Download - die Chunking-Logik selbst kennt den Unterschied zu
    einem echten Subword-Tokenizer nicht, sie ruft nur .encode(text) auf."""

    def encode(self, text: str) -> _Encoding:
        ids = []
        offsets = []
        pos = 0
        for word in text.split(" "):
            start = text.index(word, pos)
            end = start + len(word)
            ids.append(len(ids))
            offsets.append((start, end))
            pos = end
        return _Encoding(ids=ids, offsets=offsets)


def test_short_text_becomes_a_single_chunk() -> None:
    text = "Lissabon ist die Hauptstadt Portugals."
    chunks = chunk_text(text, WordTokenizer(), max_tokens=100, overlap_tokens=20)
    assert chunks == [text]


def test_splits_at_paragraph_boundaries_when_over_the_limit() -> None:
    para_a = " ".join(f"wortA{i}" for i in range(8))
    para_b = " ".join(f"wortB{i}" for i in range(8))
    text = f"{para_a}\n\n{para_b}"

    chunks = chunk_text(text, WordTokenizer(), max_tokens=10, overlap_tokens=0)

    assert len(chunks) == 2
    assert chunks[0] == para_a
    assert chunks[1] == para_b


def test_overlap_carries_trailing_paragraph_into_next_chunk() -> None:
    para_a = " ".join(f"a{i}" for i in range(4))
    para_b = " ".join(f"b{i}" for i in range(4))
    para_c = " ".join(f"c{i}" for i in range(4))
    text = f"{para_a}\n\n{para_b}\n\n{para_c}"

    # max_tokens=8 -> je zwei Absätze passen in einen Chunk (4+4=8)
    chunks = chunk_text(text, WordTokenizer(), max_tokens=8, overlap_tokens=4)

    assert chunks[0] == f"{para_a}\n\n{para_b}"
    # der Overlap (4 Tokens = para_b) taucht als Anfang des zweiten Chunks wieder auf
    assert chunks[1].startswith(para_b)
    assert chunks[1].endswith(para_c)


def test_oversized_single_paragraph_is_split_at_token_boundaries() -> None:
    words = [f"wort{i}" for i in range(25)]
    text = " ".join(words)

    chunks = chunk_text(text, WordTokenizer(), max_tokens=10, overlap_tokens=0)

    assert len(chunks) == 3
    assert chunks[0] == " ".join(words[0:10])
    assert chunks[1] == " ".join(words[10:20])
    assert chunks[2] == " ".join(words[20:25])


def test_empty_text_produces_no_chunks() -> None:
    assert chunk_text("   \n\n  ", WordTokenizer(), max_tokens=100, overlap_tokens=20) == []
