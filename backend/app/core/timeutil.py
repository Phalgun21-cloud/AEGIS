from datetime import UTC, datetime


def utcnow() -> datetime:
    """Naive UTC 'now'. All datetimes are stored as naive UTC (MySQL DATETIME has no tz)."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)
