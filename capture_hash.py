"""
mitmproxy addon — capture gRPC metadata headers (index-file-hash) from Cookie Run Classic

Usage:
  pip install mitmproxy
  mitmweb -s capture_hash.py --listen-port 8888

Then configure your Android device/emulator to use proxy IP:8888,
install the mitmproxy CA certificate (visit mitm.it on the device),
and launch the game. The hash appears in the terminal/web UI.
"""

import json


def request(flow):
    # gRPC metadata is sent as HTTP/2 pseudo-headers.
    # Look for the IngameStream or MatchMaker RPC paths.
    url = flow.request.pretty_url
    if "devsisters" not in url and "devscloud" not in url and "devnova" not in url:
        return

    # Print all request headers
    idx_hash = flow.request.headers.get("index-file-hash")
    combo = flow.request.headers.get("combo-name")
    player = flow.request.headers.get("player-id")

    if idx_hash:
        print("=" * 60)
        print(f"[FOUND] index-file-hash = {idx_hash}")
        print(f"[INFO]  combo-name      = {combo}")
        print(f"[INFO]  player-id       = {player}")
        print(f"[URL]   {url}")
        print("=" * 60)

        # Also write to a file for persistence
        with open("captured_hash.txt", "a") as f:
            f.write(f"{idx_hash}  # combo={combo}  player={player}\n")
    elif combo:
        print(f"[combo] {combo}  (no hash yet)  {url}")
