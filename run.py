"""Start one meeting listener using environment credentials."""
import os
import sys
from pathlib import Path

Path("listener.pid").write_text(str(os.getpid()))
os.execv(sys.executable, [sys.executable, "live.py", "--output", "results.jsonl", *sys.argv[1:]])
