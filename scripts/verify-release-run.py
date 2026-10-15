"""Release only artifacts from one exact, successfully verified native build."""
import json
import os
from pathlib import Path
import subprocess

manifest = json.loads(Path('release-readiness.json').read_text())
repository = os.environ['GITHUB_REPOSITORY']
run_id = manifest['native_run_id']

def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{repository}/{path}'], text=True))

run = api(f'actions/runs/{run_id}')
assert run['status'] == 'completed' and run['conclusion'] == 'success', 'Native run is not successful'
assert run['head_sha'] == manifest['tested_commit'], 'Artifact commit does not match the verified commit'
assert run['name'] == 'TDLib platform builds', 'Unexpected build workflow'
assert run['head_repository']['full_name'] == repository, 'Unexpected source repository'
jobs = api(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
for required in ['protocol', 'android', 'ios', 'windows', 'macos']:
    assert any(j['name'] == required and j['conclusion'] == 'success' for j in jobs), f'Missing successful {required} job'
Path('.build').mkdir(exist_ok=True)
print('Verified native workflow and all platform jobs at', run['head_sha'])
