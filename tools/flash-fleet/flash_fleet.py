#!/usr/bin/env python3
"""Reflash, wipe and log RNDVU's T-Echos, one radio at a time.

For each radio:
  1. You plug it in by USB and double-tap its reset button, and it mounts as
     a USB drive (the UF2 bootloader).
  2. The script reads the bootloader's INFO_UF2.TXT, checks it is a T-Echo,
     and copies the factory-erase file that matches its SoftDevice. That wipes
     all settings, keys, names and the node database.
  3. You double-tap reset again if the drive doesn't come back by itself. The
     script then copies the pinned Meshtastic firmware (FLEET_FIRMWARE).
  4. It waits for the radio to boot, reads its version and node id over USB
     serial, and appends a row to the inventory CSV.

The radio ends up blank: no region, no channel, no name. Pairing in the RNDVU
app sets all of that in one step. Naming stays on the phone.

With --crew ORDER (Model 2 shipped packs), each radio also gets that order's
crew key: the RNDVU channel with a random 32-byte key generated once per
order and kept in orders/ORDER.json (git-ignored; back it up privately). The
RNDVU app adopts the key at pairing, so the crew needs no invite.

    python flash_fleet.py                 # loop: one radio after another
    python flash_fleet.py --crew 1001     # pre-key a pack for order 1001
    python flash_fleet.py --skip-verify   # no Meshtastic CLI installed
    python flash_fleet.py --firmware-only # reflash without erasing

Needs Python 3.10+, and for the verify step `pip install meshtastic`.
See docs/fleet-flashing.md.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import os
import re
import shutil
import string
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

# Keep in step with src/utils/firmware.ts FLEET_FIRMWARE and docker-compose.sim.yml.
FLEET_FIRMWARE = "2.7.26"
RELEASE_TAG = "v2.7.26.54e0d8d"
BUNDLE_NAME = "firmware-nrf52840-2.7.26.54e0d8d.zip"
BUNDLE_URL = f"https://github.com/meshtastic/firmware/releases/download/{RELEASE_TAG}/{BUNDLE_NAME}"
BUNDLE_SHA256 = "69ae5c1f38474e32d815dc8bc54291944fb1eb2bf0c3bd0abf5513cb078de5b2"
FIRMWARE_UF2 = "firmware-t-echo-2.7.26.54e0d8d.uf2"
ERASE_UF2 = {
    6: "Meshtastic_nRF52_factory_erase_v3_S140_6.1.0.uf2",
    7: "Meshtastic_nRF52_factory_erase_v3_S140_7.3.0.uf2",
}

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
ORDERS = HERE / "orders"
INVENTORY = HERE / "inventory.csv"
INVENTORY_FIELDS = [
    "label", "node_id", "firmware", "board", "bootloader", "softdevice",
    "erased", "flashed_at", "crew", "notes",
]


# ── Bootloader info ──────────────────────────────────────────────────────────

@dataclass
class BootInfo:
    drive: Path
    model: str
    board_id: str
    bootloader: str
    softdevice: str  # e.g. "6.1.1"

    @property
    def softdevice_major(self) -> int | None:
        m = re.match(r"(\d+)\.", self.softdevice)
        return int(m.group(1)) if m else None

    @property
    def is_t_echo(self) -> bool:
        text = f"{self.model} {self.board_id}".lower()
        return "echo" in text


def parse_info_uf2(text: str, drive: Path) -> BootInfo:
    """Parse INFO_UF2.TXT from an Adafruit nRF52 UF2 bootloader."""
    def find(pattern: str) -> str:
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        return m.group(1).strip() if m else ""

    return BootInfo(
        drive=drive,
        model=find(r"^Model:\s*(.+)$"),
        board_id=find(r"^Board-ID:\s*(.+)$"),
        bootloader=find(r"UF2 Bootloader\s+(\S+)"),
        softdevice=find(r"^SoftDevice:\s*S140\s+(?:version\s+)?(\d+\.\d+\.\d+)"),
    )


def erase_file_for(info: BootInfo) -> str:
    major = info.softdevice_major
    if major not in ERASE_UF2:
        raise RuntimeError(
            f"Unknown SoftDevice '{info.softdevice}' on {info.drive}. Not erasing; "
            "check the bootloader against the Meshtastic nRF52 docs."
        )
    return ERASE_UF2[major]


def find_boot_drives() -> list[Path]:
    """Mounted drives that look like a UF2 bootloader (have INFO_UF2.TXT)."""
    if os.name == "nt":
        roots = [Path(f"{d}:\\") for d in string.ascii_uppercase if d not in "ABC"]
    else:
        roots = [p for base in ("/Volumes", "/media", f"/media/{os.getenv('USER', '')}", "/run/media")
                 if os.path.isdir(base) for p in Path(base).iterdir()]
    found = []
    for r in roots:
        try:
            if (r / "INFO_UF2.TXT").is_file():
                found.append(r)
        except OSError:
            continue
    return found


def wait_for_boot_drive(timeout_s: float, prompt: str | None = None) -> BootInfo | None:
    if prompt:
        print(prompt)
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        drives = find_boot_drives()
        if len(drives) > 1:
            raise RuntimeError(f"More than one radio in bootloader mode ({drives}). Plug in one at a time.")
        if drives:
            d = drives[0]
            time.sleep(1.0)  # let the volume settle
            return parse_info_uf2((d / "INFO_UF2.TXT").read_text(errors="replace"), d)
        time.sleep(0.5)
    return None


def copy_uf2(src: Path, info: BootInfo) -> None:
    """Copy a UF2 to the bootloader drive. The drive vanishes as the radio
    reboots, which can surface as an error on close; that's success."""
    print(f"  copying {src.name} -> {info.drive}")
    try:
        shutil.copyfile(src, info.drive / src.name)
    except OSError:
        if (info.drive / "INFO_UF2.TXT").exists():
            raise
    # Wait for the drive to disappear (the radio is applying the file).
    deadline = time.time() + 30
    while time.time() < deadline and (info.drive / "INFO_UF2.TXT").exists():
        time.sleep(0.5)


# ── Firmware bundle ──────────────────────────────────────────────────────────

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_bundle() -> dict[str, Path]:
    """Download (once) and verify the pinned release, extract the files we use."""
    CACHE.mkdir(exist_ok=True)
    bundle = CACHE / BUNDLE_NAME
    if not bundle.exists() or sha256(bundle) != BUNDLE_SHA256:
        print(f"Downloading {BUNDLE_NAME} ...")
        tmp = bundle.with_suffix(".part")
        urllib.request.urlretrieve(BUNDLE_URL, tmp)
        tmp.replace(bundle)
    if sha256(bundle) != BUNDLE_SHA256:
        raise RuntimeError(f"{BUNDLE_NAME} checksum mismatch; refusing to flash.")
    wanted = [FIRMWARE_UF2, *ERASE_UF2.values()]
    out: dict[str, Path] = {}
    with zipfile.ZipFile(bundle) as z:
        for name in wanted:
            target = CACHE / name
            if not target.exists():
                with z.open(name) as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            out[name] = target
    return out


# ── Verify over serial ───────────────────────────────────────────────────────

@dataclass
class RadioInfo:
    node_id: str
    firmware: str


def verify_radio(timeout_s: float = 90) -> RadioInfo | None:
    """Wait for the radio's serial port and read version + node id."""
    try:
        from meshtastic import util as mt_util  # type: ignore
        from meshtastic.serial_interface import SerialInterface  # type: ignore
    except ImportError:
        print("  (meshtastic not installed; skipping verify. `pip install meshtastic`)")
        return None

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        ports = mt_util.findPorts(True)
        if len(ports) == 1:
            time.sleep(3)  # let the firmware finish booting
            try:
                iface = SerialInterface(devPath=ports[0])
            except Exception as e:  # noqa: BLE001 - keep trying until the deadline
                print(f"  serial not ready yet ({e}); retrying")
                time.sleep(3)
                continue
            try:
                num = iface.myInfo.my_node_num if iface.myInfo else 0
                fw = getattr(getattr(iface, "metadata", None), "firmware_version", "") or ""
                return RadioInfo(node_id=f"!{num:08x}", firmware=fw)
            finally:
                iface.close()
        if len(ports) > 1:
            raise RuntimeError(f"More than one Meshtastic serial port ({ports}). One radio at a time.")
        time.sleep(1)
    return None


# ── Crew keys (Model 2) ──────────────────────────────────────────────────────
#
# Must match the app's invite format (src/services/crew/invite.ts): channel
# RNDVU (the name picks the frequency every crew shares), the crew's 32-byte
# key, exact position precision, US LONG_FAST, hop limit 3. A test pins both
# sides to the same fixture string.

CHANNEL_NAME = "RNDVU"
POSITION_PRECISION_EXACT = 32
CREW_KEY_BYTES = 32


def _varint(n: int) -> bytes:
    out = bytearray()
    while n > 0x7F:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)


def _len_field(num: int, body: bytes) -> bytes:
    return _varint((num << 3) | 2) + _varint(len(body)) + body


def _var_field(num: int, value: int) -> bytes:
    return _varint(num << 3) + _varint(value)


def channel_set(psk: bytes) -> bytes:
    """Meshtastic ChannelSet { settings = 1; lora_config = 2 } for one crew."""
    settings = (
        _len_field(2, psk)
        + _len_field(3, CHANNEL_NAME.encode())
        + _len_field(7, _var_field(1, POSITION_PRECISION_EXACT))
    )
    lora = (
        _var_field(1, 1)    # use_preset
        + _var_field(2, 0)  # modem_preset LONG_FAST
        + _var_field(7, 1)  # region US
        + _var_field(8, 3)  # hop_limit
        + _var_field(9, 1)  # tx_enabled
    )
    return _len_field(1, settings) + _len_field(2, lora)


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def meshtastic_url(psk: bytes) -> str:
    return f"https://meshtastic.org/e/#{_b64url(channel_set(psk))}"


def invite_url(psk: bytes, crew_name: str) -> str:
    """The RNDVU invite, for the printed card's backup QR."""
    return f"rndvu://join#v=1&cs={_b64url(channel_set(psk))}&n={urllib.parse.quote(crew_name, safe='')}"


def crew_id(psk: bytes) -> str:
    """FNV-1a fingerprint, as the app shows it (MeshtasticCodec pskFingerprint)."""
    h = 0x811C9DC5
    for b in psk:
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"[:6]


@dataclass
class Order:
    order_id: str
    psk: bytes
    crew_name: str

    @property
    def crew_id(self) -> str:
        return crew_id(self.psk)


def load_or_create_order(order_id: str, crew_name: str | None = None, orders_dir: Path = ORDERS) -> Order:
    """One key per order, created once from the OS's secure random source.
    Re-running for the same order reuses it, so a pack flashed over several
    sessions (or a replacement radio) ends up in the same crew."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", order_id):
        raise ValueError("Order id: letters, digits, - and _ only.")
    orders_dir.mkdir(exist_ok=True)
    path = orders_dir / f"{order_id}.json"
    if path.exists():
        data = json.loads(path.read_text())
        psk = base64.b64decode(data["psk"])
        if len(psk) != CREW_KEY_BYTES:
            raise RuntimeError(f"{path} has a bad key; not using it.")
        return Order(order_id, psk, data.get("crew_name") or f"Order {order_id}")
    psk = os.urandom(CREW_KEY_BYTES)
    order = Order(order_id, psk, crew_name or f"Order {order_id}")
    path.write_text(json.dumps({
        "order": order_id,
        "crew_name": order.crew_name,
        "psk": base64.b64encode(psk).decode(),
        "crew_id": order.crew_id,
        "invite_url": invite_url(psk, order.crew_name),
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }, indent=2))
    return order


def key_radio(order: Order, timeout_s: float = 90) -> bool:
    """Write the order's crew channel to the radio on USB and read it back."""
    try:
        from meshtastic import util as mt_util  # type: ignore
        from meshtastic.serial_interface import SerialInterface  # type: ignore
    except ImportError:
        print("  meshtastic not installed; can't key the radio. `pip install meshtastic`")
        return False
    ports = mt_util.findPorts(True)
    if len(ports) != 1:
        print(f"  expected one radio on USB, found {len(ports)}")
        return False
    # --seturl writes the channel and LoRa settings; the radio reboots to apply.
    # The key goes as a process argument on this machine only, never printed.
    result = subprocess.run(
        [sys.executable, "-m", "meshtastic", "--port", ports[0], "--seturl", meshtastic_url(order.psk)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        print(f"  --seturl failed: {result.stderr.strip()[-300:]}")
        return False
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(5)  # reboot
        try:
            iface = SerialInterface(devPath=ports[0])
        except Exception:  # noqa: BLE001 - still rebooting
            continue
        try:
            ch = iface.localNode.channels[0] if iface.localNode and iface.localNode.channels else None
            ok = ch is not None and ch.settings.name == CHANNEL_NAME and bytes(ch.settings.psk) == order.psk
            if not ok:
                print("  channel read back doesn't match the order's key")
            return ok
        finally:
            iface.close()
    print("  radio didn't come back on USB after keying")
    return False


# ── Inventory ────────────────────────────────────────────────────────────────

def read_inventory(path: Path = INVENTORY) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def next_label(rows: list[dict[str, str]]) -> str:
    nums = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"R(\d+)", r.get("label", "")))]
    return f"R{(max(nums) + 1 if nums else 1):02d}"


def label_for(node_id: str, rows: list[dict[str, str]]) -> str:
    """Reuse a radio's label when it is reflashed; otherwise the next free one."""
    for r in rows:
        if node_id and r.get("node_id") == node_id:
            return r["label"]
    return next_label(rows)


def append_inventory(row: dict[str, str], path: Path = INVENTORY) -> None:
    # An inventory written before a column was added: rewrite it with the
    # current header so rows stay aligned.
    if path.exists():
        with path.open(newline="") as f:
            header = next(csv.reader(f), [])
        if header and header != INVENTORY_FIELDS:
            rows = read_inventory(path)
            with path.open("w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=INVENTORY_FIELDS)
                w.writeheader()
                for r in rows:
                    w.writerow({k: r.get(k, "") for k in INVENTORY_FIELDS})
    new = not path.exists()
    with path.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=INVENTORY_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in INVENTORY_FIELDS})


# ── Main loop ────────────────────────────────────────────────────────────────

def flash_one(files: dict[str, Path], erase: bool, verify: bool, order: Order | None = None) -> bool:
    info = wait_for_boot_drive(
        600, "\nPlug in the next T-Echo and double-tap its reset button (Ctrl+C to stop).")
    if info is None:
        print("No radio in bootloader mode after 10 min.")
        return False
    print(f"  found {info.model or '?'} | {info.board_id or '?'} | bootloader {info.bootloader or '?'} "
          f"| SoftDevice {info.softdevice or '?'}")
    if not info.is_t_echo:
        print("  Not a T-Echo. Skipping; unplug it.")
        return True

    if erase:
        copy_uf2(files[erase_file_for(info)], info)
        info2 = wait_for_boot_drive(
            90, "  Erasing. If the drive doesn't reappear in ~10 s, double-tap reset again.")
        if info2 is None:
            print("  Radio didn't come back to the bootloader. Unplug, retry this radio.")
            return True
        info = info2

    copy_uf2(files[FIRMWARE_UF2], info)
    print("  Flashed. Waiting for it to boot ...")

    radio = verify_radio() if verify else None
    rows = read_inventory()
    node_id = radio.node_id if radio else ""
    label = label_for(node_id, rows)
    ok = radio is not None and radio.firmware.startswith(FLEET_FIRMWARE)
    notes = "" if ok or not verify else f"VERIFY FAILED (read '{radio.firmware if radio else 'nothing'}')"
    crew = ""
    if order is not None:
        print(f"  Keying for order {order.order_id} (crew {order.crew_id}) ...")
        if key_radio(order):
            crew = f"{order.order_id}:{order.crew_id}"
        else:
            ok = False
            notes = (notes + " " if notes else "") + "CREW KEY FAILED"
    append_inventory({
        "label": label,
        "node_id": node_id,
        "firmware": radio.firmware if radio else f"{FLEET_FIRMWARE} (unverified)",
        "board": info.board_id,
        "bootloader": info.bootloader,
        "softdevice": info.softdevice,
        "erased": "yes" if erase else "no",
        "flashed_at": datetime.now().isoformat(timespec="seconds"),
        "crew": crew,
        "notes": notes,
    })
    print(f"  {'OK' if ok or not verify else 'CHECK'}: label {label} {node_id} {notes}")
    print(f"  Write '{label}' on the case, then unplug.")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--firmware-only", action="store_true", help="flash without the factory erase")
    ap.add_argument("--skip-verify", action="store_true", help="don't read the radio back over serial")
    ap.add_argument("--once", action="store_true", help="flash one radio and exit")
    ap.add_argument("--crew", metavar="ORDER", help="pre-key each radio with this order's crew key (Model 2)")
    ap.add_argument("--crew-name", help="crew name for a new order (shown in the app; default 'Order ORDER')")
    args = ap.parse_args(argv)

    order = None
    if args.crew:
        if args.skip_verify:
            ap.error("--crew needs the radio on USB serial; drop --skip-verify")
        order = load_or_create_order(args.crew, args.crew_name)
        print(f"Order {order.order_id}: crew '{order.crew_name}', key {order.crew_id} "
              f"(orders/{order.order_id}.json, keep it private)")

    files = ensure_bundle()
    print(f"Firmware {FLEET_FIRMWARE} ready ({FIRMWARE_UF2}). Inventory: {INVENTORY}")
    try:
        while flash_one(files, erase=not args.firmware_only, verify=not args.skip_verify, order=order):
            if args.once:
                break
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
