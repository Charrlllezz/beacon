import tempfile
import unittest
from pathlib import Path

import flash_fleet as ff

INFO_6 = """UF2 Bootloader 0.6.1 lib/nrfx (v2.0.0) lib/tinyusb (0.10.1-293-gaf8e5a90) lib/uf2 (remotes/origin/configupdate-9-gadbb8c7)
Model: LilyGo T-Echo
Board-ID: nRF52840-TEcho-v1
SoftDevice: S140 version 6.1.1
Date: Dec 21 2021
"""

INFO_7 = """UF2 Bootloader 0.9.2 lib/nrfx (v2.0.0) lib/tinyusb (0.12.0-145-g9775e7691) lib/uf2 (remotes/origin/configupdate-9-gadbb8c7)
Model: LilyGo T-Echo
Board-ID: nRF52840-TEcho-v1
SoftDevice: S140 version 7.3.0
Date: Sep 13 2024
"""


class BootInfoTests(unittest.TestCase):
    def test_parses_bootloader_info(self):
        info = ff.parse_info_uf2(INFO_6, Path("E:/"))
        self.assertEqual(info.bootloader, "0.6.1")
        self.assertEqual(info.softdevice, "6.1.1")
        self.assertEqual(info.board_id, "nRF52840-TEcho-v1")
        self.assertTrue(info.is_t_echo)

    def test_picks_erase_file_by_softdevice(self):
        self.assertIn("S140_6.1.0", ff.erase_file_for(ff.parse_info_uf2(INFO_6, Path("E:/"))))
        self.assertIn("S140_7.3.0", ff.erase_file_for(ff.parse_info_uf2(INFO_7, Path("E:/"))))

    def test_refuses_unknown_softdevice(self):
        info = ff.parse_info_uf2("Model: LilyGo T-Echo\nSoftDevice: S140 version 5.0.0\n", Path("E:/"))
        with self.assertRaises(RuntimeError):
            ff.erase_file_for(info)

    def test_not_a_t_echo(self):
        info = ff.parse_info_uf2("Model: RAK4631\nBoard-ID: nRF52840-WisBlock\n", Path("E:/"))
        self.assertFalse(info.is_t_echo)


class InventoryTests(unittest.TestCase):
    def test_labels_increment_and_are_reused_on_reflash(self):
        rows = [{"label": "R01", "node_id": "!aaaa0001"}, {"label": "R07", "node_id": "!aaaa0007"}]
        self.assertEqual(ff.next_label([]), "R01")
        self.assertEqual(ff.next_label(rows), "R08")
        self.assertEqual(ff.label_for("!aaaa0007", rows), "R07")
        self.assertEqual(ff.label_for("!bbbb0001", rows), "R08")
        self.assertEqual(ff.label_for("", rows), "R08")

    def test_inventory_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "inv.csv"
            ff.append_inventory({"label": "R01", "node_id": "!00000001", "firmware": "2.7.26.54e0d8d"}, path)
            ff.append_inventory({"label": "R02", "node_id": "!00000002"}, path)
            rows = ff.read_inventory(path)
            self.assertEqual([r["label"] for r in rows], ["R01", "R02"])
            self.assertEqual(rows[0]["firmware"], "2.7.26.54e0d8d")


class PinTests(unittest.TestCase):
    def test_pinned_files_match_the_release(self):
        self.assertIn(ff.FLEET_FIRMWARE, ff.FIRMWARE_UF2)
        self.assertIn(ff.RELEASE_TAG[1:], ff.BUNDLE_NAME)

    def test_pinned_firmware_matches_the_app(self):
        app_pin = (Path(__file__).resolve().parents[2] / "src/utils/firmware.ts").read_text()
        self.assertIn(f"FLEET_FIRMWARE = '{ff.FLEET_FIRMWARE}'", app_pin)


if __name__ == "__main__":
    unittest.main()
