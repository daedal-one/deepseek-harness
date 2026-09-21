"""Assert guest denial against a live private-host HTTP service on allowed TCP port 80."""
import http.server
import ipaddress
import subprocess
import sys
import threading
import urllib.request

command, project, guest, address = sys.argv[1:]
if not ipaddress.ip_address(address).is_private:
    raise ValueError('the sentinel must bind the dedicated private test bridge')
incus = [command, '--force-local', 'exec', guest, '--project', project, '--']
subprocess.run(incus + ['/bin/true'], check=True, timeout=15)


class Sentinel(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'dsh-private-host-sentinel')

    def log_message(self, *args):
        pass


with http.server.HTTPServer((address, 80), Sentinel) as server:
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        url = 'http://' + address + ':80/'
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=3) as response:
            assert response.read() == b'dsh-private-host-sentinel'
        result = subprocess.run(incus + ['/usr/bin/curl', '--noproxy', '*', '--connect-timeout', '2',
                                        '--max-time', '3', '--silent', '--show-error', url],
                                capture_output=True, timeout=15)
        assert result.returncode in (7, 28), (result.returncode, result.stdout, result.stderr)
        print('Host sentinel reachable locally; guest access denied on TCP 80')
    finally:
        server.shutdown()
        thread.join()
