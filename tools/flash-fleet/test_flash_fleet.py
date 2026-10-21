import tempfile
import unittest
from pathlib import Path
from unittest import mock

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

    def test_vanishing_drive_counts_as_gone(self):
        # Windows raises WinError 433 when the drive disappears mid-check;
        # that crashed the first real flash right after a good copy.
        def vanished(self):
            raise OSError(433, "A device which does not exist was specified")
        with mock.patch.object(Path, "is_file", vanished):
            self.assertFalse(ff.drive_present(Path("D:/")))
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(ff.drive_present(Path(d)))
            (Path(d) / "INFO_UF2.TXT").write_text(INFO_6)
            self.assertTrue(ff.drive_present(Path(d)))


class EraseCheckTests(unittest.TestCase):
    def test_region_set_means_not_erased(self):
        # The first real run left owner, region and channel in place.
        self.assertTrue(ff.RadioInfo("!dbfc6a47", "2.7.26", region=0).blank)
        self.assertFalse(ff.RadioInfo("!dbfc6a47", "2.7.26", region=1).blank)


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

    def test_old_inventory_gets_the_new_column_without_misaligning(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "inv.csv"
            old_fields = [f for f in ff.INVENTORY_FIELDS if f != "crew"]
            path.write_text(",".join(old_fields) + "\nR01,!00000001,2.7.26,b,0.6.1,6.1.1,yes,t,old note\n")
            ff.append_inventory({"label": "R02", "node_id": "!00000002", "crew": "1001:0913ad"}, path)
            rows = ff.read_inventory(path)
            self.assertEqual(rows[0]["notes"], "old note")
            self.assertEqual(rows[0]["crew"], "")
            self.assertEqual(rows[1]["crew"], "1001:0913ad")


class CrewKeyTests(unittest.TestCase):
    # Pinned to the same strings as src/services/crew/fixture.test.ts: the app
    # and the flashing station must build identical channels.
    FIXTURE_KEY = bytes(range(32))
    FIXTURE_URL = ("https://meshtastic.org/e/#Ci0SIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fGgVSTkRWVToCCCASCggBEAA4AUADSAE")

    def test_channel_matches_the_app(self):
        self.assertEqual(ff.meshtastic_url(self.FIXTURE_KEY), self.FIXTURE_URL)
        self.assertEqual(ff.crew_id(self.FIXTURE_KEY), "0913ad")
        self.assertEqual(
            ff.invite_url(self.FIXTURE_KEY, "Order 1001"),
            f"rndvu://join#v=1&cs={self.FIXTURE_URL.split('#')[1]}&n=Order%201001",
        )

    def test_app_fixture_is_the_same(self):
        ts = (Path(__file__).resolve().parents[2] / "src/services/crew/fixture.test.ts").read_text()
        self.assertIn(self.FIXTURE_URL.split("#")[1], ts)

    def test_one_key_per_order_reused_across_sessions(self):
        with tempfile.TemporaryDirectory() as d:
            a = ff.load_or_create_order("1001", "Ash's crew", Path(d))
            b = ff.load_or_create_order("1001", None, Path(d))
            c = ff.load_or_create_order("1002", None, Path(d))
            self.assertEqual(len(a.psk), 32)
            self.assertEqual(a.psk, b.psk)
            self.assertEqual(b.crew_name, "Ash's crew")
            self.assertNotEqual(a.psk, c.psk)
            self.assertEqual(c.crew_name, "Order 1002")
            saved = (Path(d) / "1001.json").read_text()
            self.assertIn('"crew_id": "%s"' % a.crew_id, saved)
            self.assertIn("rndvu://join#v=1&cs=", saved)

    def test_rejects_unsafe_order_ids(self):
        with tempfile.TemporaryDirectory() as d:
            for bad in ["../x", "a b", "", "x" * 41]:
                with self.assertRaises(ValueError):
                    ff.load_or_create_order(bad, None, Path(d))

    def test_orders_are_git_ignored(self):
        self.assertIn("orders/", (Path(__file__).resolve().parent / ".gitignore").read_text())


class PinTests(unittest.TestCase):
    def test_pinned_files_match_the_release(self):
        self.assertIn(ff.FLEET_FIRMWARE, ff.FIRMWARE_UF2)
        self.assertIn(ff.RELEASE_TAG[1:], ff.BUNDLE_NAME)

    def test_pinned_firmware_matches_the_app(self):
        app_pin = (Path(__file__).resolve().parents[2] / "src/utils/firmware.ts").read_text()
        self.assertIn(f"FLEET_FIRMWARE = '{ff.FLEET_FIRMWARE}'", app_pin)


if __name__ == "__main__":
    unittest.main()
