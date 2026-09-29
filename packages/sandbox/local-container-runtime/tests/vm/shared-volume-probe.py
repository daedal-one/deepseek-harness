"""Qualify shared Incus mounts without modifying repository files or stopping the VM."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--incus", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--instance", required=True)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--size-mib", type=int, default=1025)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--source", choices=["/dev/urandom", "/dev/zero"], default="/dev/urandom")
    args = parser.parse_args()
    if args.size_mib < 1 or args.timeout < 1:
        parser.error("size and timeout must be positive")
    if shutil.disk_usage(args.workspace).free < (args.size_mib + 10240) * 1024 ** 2:
        parser.error("probe requires its file size plus 10 GiB of free disk")
    prefix = [args.incus, "--force-local", "exec", args.instance, "--project", args.project, "--"]

    def guest(*argv):
        return subprocess.run(prefix + list(argv), capture_output=True, text=True, check=True, timeout=args.timeout).stdout.strip()

    directory = Path(tempfile.mkdtemp(prefix="shared-volume-probe-", dir=args.workspace))
    target = "/workspace/" + directory.name
    unit_a = "dsh-qualification-" + uuid.uuid4().hex
    unit_b = "dsh-qualification-" + uuid.uuid4().hex
    evidence = {}
    try:
        (directory / "host.txt").write_text("host-to-guest\n")
        assert guest("cat", target + "/host.txt") == "host-to-guest"
        guest("/bin/sh", "-ceu", 'printf "guest-to-host\\n" > "$1/guest.txt"', "probe", target)
        assert (directory / "guest.txt").read_text() == "guest-to-host\n"
        assert (directory / "guest.txt").stat().st_uid == os.getuid()
        evidence["bidirectional_mount_and_owner"] = True

        guest("dd", "if=" + args.source, "of=" + target + "/large.bin", "bs=1048576", "count=" + str(args.size_mib), "conv=fsync", "status=none")
        large = directory / "large.bin"
        with large.open("rb") as data:
            expected = hashlib.file_digest(data, "sha256").hexdigest()
        assert guest("sha256sum", target + "/large.bin").split()[0] == expected
        assert large.stat().st_size == args.size_mib * 1024 ** 2
        assert large.stat().st_blocks * 512 >= large.stat().st_size
        evidence["non_sparse_file_bytes"] = large.stat().st_size
        evidence["host_guest_sha256"] = expected

        for unit in (unit_a, unit_b):
            guest("systemd-run", "--quiet", "--collect", "--service-type=exec", "--unit=" + unit,
                  "--working-directory=" + target, "/bin/sleep", "300")
            assert guest("systemctl", "is-active", unit) == "active"
        guest("systemctl", "stop", unit_a)
        assert guest("systemctl", "is-active", unit_b) == "active"
        assert guest("sha256sum", target + "/large.bin").split()[0] == expected
        evidence["cancellation_isolation"] = True
        evidence["fresh_attachment_reads_same_files"] = True
        evidence["filesystem"] = guest("findmnt", "-n", "-o", "FSTYPE", "-T", target)
        assert evidence["filesystem"] == "virtiofs"
        print(json.dumps(evidence, sort_keys=True))
    finally:
        failures = []
        for unit in (unit_a, unit_b):
            result = subprocess.run(prefix + ["systemctl", "stop", unit], capture_output=True, text=True, timeout=60)
            if result.returncode and "not loaded" not in result.stderr:
                failures.append(result.stderr)
        if failures:
            raise RuntimeError("Owned qualification unit cleanup failed: " + "; ".join(failures))
        shutil.rmtree(directory)


if __name__ == "__main__":
    main()
