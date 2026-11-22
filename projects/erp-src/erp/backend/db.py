from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker, Session
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "erp.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False}, future=True)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
    except Exception:
        pass
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=8000")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def immediate_tx(db: Session):
    """关键库存路径：显式 BEGIN IMMEDIATE，避免并发写导致的超卖。"""
    db.execute(__import__("sqlalchemy").text("BEGIN IMMEDIATE"))
