#!/usr/bin/env python3
"""Add the Status API hostname to a locally managed cloudflared ingress file."""

import argparse
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


HOSTNAME = "status-api.ossmxun.net"
SERVICE = "http://127.0.0.1:3000"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path("/etc/cloudflared/config.yml"))
    args = parser.parse_args()
    path = args.config
    original = path.read_text(encoding="utf-8")
    route = re.compile(
        rf"(?m)^(?P<indent>[ \t]*)- hostname: {re.escape(HOSTNAME)}\s*\n"
        rf"(?P=indent)  service: {re.escape(SERVICE)}\s*$"
    )
    if HOSTNAME in original:
        if not route.search(original):
            raise SystemExit(f"{HOSTNAME} already exists with a different route; leaving config unchanged")
        print("Status API route already exists; config unchanged")
        return

    catchall = re.compile(r"(?m)^(?P<indent>[ \t]*)- service: http_status:404\s*$")
    matches = list(catchall.finditer(original))
    if len(matches) != 1:
        raise SystemExit("Expected exactly one final http_status:404 ingress rule; leaving config unchanged")
    match = matches[0]
    indent = match.group("indent")
    addition = f"{indent}- hostname: {HOSTNAME}\n{indent}  service: {SERVICE}\n"
    updated = original[: match.start()] + addition + original[match.start() :]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_name(f"{path.name}.bak-status-api-{stamp}")
    shutil.copy2(path, backup)

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temporary.write(updated)
        temp_path = Path(temporary.name)
    metadata = path.stat()
    os.chmod(temp_path, metadata.st_mode)
    os.chown(temp_path, metadata.st_uid, metadata.st_gid)
    os.replace(temp_path, path)

    result = subprocess.run(
        ["cloudflared", "tunnel", "--config", str(path), "ingress", "validate"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        shutil.copy2(backup, path)
        raise SystemExit("cloudflared rejected the updated route; original config restored")
    print(f"Added {HOSTNAME} → {SERVICE}; original saved as {backup.name}")


if __name__ == "__main__":
    main()
