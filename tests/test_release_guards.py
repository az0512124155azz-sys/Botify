import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'prepare-release.py'

class ReleaseGuards(unittest.TestCase):
    def fixture(self, root, ipa_name, include_dll=True):
        root = Path(root)
        (root / 'release-readiness.json').write_text(json.dumps({'version':'0.0.0-test','tested_commit':'a'*40,'native_run_id':1}))
        artifacts = root / '.build' / 'release-artifacts'
        windows = artifacts / 'windows'
        windows.mkdir(parents=True)
        (windows / 'BotHub.exe').write_bytes(b'fixture')
        if include_dll:
            (windows / 'tdjson.dll').write_bytes(b'fixture')
        (artifacts / 'test.apk').write_bytes(b'fixture')
        (artifacts / 'test.dmg').write_bytes(b'fixture')
        with zipfile.ZipFile(artifacts / ipa_name, 'w') as archive:
            archive.writestr('Payload/BotHub.app/embedded.mobileprovision', 'fixture')
            archive.writestr('Payload/BotHub.app/_CodeSignature/CodeResources', 'fixture')
        return subprocess.run([sys.executable, str(SCRIPT)], cwd=root, capture_output=True, text=True)

    def test_unsigned_ipa_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.fixture(root, 'BotHub-unsigned-not-installable.ipa')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Unsigned IPA cannot be released', result.stderr)
            self.assertFalse((Path(root) / '.build' / 'release-assets' / 'SHA256SUMS.txt').exists())

    def test_windows_package_requires_native_tdlib(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.fixture(root, 'test.ipa', include_dll=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Native Windows TDLib DLL is missing', result.stderr)
            self.assertFalse((Path(root) / '.build' / 'release-assets' / 'SHA256SUMS.txt').exists())

if __name__ == '__main__':
    unittest.main()
