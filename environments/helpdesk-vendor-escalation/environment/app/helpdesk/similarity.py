"""Finds earlier tickets that look like the one an agent is working on.

Powers the "suggested fixes" panel (`python -m helpdesk suggest`). Staff see
matches from every client, because the same printer fails the same way no
matter whose counter it sits on.
"""
from __future__ import annotations

import math
import re
from collections import Counter

from .store import Store

STOPWORDS = frozenset(
    "a an and are as at be been but by can cannot for from had has have if in is it its "
    "no not of on or our so that the their them then there this to us was we when will with".split()
)
SAME_MODEL_BONUS = 0.15


def tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9][a-z0-9-]+", text.lower()) if w not in STOPWORDS]


def _document(ticket: dict) -> list[str]:
    return tokens(f"{ticket['subject']} {ticket['subject']} {ticket['body']}")


def _vector(words: list[str], idf: dict[str, float]) -> dict[str, float]:
    counts = Counter(words)
    return {word: (1 + math.log(n)) * idf.get(word, 0.0) for word, n in counts.items()}


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    dot = sum(weight * b.get(word, 0.0) for word, weight in a.items())
    norm = math.sqrt(sum(w * w for w in a.values())) * math.sqrt(sum(w * w for w in b.values()))
    return dot / norm if norm else 0.0


def similar_tickets(store: Store, ticket: dict, k: int = 3, resolved_only: bool = True) -> list[tuple[float, dict]]:
    """The `k` tickets most similar to `ticket`, best first, as (score, ticket).

    Similarity is TF-IDF cosine over subject and body, plus a small bonus when
    both tickets are about the same device model. The ticket itself and
    tickets opened after it are never returned.
    """
    corpus = store.tickets()
    documents = {t["id"]: _document(t) for t in corpus}
    doc_freq = Counter(word for words in documents.values() for word in set(words))
    idf = {word: math.log((1 + len(corpus)) / (1 + n)) + 1 for word, n in doc_freq.items()}

    target = _vector(_document(ticket), idf)
    target_device = store.device_for(ticket)
    scored = []
    for other in corpus:
        if other["id"] == ticket["id"] or other["opened_at"] >= ticket["opened_at"]:
            continue
        if resolved_only and other["status"] != "resolved":
            continue
        score = _cosine(target, _vector(documents[other["id"]], idf))
        other_device = store.device_for(other)
        if target_device and other_device and target_device["model"] == other_device["model"]:
            score += SAME_MODEL_BONUS
        if score > 0:
            scored.append((round(score, 4), other))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    return scored[:k]
