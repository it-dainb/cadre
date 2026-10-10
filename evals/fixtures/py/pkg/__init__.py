def slug(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", s.strip().lower()).strip("-")
