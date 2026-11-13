#!/usr/bin/env python3
"""Scan all fetched Git history and current non-ignored source with redacted output."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gitleaks', default='gitleaks', help='Gitleaks executable')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    common = ['--redact', '--no-banner', '--config', str(root / '.gitleaks.toml')]
    subprocess.run([args.gitleaks, 'git', str(root), '--log-opts=--all --full-history -m', *common], check=True)
    names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root)
    with tempfile.TemporaryDirectory(prefix='libfurry-secrets-') as directory:
        snapshot = Path(directory)
        for raw in set(names.split(b'\0')) - {b''}:
            relative = Path(os.fsdecode(raw))
            source = root / relative
            if source.is_symlink():
                raise RuntimeError('Secret scan refuses source symlinks: ' + str(relative))
            if not source.is_file():
                continue
            destination = snapshot / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        subprocess.run([args.gitleaks, 'dir', str(snapshot), *common], check=True)


if __name__ == '__main__':
    main()
