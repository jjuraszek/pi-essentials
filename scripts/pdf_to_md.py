#!/usr/bin/env python3
"""Convert a PDF to Markdown via pymupdf4llm. One argv: the PDF path.
Writes Markdown to stdout (exit 0) or an error to stderr (non-zero).

pymupdf4llm/PyMuPDF emit diagnostic chatter to stdout; the conversion result
is the RETURN value of to_markdown(). We redirect library stdout into a sink so
stdout carries only the Markdown, honoring the caller's verbatim contract."""
import contextlib
import io
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: pdf_to_md.py <pdf-path>", file=sys.stderr)
        return 2
    try:
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink):
            import pymupdf4llm
            md = pymupdf4llm.to_markdown(sys.argv[1])
    except Exception as exc:  # noqa: BLE001 — surface any failure to the caller
        print(f"pymupdf4llm conversion failed: {exc}", file=sys.stderr)
        return 1
    sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
