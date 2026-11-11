"""Stand in for a second crew member during a hardware test, so one phone is enough.

Plug the second T-Echo (same crew) into the laptop by USB and run:

    python scripts/stand_in_crew.py --port COM5

It acts like phone B in docs/hardware-tests/background-ble.md: it sends the
same messages on the same schedule, then keeps sending a numbered text every
--every minutes so a missing one is easy to spot on the phone. It logs
everything it hears from the crew, so the morning after you can see whether
the phone kept talking while it was locked.

Everything goes to a CSV (stand-in-<date>.csv) and the console. Ctrl+C stops
it and prints a summary.
"""
import argparse
import csv
import datetime as dt
import sys
import threading
import time

from pubsub import pub
import meshtastic.serial_interface

# NOS Events Center, middle of the grounds.
LAT, LNG = 34.0866, -117.2917

# The 2-hour run from background-ble.md, B's side: (minute, message, label).
# Phone A sends its own rows; the stand-in fills B's.
OPENING = [
    (0, None, 'start'),
    (15, 't2', 'text'),
    (45, None, 'meetup'),  # filled in at send time: half an hour from now
    (60, f'MF:!:{LAT},{LNG}', 'SOS'),
    (75, 't6', 'text'),
    (105, 't8', 'text'),
]


def now():
    return dt.datetime.now().strftime('%H:%M:%S')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', help='Serial port of the stand-in T-Echo, e.g. COM5 (default: find it)')
    ap.add_argument('--every', type=float, default=15, help='Minutes between numbered texts after the opening run (default 15)')
    ap.add_argument('--hours', type=float, default=48, help='How long to run (default 48)')
    ap.add_argument('--no-sos', action='store_true', help="Skip the SOS (it breaks through Focus; don't send it at 3 a.m. by surprise)")
    args = ap.parse_args()

    log_path = f"stand-in-{dt.datetime.now():%Y-%m-%d-%H%M}.csv"
    log_file = open(log_path, 'w', newline='', encoding='utf-8')
    log = csv.writer(log_file)
    log.writerow(['time', 'direction', 'from', 'kind', 'content'])
    lock = threading.Lock()

    def record(direction, sender, kind, content):
        with lock:
            log.writerow([dt.datetime.now().isoformat(timespec='seconds'), direction, sender, kind, content])
            log_file.flush()
        print(f'{now()}  {direction:4}  {sender:10}  {kind:9}  {content}')

    iface = meshtastic.serial_interface.SerialInterface(devPath=args.port)
    me = iface.myInfo.my_node_num
    channel = iface.localNode.channels[0].settings.name if iface.localNode.channels else '?'
    print(f'Stand-in radio !{me:08x}, channel "{channel}". Logging to {log_path}')
    if channel != 'RNDVU':
        print('Warning: channel 0 is not "RNDVU". Is this radio in the same crew as the phone?')

    heard = {}  # sender -> last time heard, any packet

    def on_receive(packet, interface):
        sender = packet.get('from')
        if sender == me:
            return
        name = packet.get('fromId') or f'!{sender:08x}'
        heard[name] = time.time()
        d = packet.get('decoded', {})
        port = d.get('portnum')
        if port == 'TEXT_MESSAGE_APP':
            record('in', name, 'text', d.get('text', ''))
        elif port == 'POSITION_APP':
            p = d.get('position', {})
            record('in', name, 'position', f"{p.get('latitude')},{p.get('longitude')}")
        elif port == 'TELEMETRY_APP':
            m = d.get('telemetry', {}).get('deviceMetrics', {})
            record('in', name, 'telemetry', f"battery {m.get('batteryLevel')}%")
        elif port:
            record('in', name, port.lower(), '')

    pub.subscribe(on_receive, 'meshtastic.receive')

    def send(text, kind):
        iface.sendText(text, hopLimit=3)
        record('out', 'stand-in', kind, text)

    start = time.time()
    end = start + args.hours * 3600
    print('Opening run: phone A sends t1 now, the stand-in answers on the background-ble.md schedule.')
    try:
        for minute, text, kind in OPENING:
            while time.time() < start + minute * 60:
                time.sleep(1)
            if kind == 'start':
                send(f'stand-in here, {now()}', 'text')
            elif kind == 'meetup':
                at = dt.datetime.now() + dt.timedelta(minutes=30)
                send(f'MF:M:{at:%H}:{at:%M}|Main gate|stand-in meetup|{LAT},{LNG}', 'meetup')
            elif kind == 'SOS' and args.no_sos:
                continue
            else:
                send(text, kind)

        n = 1
        next_at = start + 120 * 60
        while time.time() < end:
            while time.time() < next_at:
                time.sleep(1)
            send(f'n{n} {now()}', 'text')
            n += 1
            next_at += args.every * 60
    except KeyboardInterrupt:
        pass
    finally:
        hours = (time.time() - start) / 3600
        print(f'\nRan {hours:.1f} h. Last heard:')
        for name, t in sorted(heard.items(), key=lambda kv: kv[1]):
            print(f'  {name}: {dt.datetime.fromtimestamp(t):%a %H:%M}')
        iface.close()
        log_file.close()


if __name__ == '__main__':
    sys.exit(main())
