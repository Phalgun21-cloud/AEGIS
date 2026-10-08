import enum

from sqlalchemy import LargeBinary
from sqlalchemy.dialects import mysql

# Plain BLOB is capped at 64 KB in MySQL; images and papers need MEDIUMBLOB (16 MB).
Blob = LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql")


def enum_values(e: type[enum.Enum]) -> list[str]:
    return [m.value for m in e]
