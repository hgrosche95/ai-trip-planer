import re
from typing import Protocol

_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


class Tokenizer(Protocol):
    """Das Teilstück der tokenizers.Tokenizer-Schnittstelle, das wir hier
    brauchen - als Protocol, damit Tests einen einfachen Fake statt des
    echten (langsamen, modellabhängigen) Tokenizers einsetzen können."""

    def encode(self, text: str): ...


def _token_length(tokenizer: Tokenizer, text: str) -> int:
    return len(tokenizer.encode(text).ids)


def _split_oversized_paragraph(tokenizer: Tokenizer, paragraph: str, max_tokens: int) -> list[str]:
    """Schneidet einen einzelnen Absatz, der für sich allein schon über dem
    Token-Limit liegt, an Token-Grenzen in mehrere Stücke. Nutzt die
    Offset-Mappings des Tokenizers, um exakt an Zeichengrenzen zu schneiden,
    die zu vollständigen Tokens gehören - kein Byte-Zählen, kein Raten."""
    encoding = tokenizer.encode(paragraph)
    if len(encoding.ids) <= max_tokens:
        return [paragraph]

    pieces = []
    offsets = encoding.offsets
    for start in range(0, len(offsets), max_tokens):
        window = offsets[start : start + max_tokens]
        char_start = window[0][0]
        char_end = window[-1][1]
        piece = paragraph[char_start:char_end].strip()
        if piece:
            pieces.append(piece)
    return pieces


def chunk_text(
    text: str,
    tokenizer: Tokenizer,
    max_tokens: int,
    overlap_tokens: int,
) -> list[str]:
    """Teilt einen Text in überlappende Chunks, orientiert an Absatzgrenzen.

    Warum an Absätzen statt an fester Zeichenzahl: ein Chunk soll möglichst
    einen in sich abgeschlossenen Gedanken enthalten, nicht mitten im Satz
    abbrechen - das ist die häufigste Ursache für schlechte RAG-Trefferqualität.
    Absätze werden greedy aneinandergehängt, bis das Token-Limit erreicht
    wäre; ein einzelner Absatz, der für sich allein schon zu lang ist, wird
    zusätzlich an Token-Grenzen aufgeteilt (siehe _split_oversized_paragraph).

    Der Overlap übernimmt die letzten Absätze des vorherigen Chunks (bis zum
    Overlap-Budget) in den nächsten, damit ein Gedanke, der genau auf einer
    Chunk-Grenze liegt, nicht ohne Kontext im nächsten Chunk auftaucht.
    """
    paragraphs = [p.strip() for p in _PARAGRAPH_SPLIT.split(text) if p.strip()]

    expanded: list[str] = []
    for paragraph in paragraphs:
        expanded.extend(_split_oversized_paragraph(tokenizer, paragraph, max_tokens))

    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for paragraph in expanded:
        paragraph_tokens = _token_length(tokenizer, paragraph)

        if current and current_tokens + paragraph_tokens > max_tokens:
            chunks.append("\n\n".join(current))

            overlap_paragraphs: list[str] = []
            overlap_count = 0
            for prev in reversed(current):
                prev_tokens = _token_length(tokenizer, prev)
                if overlap_count + prev_tokens > overlap_tokens:
                    break
                overlap_paragraphs.insert(0, prev)
                overlap_count += prev_tokens

            current = overlap_paragraphs
            current_tokens = overlap_count

        current.append(paragraph)
        current_tokens += paragraph_tokens

    if current:
        chunks.append("\n\n".join(current))

    return chunks
