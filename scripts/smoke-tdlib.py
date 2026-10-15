"""Actual native TDLib checks, without Telegram login or real app credentials.

Validates JSON ABI, initialization, close and encrypted local database reopen.
It does not validate network authorization, chat operations or notifications.
"""
import base64
import ctypes
import json
from pathlib import Path
import secrets
import sys
import tempfile
import time

lib = ctypes.CDLL(str(Path(sys.argv[1]).resolve()))
lib.td_create_client_id.restype = ctypes.c_int
lib.td_send.argtypes = [ctypes.c_int, ctypes.c_char_p]
lib.td_receive.argtypes = [ctypes.c_double]
lib.td_receive.restype = ctypes.c_char_p
lib.td_execute.argtypes = [ctypes.c_char_p]
lib.td_execute.restype = ctypes.c_char_p
lib.td_execute(b'{"@type":"setLogVerbosityLevel","new_verbosity_level":0}')
sequence = 0

def request(client, method, **args):
    global sequence
    sequence += 1
    extra = str(sequence)
    lib.td_send(client, json.dumps({**args, '@type': method, '@extra': extra}).encode())
    end = time.monotonic() + 30
    while time.monotonic() < end:
        data = lib.td_receive(.2)
        if not data:
            continue
        value = json.loads(data)
        if value.get('@client_id') == client and value.get('@extra') == extra:
            return value
    raise TimeoutError(method)

def close(client):
    # Observe Closed rather than merely assuming close's Ok response means destruction.
    lib.td_send(client, b'{"@type":"close"}')
    end = time.monotonic() + 15
    while time.monotonic() < end:
        data = lib.td_receive(.2)
        if data:
            value = json.loads(data)
            if value.get('@client_id') == client and value.get('authorization_state', {}).get('@type') == 'authorizationStateClosed':
                return
    raise TimeoutError('TDLib close')

client = lib.td_create_client_id()
auth = request(client, 'getAuthorizationState')
version = request(client, 'getOption', name='version')
assert auth['@type'] == 'authorizationStateWaitTdlibParameters', auth
assert version['@type'] == 'optionValueString', version
close(client)
print('PASS: native ABI, version and close:', version['value'])

with tempfile.TemporaryDirectory(prefix='bothub-tdlib-smoke-') as directory:
    key = base64.b64encode(secrets.token_bytes(32)).decode()
    params = dict(
        use_test_dc=True,
        database_directory=str(Path(directory) / 'database'),
        files_directory=str(Path(directory) / 'files'),
        database_encryption_key=key,
        use_file_database=True, use_chat_info_database=True,
        use_message_database=True, use_secret_chats=False,
        api_id=12345, api_hash='0' * 32,  # Deliberately fake: no account login is attempted.
        system_language_code='en', device_model='BotHub native smoke',
        system_version=sys.platform, application_version='0.4.0',
    )
    for attempt in range(2):
        client = lib.td_create_client_id()
        assert request(client, 'getAuthorizationState')['@type'] == 'authorizationStateWaitTdlibParameters'
        result = request(client, 'setTdlibParameters', **params)
        assert result['@type'] == 'ok', result
        assert request(client, 'getAuthorizationState')['@type'] == 'authorizationStateWaitPhoneNumber'
        close(client)
    print('PASS: initialization and encrypted database reopen with the same key')
    client = lib.td_create_client_id()
    assert request(client, 'getAuthorizationState')['@type'] == 'authorizationStateWaitTdlibParameters'
    wrong = request(client, 'setTdlibParameters', **{**params, 'database_encryption_key': base64.b64encode(secrets.token_bytes(32)).decode()})
    close(client)
    assert wrong['@type'] == 'error' and wrong['code'] == 401, wrong
    print('PASS: wrong database key is rejected')
