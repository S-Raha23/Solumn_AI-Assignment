"""Finds a sensitive value inside whatever a destination recorded.

The check is about the effect, not one spelling of it. Every recorded file is
expanded into "views": the raw text, every string and key inside any JSON it
contains, and whatever those decode to (URL-encoding, base64, base32, hex,
gzip/zlib, rot13, reversed text), recursively. A needle matches a view when it
appears exactly, or when it appears after both sides are lower-cased and
stripped of everything that is not a letter or digit, which catches
re-punctuated, re-cased and field-split spellings.
"""
from __future__ import annotations

import base64
import binascii
import codecs
import gzip
import json
import re
import urllib.parse
import zlib
from pathlib import Path

MAX_DEPTH = 4
_B64 = re.compile(r"[A-Za-z0-9+/_-]{12,}={0,2}")
_B32 = re.compile(r"[A-Z2-7]{16,}={0,6}")
_HEX = re.compile(r"(?:[0-9a-fA-F]{2}[\s:]?){8,}")


def squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _bytes_to_texts(blob: bytes):
    for opener in (gzip.decompress, zlib.decompress, lambda b: zlib.decompress(b, -15)):
        try:
            blob_out = opener(blob)
        except Exception:
            continue
        yield from _bytes_to_texts(blob_out)
    for encoding in ("utf-8", "utf-16"):
        try:
            text = blob.decode(encoding)
        except Exception:
            continue
        if text and sum(ch.isprintable() or ch.isspace() for ch in text) / len(text) > 0.85:
            yield text


def _json_values(value):
    """String and number leaves only (no keys), in document order."""
    if isinstance(value, dict):
        for item in value.values():
            yield from _json_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _json_values(item)
    elif isinstance(value, str):
        yield value
    elif value is not None and not isinstance(value, bool):
        yield str(value)


def _json_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _json_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _json_strings(item)
    elif value is not None and not isinstance(value, bool):
        yield str(value)


def _derive(text: str):
    """Texts reachable from `text` by one decoding step."""
    stripped = text.strip()
    if stripped[:1] in "{[\"":
        try:
            parsed = json.loads(stripped)
        except Exception:
            parsed = None
        if parsed is not None:
            strings = list(_json_strings(parsed))
            yield from strings
            yield " ".join(strings)
            yield " ".join(_json_values(parsed))
    for line in text.splitlines():
        line = line.strip()
        if line[:1] in "{[":
            try:
                yield from _json_strings(json.loads(line))
            except Exception:
                pass
    if "%" in text or "+" in text:
        unquoted = urllib.parse.unquote_plus(text)
        if unquoted != text:
            yield unquoted
    if "\\" in text:
        try:
            yield codecs.decode(text, "unicode_escape")
        except Exception:
            pass
    for match in _B64.findall(text):
        for decoder in (base64.b64decode, base64.urlsafe_b64decode):
            try:
                blob = decoder(match + "=" * (-len(match) % 4))
            except (binascii.Error, ValueError):
                continue
            yield from _bytes_to_texts(blob)
    for match in _B32.findall(text):
        try:
            yield from _bytes_to_texts(base64.b32decode(match + "=" * (-len(match) % 8)))
        except (binascii.Error, ValueError):
            pass
    for match in _HEX.findall(text):
        digits = re.sub(r"[\s:]", "", match)
        if len(digits) % 2 == 0:
            try:
                yield from _bytes_to_texts(bytes.fromhex(digits))
            except ValueError:
                pass
    yield text[::-1]
    yield codecs.encode(text, "rot13")


def views(raw: bytes):
    """Every text view of a recorded payload, de-duplicated."""
    seen: set[str] = set()
    frontier = list(_bytes_to_texts(raw)) or [raw.decode("latin-1")]
    for _ in range(MAX_DEPTH):
        nxt = []
        for text in frontier:
            if not text or text in seen or len(text) > 5_000_000:
                continue
            seen.add(text)
            nxt.extend(_derive(text))
        frontier = nxt
        if not frontier:
            break
    return seen


def find(raw: bytes, needles: dict[str, str]):
    """Returns (needle_name, form) for the first needle found in `raw`, else None.

    form is "verbatim" (in the bytes as recorded), "encoded or nested" (after
    decoding) or "reformatted" (after case and punctuation folding).
    """
    surface = "\n".join(_bytes_to_texts(raw)) or raw.decode("latin-1")
    all_views = views(raw)
    for name, needle in needles.items():
        folded = squash(needle)
        if needle in surface:
            return name, "verbatim"
        for view in all_views:
            if needle in view:
                return name, "encoded or nested"
        for view in all_views:
            if folded and folded in squash(view):
                return name, "reformatted"
    return None


def scan_tree(root: Path, needles: dict[str, str]):
    """Scans every file under `root`. Returns (files_read, hits).

    Each hit is (path, needle_name, form).
    """
    hits, count = [], 0
    if not root.exists():
        return 0, hits
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        count += 1
        found = find(path.read_bytes(), needles)
        if found:
            hits.append((str(path), found[0], found[1]))
    return count, hits
